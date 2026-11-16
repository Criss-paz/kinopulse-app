#!/usr/bin/env python3
"""Libera el disco local: borra de la carpeta de Telegram lo que ya está en E:\\ (mismo tamaño)
y no espera subida en ningún lote. Las películas viven solo en el disco de respaldo.

    python scripts/limpiar-local.py            # solo lista
    python scripts/limpiar-local.py --borrar
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ORIGEN = Path(r"C:\Users\DELL\Downloads\Telegram Desktop")
DEST = Path(r"E:\KinoPulse_Backup\originales")
cat = json.loads((REPO / "src/data/catalog.json").read_text(encoding="utf-8-sig"))["movies"]
por_id = {m["id"]: m for m in cat}
por_titulo = {(m["title"], m["year"]): m for m in cat}

pendientes = set()
for ruta in sorted((REPO / "scripts").glob("upload-batch*.py")):
    if ruta.name == "upload-batch10.py":  # la maquinaria; su lista propia es antigua
        continue
    spec = importlib.util.spec_from_file_location(ruta.stem.replace("-", "_"), ruta)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sufijo = mod.lote.SUFIJO_REEMPLAZO
    for archivo, titulo, _b, anio, _c, _s, rid in mod.lote.BATCH:
        if rid:
            # Reemplazo: hecho solo si el catálogo ya sirve el asset nuevo de este lote.
            clave = hashlib.sha256(f"{titulo.lower().strip()}_{anio}{sufijo}".encode()).hexdigest()[:10]
            hecho = clave in por_id[rid]["stream"]
        else:
            m = por_titulo.get((titulo, anio))
            hecho = bool(m and "huggingface.co" in m["stream"])
        if not hecho:
            pendientes.add(archivo)

borrar, quedan = [], []
for p in sorted(ORIGEN.iterdir()):
    if p.suffix.lower() not in (".mp4", ".mkv", ".avi"):
        continue
    d = DEST / p.name
    if p.name in pendientes:
        quedan.append((p, "espera subida"))
    elif not d.exists() or d.stat().st_size != p.stat().st_size:
        quedan.append((p, "no está (completa) en E:"))
    else:
        borrar.append(p)

gb = sum(p.stat().st_size for p in borrar) / 2**30
print(f"Se pueden borrar {len(borrar)} ({gb:.1f} GB); se quedan {len(quedan)}")
for p, por in quedan:
    print("  queda:", p.name, "->", por)
if "--borrar" in sys.argv:
    for p in borrar:
        p.unlink()
    print("Borradas.")
else:
    for p in borrar:
        print("  borraría:", p.name)
