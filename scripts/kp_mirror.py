"""Subida doble: copia al dataset espejo un vídeo recién subido al principal.

    from kp_mirror import espejar
    espejar("kp_asset_xxxxxxxxxx.mp4")

La copia es del lado del servidor. Sin HF_BACKUP_REPO / HF_BACKUP_TOKEN (entorno o .env) no
hace nada, y un fallo aquí nunca tumba la subida: `python scripts/mirror-hf-backup.py` pone
al día después lo que se haya quedado atrás.
"""
import os
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PRINCIPAL = "Criss-paz/kp-media-vault"


def _env(nombre):
    val = os.getenv(nombre)
    if val:
        return val
    f = REPO / ".env"
    if f.exists():
        m = re.search(rf"^\s*{nombre}\s*=\s*(\S+)", f.read_text(encoding="utf-8", errors="ignore"), re.M)
        if m:
            return m.group(1).strip("\"'")
    return None


def espejar(nombre):
    espejo, token = _env("HF_BACKUP_REPO"), _env("HF_BACKUP_TOKEN")
    if not espejo or not token:
        return False
    try:
        from huggingface_hub import HfApi

        HfApi(token=token).copy_files(f"hf://datasets/{PRINCIPAL}/{nombre}", f"hf://datasets/{espejo}/{nombre}")
        print(f"   Espejo: {nombre} copiado a {espejo}", flush=True)
        return True
    except Exception as e:
        print(f"   AVISO: {nombre} no llegó al espejo ({type(e).__name__}: {e}). Corre scripts/mirror-hf-backup.py luego.", flush=True)
        return False
