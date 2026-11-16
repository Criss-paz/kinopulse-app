"""Revisión de un vídeo antes de subirlo: ¿se va a ver bien en todos los dispositivos?

    from kp_video import revisar
    plan = revisar(ruta, size_gb)
    if plan["rechazo"]:      # no tiene arreglo: hace falta otra copia
        ...
    plan["video"]            # argumentos de ffmpeg para el vídeo (copia directa o recodificación)
    plan["motivos"]          # por qué se recodifica, para el registro
    plan["avisos"]           # cosas a vigilar que no obligan a recodificar

  python scripts/kp_video.py "pelicula.mp4"     # solo dice qué haría, sin tocar nada

Lo que mira, y por qué:
  - Códec, perfil, nivel y formato de color: las teles solo decodifican por hardware H.264 de
    8 bits hasta 1080p. Lo demás (HEVC, 10 bits, 4K) se recodifica.
  - Fotogramas clave: con uno cada 10 s la barra tarda en responder al saltar. Es lo normal en
    las copias de internet y casi todas se ven bien así, de modo que solo se avisa: recodificar
    cada una costaría horas. Si una tele no abre la película, es lo primero que mirar.
  - 30 fps: el cine va a 24. Una copia a 30 repite un fotograma de cada cinco y se ve a tirones.
    Si los repetidos están, se quitan (decimate) y queda a 24. Si no están (la copia se hizo
    mezclando fotogramas) no hay nada que quitar: se rechaza y hay que buscar otra copia.
    Con KP_ACEPTAR_30FPS=1 se sube igual, sabiendo que se verá a tirones.
  - Calidad de la copia: lo que viene mal de origen no lo arregla nadie después. Por debajo de
    1080p o con muy poco bitrate se rechaza antes de gastar horas subiéndola (KP_ACEPTAR_BAJA=1
    la sube igual). Y una copia buena no se toca: recodificar siempre pierde, así que solo se
    recodifica lo que una tele no puede abrir, nunca por el tamaño del archivo.
"""
import os
import re
import subprocess
import sys

A_30 = ("30/1", "30000/1001")
# Hasta aquí se copia tal cual. Una película de 2 h a 10 Mbps son 9 GB; más que eso es un Blu-ray
# sin comprimir y sí conviene recodificarlo, por los datos de quien la ve.
MAX_MBPS = 10
# Por debajo de esto una copia 1080p ya se ve lavada en una tele (bloques en lo oscuro y en el movimiento).
MIN_MBPS = 1.5
JUSTO_MBPS = 3.5
MAX_SEG_ENTRE_CLAVES = 5

# Los mismos ajustes que arreglar-fps.py: techo alto de bitrate para que las escenas con mucho
# movimiento no se queden sin bits, y un fotograma clave cada 2 s.
RECODIFICAR = [
    "-c:v", "libx264", "-preset", "faster", "-crf", "19",
    "-maxrate", "9000k", "-bufsize", "18000k",
    "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
    "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
]


def _probe(path, entries, extra=()):
    cmd = ["ffprobe", "-v", "error", *extra, "-show_entries", entries, "-of", "default=nw=1:nk=1", str(path)]
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=300).stdout.split()
    except Exception:
        return []


def _uno(path, entry, extra=("-select_streams", "v:0")):
    out = _probe(path, entry, extra)
    return out[0] if out else ""


