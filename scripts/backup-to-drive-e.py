#!/usr/bin/env python3
"""Respaldo físico de KinoPulse en el disco E:\\ (etiqueta "Peliculas").

    python scripts/backup-to-drive-e.py                  # originales de Telegram + catálogo
    python scripts/backup-to-drive-e.py --desde-hf       # además, las películas publicadas (se bajan de HF)
    python scripts/backup-to-drive-e.py --esperar-fps    # espera a que termine arreglar-fps.py y luego corre
    python scripts/backup-to-drive-e.py --simular        # solo dice qué haría

Deja en E:\\KinoPulse_Backup:

    originales\\      los archivos de Downloads\\Telegram Desktop tal cual
    publicadas\\      los kp_asset_*.mp4 que el catálogo sirve hoy (solo con --desde-hf)
    catalog.json     copia del catálogo, más una fechada en catalogos\\
    indice.csv       qué película es cada kp_asset

Es incremental: un archivo que ya está en E:\\ con el mismo nombre y tamaño no se vuelve a copiar.
Corre en prioridad de fondo (CPU y disco), así que no le quita nada a un ffmpeg en marcha, y
nunca mueve ni borra nada del origen.
"""
import argparse
import csv
import ctypes
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CATALOG = REPO / "src" / "data" / "catalog.json"
ORIGEN = Path(r"C:\Users\DELL\Downloads\Telegram Desktop")
DESTINO = Path(r"E:\KinoPulse_Backup")
ETIQUETA = "peliculas"  # el disco correcto; si E:\ es otra cosa, no se escribe
VIDEO = {".mp4", ".mkv", ".avi", ".mov", ".m4v", ".webm", ".ts"}
RECIENTE_S = 15 * 60  # un archivo tocado hace menos de esto puede seguir descargándose
BLOQUE = 4 * 1024 * 1024
MARGEN_LIBRE = 5 * 1024**3


def etiqueta_del_disco(raiz):
    buf = ctypes.create_unicode_buffer(261)
    ok = ctypes.windll.kernel32.GetVolumeInformationW(str(raiz), buf, 261, None, None, None, None, 0)
    return buf.value if ok else None


def prioridad_de_fondo():
    # PROCESS_MODE_BACKGROUND_BEGIN: baja a la vez la prioridad de CPU y la de E/S del proceso.
    k = ctypes.windll.kernel32
    k.GetCurrentProcess.restype = ctypes.c_void_p
    k.SetPriorityClass.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    k.SetPriorityClass(k.GetCurrentProcess(), 0x00100000)


def fps_en_marcha():
    cmd = "Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | Where-Object { $_.CommandLine -like '*arreglar-fps*' } | Measure-Object | ForEach-Object Count"
    out = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True).stdout.strip()
    return out not in ("", "0")


def gb(n):
    return f"{n / 1024**3:.2f} GB"


class Progreso:
    def __init__(self, total_archivos, total_bytes):
        self.n = 0
        self.total = total_archivos
        self.hecho = 0
        self.total_bytes = total_bytes
        self.inicio = time.time()

    def archivo(self, nombre, tam):
        self.n += 1
        self.nombre = nombre[:60]
        self.tam = tam
        self.t0 = time.time()
        self.ultimo = 0.0
        print(f"[{self.n}/{self.total}] {nombre}  ({gb(tam)})")

    def avance(self, copiado, nuevos):
        self.hecho += nuevos
        ahora = time.time()
        if ahora - self.ultimo < 0.5 and copiado < self.tam:
            return
        self.ultimo = ahora
        vel = self.hecho / max(ahora - self.inicio, 0.001)
        falta = (self.total_bytes - self.hecho) / vel if vel else 0
        pct = 100 * copiado / self.tam if self.tam else 100
        total = 100 * self.hecho / self.total_bytes if self.total_bytes else 100
        print(f"\r    {pct:5.1f}%  {vel / 1024**2:6.1f} MB/s  total {total:5.1f}%  faltan ~{falta / 60:.0f} min   ", end="", flush=True)

    def fin(self):
        print()


