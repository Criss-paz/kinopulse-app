#!/usr/bin/env python3
"""Borra de Hugging Face los vídeos que ya nadie usa (scripts/.assets-huerfanos.txt).

    python scripts/limpiar-huerfanos.py              # qué borraría
    python scripts/limpiar-huerfanos.py --borrar     # los borra del principal y del espejo

Un vídeo solo se borra si no lo referencia ni el catálogo local ni el publicado (origin/main):
las apps leen el publicado, así que un asset reemplazado sigue en uso hasta que el catálogo
nuevo está en main. Lo borrado sale de la lista; lo que aún está en uso se queda para la próxima.
Borrar es definitivo.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from huggingface_hub import HfApi
from huggingface_hub.utils import EntryNotFoundError, HfHubHTTPError

REPO = Path(__file__).resolve().parent.parent
CATALOG = "src/data/catalog.json"
LISTA = REPO / "scripts" / ".assets-huerfanos.txt"
PRINCIPAL = "Criss-paz/kp-media-vault"


def env(nombre):
    val = os.getenv(nombre)
    if val:
        return val
    f = REPO / ".env"
    if f.exists():
        m = re.search(rf"^\s*{nombre}\s*=\s*(\S+)", f.read_text(encoding="utf-8", errors="ignore"), re.M)
        if m:
            return m.group(1).strip("\"'")
    return None


def en_uso():
    """Assets que sirve el catálogo local o el publicado."""
    subprocess.run(["git", "fetch", "-q", "origin", "main"], cwd=REPO, check=True)
    publicado = subprocess.run(["git", "show", f"origin/main:{CATALOG}"], cwd=REPO, check=True, capture_output=True).stdout
    textos = [(REPO / CATALOG).read_text(encoding="utf-8-sig"), publicado.decode("utf-8-sig")]
    return {a for t in textos for a in re.findall(r"kp_asset_[0-9a-f]+\.mp4", json.dumps(json.loads(t)))}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--borrar", action="store_true", help="borrar de verdad (sin esto solo informa)")
    args = ap.parse_args()

    if not LISTA.exists():
        sys.exit("No hay lista de huérfanos.")
    lineas = [l for l in LISTA.read_text(encoding="utf-8").splitlines() if l.strip()]
    usados = en_uso()
    repos = [(PRINCIPAL, HfApi(token=env("HF_TOKEN")))]
    if env("HF_BACKUP_REPO") and env("HF_BACKUP_TOKEN"):
        repos.append((env("HF_BACKUP_REPO"), HfApi(token=env("HF_BACKUP_TOKEN"))))

    quedan, borradas = [], set()
    for linea in lineas:
        asset = linea.split("\t")[0].strip()
        if not re.fullmatch(r"kp_asset_[0-9a-f]+\.mp4", asset):
            quedan.append(linea)
            continue
        if asset in usados:
            print(f"EN USO, no se toca: {linea}")
            quedan.append(linea)
            continue
        if not args.borrar:
            print(f"borraría: {linea}")
            quedan.append(linea)
            continue
        ok = True
        for repo, api in repos:
            try:
                api.delete_file(asset, repo, repo_type="dataset", commit_message=f"Borrar {asset} (reemplazado)")
                print(f"borrado de {repo}: {linea}")
            except EntryNotFoundError:
                print(f"ya no estaba en {repo}: {asset}")
            except HfHubHTTPError as e:
                print(f"FALLÓ en {repo}: {asset} ({e})")
                ok = False
        if ok:
            borradas.add(linea)
        else:
            quedan.append(linea)

    if args.borrar:
        # arreglar-fps.py puede haber añadido líneas mientras tanto: se relee y solo salen las borradas.
        ahora = [l for l in LISTA.read_text(encoding="utf-8").splitlines() if l.strip()]
        quedan = [l for l in ahora if l not in borradas]
        LISTA.write_text("".join(l + "\n" for l in quedan), encoding="utf-8")
    print(f"\nQuedan {len(quedan)} en la lista.")


if __name__ == "__main__":
    main()
