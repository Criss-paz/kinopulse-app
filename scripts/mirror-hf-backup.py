#!/usr/bin/env python3
"""Espejo en la nube: copia kp-media-vault a un segundo dataset de Hugging Face.

    python scripts/mirror-hf-backup.py --simular     # qué falta en el espejo
    python scripts/mirror-hf-backup.py               # sincroniza

La copia es del lado del servidor (no baja ni sube los vídeos por esta máquina):

  - si el espejo no existe, se duplica el dataset entero de una vez;
  - si ya existe, solo se copian los kp_asset_*.mp4 que falten o hayan cambiado de tamaño.

Variables (entorno o .env):

    HF_TOKEN          el de siempre; lee el dataset principal
    HF_BACKUP_REPO    dataset espejo, p. ej. OtraCuenta/kp-media-mirror
                      (por defecto <tu usuario>/kp-media-mirror)
    HF_BACKUP_TOKEN   token con permiso de escritura de la cuenta del espejo
                      (por defecto HF_TOKEN: espejo en la misma cuenta)

Un espejo en la misma cuenta protege de borrar o romper el dataset principal, no de perder
la cuenta. Para eso el espejo tiene que vivir en otra cuenta, con su HF_BACKUP_TOKEN.

Con --por-descarga, lo que el servidor no pueda copiar (otra región de almacenamiento) se
baja y se vuelve a subir de uno en uno; es lento y usa la red, así que no va por defecto.
"""
import argparse
import os
import re
import sys
import tempfile
from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download
from huggingface_hub.utils import HfHubHTTPError, RepositoryNotFoundError

REPO = Path(__file__).resolve().parent.parent
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


def assets(api, repo):
    """{nombre: tamaño} de los kp_asset_*.mp4 del dataset."""
    return {
        f.path: f.size
        for f in api.list_repo_tree(repo, repo_type="dataset")
        if f.path.startswith("kp_asset_") and f.path.endswith(".mp4")
    }


def gb(n):
    return f"{n / 1e9:.1f} GB"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--simular", action="store_true", help="mostrar qué falta, sin copiar")
    ap.add_argument("--por-descarga", action="store_true", help="si el servidor no puede copiar un archivo, bajarlo y subirlo")
    ap.add_argument("--privado", action="store_true", help="crear el espejo privado (la app no podría reproducir desde él)")
    args = ap.parse_args()

    token = env("HF_TOKEN")
    if not token:
        sys.exit("Falta HF_TOKEN (ponlo en el entorno o en .env).")
    destino_token = env("HF_BACKUP_TOKEN") or token
    origen = HfApi(token=token)
    destino = HfApi(token=destino_token)
    espejo = env("HF_BACKUP_REPO") or f"{destino.whoami()['name']}/kp-media-mirror"
    if espejo.lower() == PRINCIPAL.lower():
        sys.exit("HF_BACKUP_REPO es el dataset principal. El espejo tiene que ser otro.")

    en_origen = assets(origen, PRINCIPAL)
    print(f"Principal {PRINCIPAL}: {len(en_origen)} vídeos, {gb(sum(en_origen.values()))}")

    try:
        en_espejo = assets(destino, espejo)
    except RepositoryNotFoundError:
        print(f"El espejo {espejo} no existe todavía: se duplicaría el dataset entero en el servidor.")
        if args.simular:
            return
        r = destino.duplicate_repo(PRINCIPAL, espejo, repo_type="dataset", private=args.privado)
        print(f"Espejo creado: {r}")
        if getattr(r, "files_copy_pending", False):
            print("Hugging Face sigue copiando los vídeos en segundo plano; vuelve a correr con --simular en un rato para comprobarlo.")
        return

    faltan = sorted(n for n, tam in en_origen.items() if en_espejo.get(n) != tam)
    print(f"Espejo    {espejo}: {len(en_espejo)} vídeos, {gb(sum(en_espejo.values()))}")
    print(f"Faltan o cambiaron: {len(faltan)} ({gb(sum(en_origen[n] for n in faltan))})")
    if args.simular or not faltan:
        for n in faltan:
            print(f"  {n}")
        return

    fallos = []
    for i, nombre in enumerate(faltan, 1):
        print(f"[{i}/{len(faltan)}] {nombre} ({gb(en_origen[nombre])})… ", end="", flush=True)
        try:
            destino.copy_files(f"hf://datasets/{PRINCIPAL}/{nombre}", f"hf://datasets/{espejo}/{nombre}")
            print("copiado en el servidor")
            continue
        except (HfHubHTTPError, ValueError) as e:
            if not args.por_descarga:
                print(f"el servidor no pudo: {e}")
                fallos.append(nombre)
                continue
        with tempfile.TemporaryDirectory(dir=REPO) as tmp:
            try:
                local = hf_hub_download(PRINCIPAL, nombre, repo_type="dataset", token=token, local_dir=tmp)
                destino.upload_file(path_or_fileobj=local, path_in_repo=nombre, repo_id=espejo, repo_type="dataset")
                print("bajado y subido")
            except (HfHubHTTPError, OSError) as e:
                print(f"falló: {e}")
                fallos.append(nombre)

    if fallos:
        print(f"\n{len(fallos)} sin copiar. Si es por la región de almacenamiento, repite con --por-descarga.")
        sys.exit(1)
    print("\nEspejo al día.")


if __name__ == "__main__":
    main()