def copiar(src, dst, prog):
    """Copia a un .part y lo renombra al final: un corte a mitad nunca deja un archivo que parezca completo."""
    part = dst.with_name(dst.name + ".part")
    copiado = 0
    with open(src, "rb") as f, open(part, "wb") as g:
        while True:
            bloque = f.read(BLOQUE)
            if not bloque:
                break
            g.write(bloque)
            copiado += len(bloque)
            prog.avance(copiado, len(bloque))
    if part.stat().st_size != src.stat().st_size:
        part.unlink()
        raise OSError("el tamaño no coincide tras copiar")
    shutil.copystat(src, part)
    os.replace(part, dst)


def descargar(url, dst, tam, prog, limite):
    """Baja a un .part y reanuda donde se quedó si se cortó."""
    part = dst.with_name(dst.name + ".part")
    desde = part.stat().st_size if part.exists() else 0
    if desde > tam:
        part.unlink()
        desde = 0
    prog.hecho += desde
    for intento in range(8):
        try:
            if desde < tam:
                req = urllib.request.Request(url, headers={"Range": f"bytes={desde}-"})
                with urllib.request.urlopen(req, timeout=60) as r, open(part, "ab" if desde else "wb") as g:
                    if desde and r.status != 206:
                        raise OSError("el servidor no reanuda la descarga")
                    while True:
                        t = time.time()
                        bloque = r.read(1024 * 1024)
                        if not bloque:
                            break
                        g.write(bloque)
                        desde += len(bloque)
                        prog.avance(desde, len(bloque))
                        if limite:
                            time.sleep(max(0.0, len(bloque) / limite - (time.time() - t)))
            if desde == tam:
                os.replace(part, dst)
                return
            raise OSError("descarga incompleta")
        except (OSError, urllib.error.URLError) as e:
            if intento == 7:
                raise
            print(f"\n    corte ({e}); reintento en 15 s…")
            time.sleep(15)


def pendientes_locales(dest):
    lista, saltados = [], []
    if not ORIGEN.is_dir():
        print(f"AVISO: no existe {ORIGEN}; se omiten los originales.")
        return lista, saltados
    ahora = time.time()
    for src in sorted(ORIGEN.rglob("*")):
        if not src.is_file() or src.suffix.lower() not in VIDEO:
            continue
        st = src.stat()
        if ahora - st.st_mtime < RECIENTE_S:
            saltados.append(f"{src.name} (modificado hace poco: puede estar descargándose)")
            continue
        dst = dest / "originales" / src.relative_to(ORIGEN)
        if dst.exists() and dst.stat().st_size == st.st_size:
            continue
        lista.append((src, dst, st.st_size))
    return lista, saltados


def publicadas(cat):
    """(asset, url, id, título) de cada película del catálogo alojada como kp_asset."""
    out = []
    for m in cat["movies"]:
        url = m.get("stream", "")
        nombre = url.rsplit("/", 1)[-1]
        if nombre.startswith("kp_asset_") and nombre.endswith(".mp4"):
            out.append((nombre, url, m["id"], m["title"]))
    return out


