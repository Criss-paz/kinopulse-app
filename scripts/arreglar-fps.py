"""Devuelve a 24 fps las películas ya publicadas que quedaron a 30 fps.

El cine va a 24 fps; una copia a 30 repite un fotograma de cada cuatro y se ve a tirones.
Este script baja cada película del servidor, quita los repetidos, comprueba que siga
durando lo mismo, la vuelve a subir con otro nombre y cambia el enlace en su ficha. Se
conservan el ID, la portada y el progreso de visionado, así que para quien la esté viendo
no cambia nada salvo que deja de dar tirones.

  python scripts/arreglar-fps.py              # arregla todas las que hagan falta
  python scripts/arreglar-fps.py --listar     # solo dice cuáles están mal, sin tocar nada

Es reanudable: al arrancar vuelve a mirar qué sigue a 30 fps, así que si se corta se
relanza y sigue. El audio no se recomprime nunca (-c:a copy).
"""
import json
import os
import re
import subprocess
import sys
import time
import hashlib
from pathlib import Path

from huggingface_hub import HfApi

REPO = Path(__file__).resolve().parent.parent
CATALOG = REPO / "src" / "data" / "catalog.json"
LOCK = REPO / "src" / "data" / ".catalog.lock"
CACHE = REPO / "scripts" / ".fps-cache.json"
HUERFANOS = REPO / "scripts" / ".assets-huerfanos.txt"
DATASET_NAME = "kp-media-vault"

# Las dos formas de lo mismo: 30 exactos y 29.97. La segunda es igual de común en las
# copias de internet y da el mismo tirón, y el script anterior solo miraba la primera.
MALOS = ("30/1", "30000/1001")
BUENO = "24000/1001"


def hf_token():
    tok = os.getenv("HF_TOKEN")
    if tok:
        return tok
    env = REPO / ".env"
    if env.exists():
        m = re.search(r"^\s*HF_TOKEN\s*=\s*(\S+)", env.read_text(encoding="utf-8", errors="ignore"), re.M)
        if m:
            return m.group(1)
    sys.exit("Falta HF_TOKEN (ponlo en el entorno o en .env).")


def ffprobe(src, entries, select=None):
    cmd = ["ffprobe", "-v", "error", "-rw_timeout", "60000000"]
    if select:
        cmd += ["-select_streams", select]
    cmd += ["-show_entries", entries, "-of", "default=nw=1:nk=1", str(src)]
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=300).stdout.split()
    except Exception:
        return []


def frame_rate(src):
    out = ffprobe(src, "stream=r_frame_rate", "v:0")
    return out[0] if out else ""


def duration(src):
    out = ffprobe(src, "format=duration")
    try:
        return float(out[0])
    except (IndexError, ValueError):
        return 0.0


