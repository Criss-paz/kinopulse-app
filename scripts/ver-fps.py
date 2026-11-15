#!/usr/bin/env python3
"""Muestra en vivo cómo va arreglar-fps.py, leyendo arreglar-fps.log.

    python scripts/ver-fps.py

Solo lee el log: no toca el proceso. Ctrl+C para salir.
"""
import json
import os
import re
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LOG = REPO / "arreglar-fps.log"
CATALOG = REPO / "src" / "data" / "catalog.json"
CADA_S = 2

PELICULA = re.compile(r"^\[(\d+)/(\d+)\] (.+)$")
FFMPEG = re.compile(r"frame=\s*(\d+) fps=\s*([\d.]+).*?time=(\d+):(\d+):([\d.]+).*?speed=\s*([\d.]+)x")
SUBIDA = re.compile(r"Processing Files.*?(\d+)%\|.*?\|\s*([\d.]+\w+)\s*/\s*([\d.]+\w+)(?:,\s*([\d.]+\w+/s))?")


def duraciones():
    try:
        cat = json.loads(CATALOG.read_text(encoding="utf-8-sig"))
        return {m["title"]: m.get("duration", 0) * 60 for m in cat["movies"]}
    except (OSError, ValueError):
        return {}


def hms(s):
    s = int(max(s, 0))
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"


def barra(pct, ancho=40):
    lleno = int(ancho * min(max(pct, 0), 100) / 100)
    return "█" * lleno + "░" * (ancho - lleno)


def main():
    if not LOG.exists():
        sys.exit(f"No existe {LOG}. ¿Está corriendo arreglar-fps.py?")
    os.system("")  # activa los códigos ANSI en la consola de Windows
    dur = duraciones()
    pos = 0
    resto = ""
    n = total = 0
    titulo = ""
    fase = "esperando"
    enc = sub = None
    errores = []
    empezo = None

    while True:
        with open(LOG, "rb") as f:
            f.seek(pos)
            nuevo = f.read()
            pos = f.tell()
        lineas = re.split(r"[\r\n]+", resto + nuevo.decode("utf-8", errors="replace"))
        resto = lineas.pop()  # la última puede estar a medio escribir
        for l in lineas:
            l = l.strip()
            m = PELICULA.match(l)
            if m:
                n, total, titulo = int(m.group(1)), int(m.group(2)), m.group(3)
                fase, enc, sub, empezo = "descargando y codificando", None, None, time.time()
                continue
            m = FFMPEG.search(l)
            if m:
                enc = (float(m.group(2)), int(m.group(3)) * 3600 + int(m.group(4)) * 60 + float(m.group(5)), float(m.group(6)))
                fase = "codificando"
                continue
            m = SUBIDA.search(l)
            if m:
                sub = m.groups()
                fase = "subiendo a Hugging Face"
                continue
            if "ERROR" in l:
                errores.append(l)

        quieto = time.time() - LOG.stat().st_mtime
        out = ["\033[H\033[J" + "Arreglo de fps (30 → 24)", ""]
        if total:
            out.append(f"Película {n} de {total}: {titulo}")
            out.append(f"Total     {barra(100 * (n - 1) / total)} {n - 1} terminadas")
        out.append(f"Fase:     {fase}")
        if fase == "codificando" and enc:
            fps, hecho, vel = enc
            largo = dur.get(titulo, 0)
            if largo:
                falta = (largo - hecho) / vel if vel else 0
                out.append(f"Película  {barra(100 * hecho / largo)} {100 * hecho / largo:.0f}%")
                out.append(f"          {hms(hecho)} de ~{hms(largo)} · {fps:.0f} fps · {vel:.2f}x · faltan ~{hms(falta)}")
            else:
                out.append(f"          {hms(hecho)} codificados · {fps:.0f} fps · {vel:.2f}x")
        elif fase.startswith("subiendo") and sub:
            pct, hecho, de, vel = sub
            out.append(f"Subida    {barra(int(pct))} {pct}%")
            out.append(f"          {hecho} de {de}" + (f" · {vel}" if vel else ""))
        if errores:
            out.append("")
            out.append(f"Errores: {len(errores)} (se reintentan al volver a lanzar el script)")
            out.extend(f"  {e[:110]}" for e in errores[-3:])
        out.append("")
        if quieto > 300:
            out.append(f"AVISO: el log lleva {quieto / 60:.0f} min sin moverse. Puede que el proceso se haya parado.")
        else:
            out.append(f"Actualizado {time.strftime('%H:%M:%S')} · Ctrl+C para salir")
        print("\n".join(out), flush=True)
        try:
            time.sleep(CADA_S)
        except KeyboardInterrupt:
            return


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
