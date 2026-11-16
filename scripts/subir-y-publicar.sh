#!/usr/bin/env bash
# Sube uno o varios lotes, uno detrás de otro, y va publicando el catálogo según avanza, para que cada película aparezca
# en la app en cuanto termina de subir (y no al final de todo el lote).
#
#   bash scripts/subir-y-publicar.sh scripts/upload-batch22.py [scripts/upload-batch23.py ...]
#
# El registro queda en upload-lote.log. Es reanudable: se vuelve a lanzar y sigue donde iba.
cd "$(dirname "$0")/.." || exit 1
[ $# -gt 0 ] || { echo "Falta el script del lote"; exit 1; }
export PYTHONIOENCODING=utf-8
if [ -z "$HF_TOKEN" ] && [ -f .env ]; then
  HF_TOKEN="$(sed -n 's/^[[:space:]]*HF_TOKEN[[:space:]]*=[[:space:]]*//p' .env | head -1 | tr -d '\r')"
  export HF_TOKEN
fi
[ -n "$HF_TOKEN" ] || { echo "Falta HF_TOKEN: ponlo en el entorno o en .env."; exit 1; }

publicar() {
  git diff --quiet -- src/data/catalog.json && return
  python -c "import json;json.load(open('src/data/catalog.json',encoding='utf-8-sig'))" || return
  git commit -q -m "chore(catalogo): películas nuevas del lote" -m "Co-Authored-By: Claude <noreply@anthropic.com>" -- src/data/catalog.json &&
    git push -q origin HEAD && git push -q origin HEAD:main && echo "--- catálogo publicado $(date '+%F %T')"
}

(while sleep 600; do publicar; done) &
VIGIA=$!
trap 'kill $VIGIA 2>/dev/null' EXIT

for LOTE in "$@"; do
  for vuelta in 1 2 3; do
    echo "=== $LOTE, pasada $vuelta  $(date '+%F %T') ==="
    python -u "$LOTE" 2>&1 | tee .pasada.tmp
    grep -q "Lote terminado: 0/" .pasada.tmp && break
  done
done
rm -f .pasada.tmp
publicar
echo "=== Fin $(date '+%F %T') ==="
