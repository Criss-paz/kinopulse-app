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
"""
import os
import re
import subprocess
import sys

A_30 = ("30/1", "30000/1001")
MAX_GB = 3.2
MAX_SEG_ENTRE_CLAVES = 5

# Los mismos ajustes que arreglar-fps.py: techo alto de bitrate para que las escenas con mucho
# movimiento no se queden sin bits, y un fotograma clave cada 2 s.
RECODIFICAR = [
    "-c:v", "libx264", "-preset", "faster", "-crf", "21",
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

    motivos = []
    avisos = []
    if codec != "h264":
        motivos.append(f"códec {codec or 'desconocido'} (las teles piden H.264)")
    else:
        # Solo tiene sentido mirar esto en H.264: lo demás se recodifica de todos modos.
        if pix not in ("yuv420p", "yuvj420p"):
            motivos.append(f"color {pix} (las teles piden 8 bits, yuv420p)")
        if perfil not in ("High", "Main", "Constrained Baseline", "Baseline"):
            motivos.append(f"perfil {perfil}")
        if nivel > 42:
            motivos.append(f"nivel {nivel / 10:.1f} (máximo 4.2)")
        hueco = max_entre_claves(path)
        if hueco > MAX_SEG_ENTRE_CLAVES:
            avisos.append(f"fotogramas clave cada {hueco:.0f} s: saltar en la barra será lento")
    if ancho > 1920 or alto > 1088:
        motivos.append(f"{ancho}x{alto} (máximo 1080p)")
    if size_gb > MAX_GB:
        motivos.append(f"{size_gb:.1f} GB (máximo {MAX_GB})")
    # Un .mkv con H.264 válido no se recodifica: ffmpeg lo pasa a .mp4 copiando el vídeo tal cual.
    if not str(path).lower().endswith((".mp4", ".mkv", ".mov", ".m4v")):
        motivos.append("contenedor antiguo")

    filtros = ["scale='min(1920,iw)':-2"]
    rechazo = None
    if fps in A_30:
        rep = [r for r in repetidos(path, dur) if r is not None] if dur > 0 else []
        if rep and max(rep) < 10:
            texto = (f"30 fps sin fotogramas repetidos ({', '.join(f'{r:.0f}%' for r in rep)}): se vería a tirones "
                     "y no tiene arreglo. Busca otra copia a 24 fps (23.976).")
            if os.getenv("KP_ACEPTAR_30FPS") == "1":
                motivos.append("AVISO: " + texto + " Se sube igual por KP_ACEPTAR_30FPS=1")
            else:
                rechazo = texto
        else:
            # decimate busca en cada grupo de 5 cuál es el repetido y quita ese (fps= quita uno a ciegas).
            filtros.append("decimate=cycle=5")
            motivos.append(f"{fps} fps con repetidos: se devuelve a 24")

    video = ["-vf", ",".join(filtros), *RECODIFICAR] if motivos else ["-c:v", "copy"]
    if fps in ("50/1", "60/1", "60000/1001"):
        avisos.append(f"{fps} fps: las teles modestas pueden no dar abasto")
    return {"video": video, "motivos": motivos, "avisos": avisos, "rechazo": rechazo, "fps": fps, "codec": codec}


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
            print(f"   Bien tal cual ({plan['codec']}, {plan['fps']} fps): copia directa.")
        for aviso in plan["avisos"]:
            print("   Aviso:", aviso)