def repetidos(path, dur):
    """Porcentaje de fotogramas repetidos en seis tramos de la película (None = escena quieta)."""
    res = []
    for frac in (0.15, 0.3, 0.45, 0.6, 0.75, 0.9):
        out = subprocess.run([
            "ffmpeg", "-v", "error", "-ss", str(int(dur * frac)), "-t", "6", "-i", str(path), "-an",
            "-vf", "scale=480:-2,tblend=all_mode=difference,signalstats,"
                   "metadata=print:key=lavfi.signalstats.YAVG:file=-",
            "-f", "null", "-",
        ], capture_output=True, text=True).stdout
        v = [float(x) for x in re.findall(r"YAVG=([\d.]+)", out)]
        med = sorted(v)[len(v) // 2] if v else 0
        # Con la imagen casi quieta todos los fotogramas se parecen y la medida no dice nada.
        res.append(None if len(v) < 50 or med < 0.25 else 100 * sum(x < max(0.08, med * 0.12) for x in v) / len(v))
    return res


def max_entre_claves(path):
    """Segundos entre fotogramas clave, el hueco más largo de los primeros 3 minutos."""
    out = _probe(path, "frame=pts_time", ("-select_streams", "v:0", "-skip_frame", "nokey", "-read_intervals", "%+180"))
    t = []
    for x in out:
        try:
            t.append(float(x))
        except ValueError:
            pass
    return max((b - a for a, b in zip(t, t[1:])), default=0)


def mbps_video(path, dur):
    """Bitrate solo del vídeo. El del archivo entero engaña: dos pistas de audio 5.1 suman casi 1 Mbps."""
    if not dur:
        return 0
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=size",
                              "-of", "csv=p=0", str(path)], capture_output=True, text=True, timeout=600).stdout
        return sum(int(x.strip(",")) for x in out.split() if x.strip(",").isdigit()) * 8 / dur / 1e6
    except Exception:
        return 0


def referencias(path):
    """Fotogramas de referencia que declara el vídeo (0 = no se pudo leer)."""
    try:
        out = subprocess.run(["ffmpeg", "-v", "trace", "-i", str(path), "-map", "0:v:0", "-c", "copy",
                              "-bsf:v", "trace_headers", "-frames:v", "1", "-f", "null", "-"],
                             capture_output=True, text=True, errors="ignore", timeout=120).stderr
        m = re.search(r"max_num_ref_frames\s+\d+ = (\d+)", out)
        return int(m.group(1)) if m else 0
    except Exception:
        return 0


