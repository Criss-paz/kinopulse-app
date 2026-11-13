#!/usr/bin/env python3
"""Emergencia: apunta el catálogo al espejo (o de vuelta al dataset principal).

    python scripts/switch-cdn.py espejo          # el principal cayó: servir desde el espejo
    python scripts/switch-cdn.py principal       # volver al principal
    python scripts/switch-cdn.py espejo --simular

Solo cambia el dataset dentro de la URL de cada `stream` de src/data/catalog.json. Antes de
cambiar comprueba que cada vídeo existe en el destino; el que no esté se deja como está y se
avisa. --sin-verificar se salta esa comprobación (cambio instantáneo, a ciegas).

El espejo sale de --repo, o de HF_BACKUP_REPO (entorno o .env).

El cambio queda en el archivo local: para que llegue a las apps hay que publicar,

    git add src/data/catalog.json && git commit -m "catálogo: servir desde el espejo" && git push origin HEAD:main
"""
import argparse
import importlib.util
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PRINCIPAL = "Criss-paz/kp-media-vault"
BASE = "https://huggingface.co/datasets/{}/resolve/main/"


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


def save_catalog():
    # El mismo candado que usan los scripts de subida y arreglar-fps.py, que pueden estar corriendo.
    spec = importlib.util.spec_from_file_location("arreglar_fps", REPO / "scripts" / "arreglar-fps.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.save_catalog


def en_destino(repo):
    from huggingface_hub import HfApi

    api = HfApi(token=env("HF_BACKUP_TOKEN") or env("HF_TOKEN"))
    return {f.path for f in api.list_repo_tree(repo, repo_type="dataset")}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("destino", choices=["espejo", "principal"])
    ap.add_argument("--repo", help="dataset espejo (por defecto HF_BACKUP_REPO)")
    ap.add_argument("--sin-verificar", action="store_true", help="no comprobar que los vídeos existen en el destino")
    ap.add_argument("--simular", action="store_true", help="contar qué cambiaría, sin escribir")
    args = ap.parse_args()

    espejo = args.repo or env("HF_BACKUP_REPO")
    if not espejo:
        sys.exit("No sé cuál es el espejo: pasa --repo Cuenta/dataset o define HF_BACKUP_REPO.")
    hacia, desde = (espejo, PRINCIPAL) if args.destino == "espejo" else (PRINCIPAL, espejo)
    base_desde, base_hacia = BASE.format(desde), BASE.format(hacia)

    existen = None
    if not args.sin_verificar:
        try:
            existen = en_destino(hacia)
        except Exception as e:
            sys.exit(f"No puedo leer {hacia} ({type(e).__name__}: {e}). ¿Existe y responde? Con --sin-verificar se cambia a ciegas.")

    cambiados, faltan = [], []

    def mutar(cat):
        cambiados.clear()
        faltan.clear()
        for m in cat["movies"]:
            url = m.get("stream", "")
            if not url.startswith(base_desde):
                continue
            nombre = url[len(base_desde):]
            # Algunas URL llevan ?v=2 para saltarse la caché: el archivo es lo de antes del "?".
            if existen is not None and nombre.split("?")[0] not in existen:
                faltan.append(f"{m['id']} {m['title']} ({nombre})")
                continue
            cambiados.append(m["id"])
            if not args.simular:
                m["stream"] = base_hacia + nombre

    if args.simular:
        import json

        mutar(json.loads((REPO / "src" / "data" / "catalog.json").read_text(encoding="utf-8-sig")))
    else:
        save_catalog()(mutar)

    verbo = "cambiarían" if args.simular else "cambiadas"
    print(f"{len(cambiados)} películas {verbo}: {desde} -> {hacia}")
    if faltan:
        print(f"{len(faltan)} NO están en {hacia} y se quedan como estaban:")
        for f in faltan:
            print(f"  {f}")
    if cambiados and not args.simular:
        print('\nFalta publicar:  git add src/data/catalog.json && git commit -m "catálogo: servir desde ' + args.destino + '" && git push origin HEAD:main')


if __name__ == "__main__":
    main()