def save_catalog(mutate):
    """Modifica el catálogo bajo un candado y lo escribe de una pieza.

    Los scripts de subida también escriben este archivo. Sin candado, dos escrituras a la
    vez pueden entrelazarse y dejar un JSON roto; y escribir sobre el archivo final en vez
    de reemplazarlo deja el catálogo truncado si el proceso muere a mitad.
    """
    for _ in range(180):
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            break
        except FileExistsError:
            # Un candado olvidado por un proceso que murió no debe bloquear para siempre.
            try:
                if time.time() - LOCK.stat().st_mtime > 120:
                    LOCK.unlink(missing_ok=True)
                    continue
            except OSError:
                pass
            time.sleep(1)
    else:
        raise RuntimeError("El catálogo lleva 3 minutos bloqueado por otro proceso.")
    try:
        cat = json.loads(CATALOG.read_text(encoding="utf-8-sig"))
        mutate(cat)
        tmp = CATALOG.with_name(CATALOG.name + ".tmp")
        tmp.write_text(json.dumps(cat, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp, CATALOG)
    finally:
        LOCK.unlink(missing_ok=True)


def main():
    listar = "--listar" in sys.argv
    api = HfApi(token=hf_token())
    repo_id = f"{api.whoami()['name']}/{DATASET_NAME}"

    movies = json.loads(CATALOG.read_text(encoding="utf-8-sig"))["movies"]
    # Mirar los fps de 200+ películas por red tarda varios minutos; se guardan para que un
    # relanzamiento no repita el trabajo. La clave es el nombre del asset, así que una
    # película ya arreglada (con asset nuevo) se vuelve a comprobar sola.
    cache = {}
    if CACHE.exists():
        try:
            cache = json.loads(CACHE.read_text(encoding="utf-8"))
        except Exception:
            cache = {}

    todo = []
    print("Revisando fps de las películas publicadas...", flush=True)
    for m in movies:
        url = m.get("stream", "")
        if "huggingface.co" not in url:
            continue
        asset = url.rsplit("/", 1)[-1]
        rate = cache.get(asset)
        if rate is None:
            rate = frame_rate(url)
            if rate:
                cache[asset] = rate
                CACHE.write_text(json.dumps(cache, indent=0), encoding="utf-8")
        if rate in MALOS:
            todo.append((m, rate))

    print(f"\n{len(todo)} películas a 30 fps para devolver a 24 fps:", flush=True)
    for m, rate in todo:
        print(f"   [{m['id']}] {m['title']} ({rate})", flush=True)
    if listar or not todo:
        return

    arregladas = 0
    for i, (m, _) in enumerate(todo, 1):
        title, url = m["title"], m["stream"]
        print(f"\n[{i}/{len(todo)}] {title}", flush=True)
        remote = f"kp_asset_{hashlib.sha256(f'{title.lower()}_24fps'.encode()).hexdigest()[:10]}.mp4"
        tmp = REPO / f"temp_{remote}"
        try:
            antes = duration(url)
            if antes <= 0:
                raise RuntimeError("no se pudo leer la duración del original")
            # Mismos ajustes que las subidas nuevas: sin el tope de 3500k, que dejaba las
            # escenas con mucho movimiento sin bits, y keyframes cada 2 s para que la barra
            # responda al saltar. El audio se copia tal cual.
            subprocess.run([
                "ffmpeg", "-y", "-loglevel", "error", "-stats",
                "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "30",
                "-i", url,
                "-map", "0:v:0", "-map", "0:a:0",
                "-vf", f"fps={BUENO}",
                "-c:v", "libx264", "-preset", "faster", "-crf", "21",
                "-maxrate", "9000k", "-bufsize", "18000k",
                "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
                "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
                "-c:a", "copy", "-movflags", "+faststart", str(tmp),
            ], check=True)

            despues = duration(tmp)
            rate = frame_rate(tmp)
            if abs(despues - antes) > 5 or rate != BUENO:
                raise RuntimeError(f"verificación fallida: {antes:.0f}s -> {despues:.0f}s, {rate}")

            print(f"   Subiendo {remote} ({despues / 60:.0f} min, 24 fps)...", flush=True)
            api.upload_file(path_or_fileobj=str(tmp), path_in_repo=remote,
                            repo_id=repo_id, repo_type="dataset")
        except Exception as e:
            print(f"   ERROR en '{title}': {e}", flush=True)
            continue
        finally:
            if tmp.exists():
                tmp.unlink()

        nueva = f"https://huggingface.co/datasets/{repo_id}/resolve/main/{remote}"

        def repuntar(cat, movie_id=m["id"], destino=nueva):
            entry = next(x for x in cat["movies"] if x["id"] == movie_id)
            entry["stream"] = destino

        save_catalog(repuntar)
        cache[remote] = BUENO
        CACHE.write_text(json.dumps(cache, indent=0), encoding="utf-8")

        # El asset viejo se queda en el servidor sin que nadie lo use: se anota para
        # borrarlo luego de una pasada, en vez de ir dejando basura suelta.
        viejo = url.rsplit("/", 1)[-1]
        with HUERFANOS.open("a", encoding="utf-8") as f:
            f.write(f"{viejo}\t{m['id']}\t{title}\n")

        arregladas += 1
        print(f"   OK ({m['id']}): {viejo} -> {remote}", flush=True)

    print(f"\nArreglo de fps terminado: {arregladas}/{len(todo)} arregladas.", flush=True)
    if HUERFANOS.exists():
        print(f"Assets viejos sin usar anotados en {HUERFANOS.name} (se pueden borrar del servidor).", flush=True)


if __name__ == "__main__":
    main()