def revisar(path, size_gb=None):
    if size_gb is None:
        size_gb = os.path.getsize(path) / (1024 ** 3)
    codec = _uno(path, "stream=codec_name")
    fps = _uno(path, "stream=r_frame_rate")
    pix = _uno(path, "stream=pix_fmt")
    perfil = _uno(path, "stream=profile")
    try:
        ancho = int(_uno(path, "stream=width") or 0)
        alto = int(_uno(path, "stream=height") or 0)
        nivel = int(_uno(path, "stream=level") or 0)
        dur = float(_uno(path, "format=duration", ()) or 0)
    except ValueError:
        ancho = alto = nivel = 0
        dur = 0.0
    mbps = mbps_video(path, dur)

    motivos = []
    avisos = []
    reetiquetar = False
    if not codec or not dur:
        return {"video": [], "motivos": [], "avisos": [], "fps": fps, "codec": codec, "mbps": 0, "res": "?",
                "rechazo": "no se puede leer el vídeo: descarga incompleta o archivo dañado. Vuelve a bajarlo."}
    if codec != "h264":
        motivos.append(f"códec {codec or 'desconocido'} (las teles piden H.264)")
    else:
        # Solo tiene sentido mirar esto en H.264: lo demás se recodifica de todos modos.
        if pix not in ("yuv420p", "yuvj420p"):
            motivos.append(f"color {pix} (las teles piden 8 bits, yuv420p)")
        if perfil not in ("High", "Main", "Constrained Baseline", "Baseline"):
            motivos.append(f"perfil {perfil}")
        if nivel > 42:
            # Muchas copias dicen «nivel 5.1» sin usar nada de él. Si de verdad caben en 4.1 (1080p,
            # hasta 30 fps, 4 fotogramas de referencia) basta corregir la etiqueta, sin recodificar.
            if 0 < referencias(path) <= 4 and ancho <= 1920 and alto <= 1088 and fps not in ("50/1", "60/1", "60000/1001"):
                reetiquetar = True
            else:
                motivos.append(f"nivel {nivel / 10:.1f} (máximo 4.2)")
        hueco = max_entre_claves(path)
        if hueco > MAX_SEG_ENTRE_CLAVES:
            avisos.append(f"fotogramas clave cada {hueco:.0f} s: saltar en la barra será lento")
    if ancho > 1920 or alto > 1088:
        motivos.append(f"{ancho}x{alto} (máximo 1080p)")
    if mbps > MAX_MBPS:
        motivos.append(f"{mbps:.1f} Mbps (máximo {MAX_MBPS})")
    # Un .mkv con H.264 válido no se recodifica: ffmpeg lo pasa a .mp4 copiando el vídeo tal cual.
    if not str(path).lower().endswith((".mp4", ".mkv", ".mov", ".m4v")):
        motivos.append("contenedor antiguo")

    filtros = ["scale='min(1920,iw)':-2"]
    rechazo = None
    # 1080p de verdad mide 1920 de ancho o 1080 de alto; se deja margen para las copias recortadas.
    baja = ancho and ancho < 1500 and alto < 1000
    if baja or (0 < mbps < MIN_MBPS):
        texto = (f"copia de baja calidad ({ancho}x{alto}, {mbps:.1f} Mbps de vídeo). "
                 "Busca una 1080p de al menos 1 GB por cada media hora.")
        if os.getenv("KP_ACEPTAR_BAJA") == "1":
            avisos.append(texto + " Se sube igual por KP_ACEPTAR_BAJA=1")
        else:
            rechazo = texto
    elif mbps < JUSTO_MBPS:
        avisos.append(f"calidad justa ({mbps:.1f} Mbps de vídeo): en tele grande se nota. Si hay una copia de más peso, mejor esa")
    if fps in A_30:
        rep = [r for r in repetidos(path, dur) if r is not None] if dur > 0 else []
        if rep and max(rep) < 10:
            texto = (f"30 fps sin fotogramas repetidos ({', '.join(f'{r:.0f}%' for r in rep)}): se vería a tirones "
                     "y no tiene arreglo. Busca otra copia a 24 fps (23.976).")
            if os.getenv("KP_ACEPTAR_30FPS") == "1":
                motivos.append("AVISO: " + texto + " Se sube igual por KP_ACEPTAR_30FPS=1")
            else:
                rechazo = rechazo or texto
        else:
            # decimate busca en cada grupo de 5 cuál es el repetido y quita ese (fps= quita uno a ciegas).
            filtros.append("decimate=cycle=5")
            motivos.append(f"{fps} fps con repetidos: se devuelve a 24")

    if motivos:
        video = ["-vf", ",".join(filtros), *RECODIFICAR]
    elif reetiquetar:
        video = ["-c:v", "copy", "-bsf:v", "h264_metadata=level=4.1"]
        avisos.append(f"decía nivel {nivel / 10:.1f}: se corrige la etiqueta a 4.1 sin recodificar")
    else:
        video = ["-c:v", "copy"]
    if fps in ("50/1", "60/1", "60000/1001"):
        avisos.append(f"{fps} fps: las teles modestas pueden no dar abasto")
    return {"video": video, "motivos": motivos, "avisos": avisos, "rechazo": rechazo, "fps": fps, "codec": codec,
            "mbps": mbps, "res": f"{ancho}x{alto}"}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit('Uso: python scripts/kp_video.py "pelicula.mp4"')
    for ruta in sys.argv[1:]:
        plan = revisar(ruta)
        print(ruta)
        if plan["rechazo"]:
            print("   RECHAZADA:", plan["rechazo"])
        elif plan["motivos"]:
            print("   Se recodifica:", "; ".join(plan["motivos"]))
        else:
            print(f"   Bien tal cual ({plan['codec']}, {plan['res']}, {plan['mbps']:.1f} Mbps de vídeo, {plan['fps']} fps): copia directa.")
        for aviso in plan["avisos"]:
            print("   Aviso:", aviso)