def tamano_remoto(url):
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers.get("Content-Length") or 0)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--desde-hf", action="store_true", help="bajar también las películas publicadas desde Hugging Face")
    ap.add_argument("--limite-mbps", type=float, default=0, help="tope de descarga en megabits/s para --desde-hf (0 = sin tope)")
    ap.add_argument("--esperar-fps", action="store_true", help="esperar a que termine arreglar-fps.py antes de empezar")
    ap.add_argument("--simular", action="store_true", help="mostrar qué se copiaría, sin copiar")
    args = ap.parse_args()

    etiqueta = etiqueta_del_disco(DESTINO.anchor)
    if etiqueta is None:
        sys.exit(f"No encuentro el disco {DESTINO.anchor} ¿está conectado?")
    if etiqueta.lower() != ETIQUETA:
        sys.exit(f'{DESTINO.anchor} se llama "{etiqueta}", no "{ETIQUETA}". No escribo ahí.')

    if args.esperar_fps:
        while fps_en_marcha():
            print(f"{datetime.now():%H:%M} arreglar-fps.py sigue en marcha; vuelvo a mirar en 5 min…", flush=True)
            time.sleep(300)

    prioridad_de_fondo()
    cat = json.loads(CATALOG.read_text(encoding="utf-8-sig"))
    pubs = publicadas(cat)

    locales, saltados = pendientes_locales(DESTINO)
    remotas = []
    if args.desde_hf:
        print(f"Comprobando {len(pubs)} películas publicadas contra {DESTINO / 'publicadas'}…")
        for nombre, url, _id, _titulo in pubs:
            dst = DESTINO / "publicadas" / nombre
            if dst.exists():
                # Tamaño exacto: una regrabación a 24 fps conserva el nombre solo si es el mismo archivo.
                try:
                    if dst.stat().st_size == tamano_remoto(url):
                        continue
                except (OSError, urllib.error.URLError):
                    continue
            try:
                remotas.append((url, dst, tamano_remoto(url)))
            except (OSError, urllib.error.URLError) as e:
                saltados.append(f"{nombre} (no responde en HF: {e})")

    total = sum(t for *_, t in locales) + sum(t for *_, t in remotas)
    libre = shutil.disk_usage(DESTINO.anchor).free
    print(f"\nOriginales por copiar: {len(locales)} ({gb(sum(t for *_, t in locales))})")
    if args.desde_hf:
        print(f"Publicadas por bajar:  {len(remotas)} ({gb(sum(t for *_, t in remotas))})")
    print(f"Libre en {DESTINO.anchor} {gb(libre)}")
    for s in saltados:
        print(f"  saltado: {s}")
    if total + MARGEN_LIBRE > libre:
        sys.exit("No cabe en el disco. No copio nada.")
    if args.simular:
        for src, _dst, tam in locales:
            print(f"  copiaría {src.name} ({gb(tam)})")
        for _url, dst, tam in remotas:
            print(f"  bajaría  {dst.name} ({gb(tam)})")
        return

    # El catálogo y el índice primero: pesan nada y son lo que permite reconstruir el resto.
    (DESTINO / "catalogos").mkdir(parents=True, exist_ok=True)
    shutil.copy2(CATALOG, DESTINO / "catalog.json")
    shutil.copy2(CATALOG, DESTINO / "catalogos" / f"catalog-{datetime.now():%Y%m%d-%H%M}.json")
    with open(DESTINO / "indice.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["asset", "id", "titulo"])
        w.writerows((n, i, t) for n, _u, i, t in pubs)
    print(f"Catálogo ({len(cat['movies'])} películas) e índice copiados.\n")

    prog = Progreso(len(locales) + len(remotas), total)
    fallos = []
    for src, dst, tam in locales:
        prog.archivo(src.name, tam)
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            copiar(src, dst, prog)
        except OSError as e:
            # Abierto en exclusiva por otro programa, o desapareció: se deja para la próxima pasada.
            fallos.append(f"{src.name}: {e}")
        prog.fin()
    limite = args.limite_mbps * 1_000_000 / 8
    for url, dst, tam in remotas:
        prog.archivo(dst.name, tam)
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            descargar(url, dst, tam, prog, limite)
        except (OSError, urllib.error.URLError) as e:
            fallos.append(f"{dst.name}: {e}")
        prog.fin()

    print(f"\nListo en {(time.time() - prog.inicio) / 60:.0f} min. Copiado: {gb(prog.hecho)}.")
    if fallos:
        print(f"{len(fallos)} sin copiar (vuelve a correr el script para reintentar):")
        for f in fallos:
            print(f"  {f}")
        sys.exit(1)


if __name__ == "__main__":
    main()
