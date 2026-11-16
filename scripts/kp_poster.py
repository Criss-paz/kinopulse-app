"""Póster y fondo de una película desde la web pública de TMDB (sin API key).

    from kp_poster import buscar
    poster, fondo = buscar("The Fast and the Furious", 2001)     # o None si no hay coincidencia segura

  python scripts/kp_poster.py "The Fast and the Furious" 2001   # dice cuál elige
  python scripts/kp_poster.py "tmdb:1075794" 2023                # una ficha concreta de TMDB
  python scripts/kp_poster.py --repetidos                        # películas del catálogo que comparten póster

Quedarse con el primer resultado de la búsqueda trae el póster de otra película cuando hay varias
con nombre parecido (Rápido y furioso salió con el de Reto Tokio; Leo, con el de otra Leo). Aquí
se abren los primeros resultados y gana el que coincide en título y año.
"""
import html
import json
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

WEB = "https://www.themoviedb.org"


def _abrir(url):
    # Sin cabeceras propias: con un User-Agent de navegador TMDB responde 403.
    with urllib.request.urlopen(url, timeout=15) as r:
        return r.read().decode("utf-8", "ignore")


def _norma(texto):
    texto = unicodedata.normalize("NFKD", html.unescape(texto)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", texto.replace("&", " and ")).strip()


def candidatos(titulo, anio):
    """[(puntos, id, título, año)] de los primeros resultados, el mejor primero."""
    pagina = _abrir(f"{WEB}/search/movie?query={urllib.parse.quote(titulo)}&year={anio}")
    ids = list(dict.fromkeys(re.findall(r'href="/movie/(\d+)', pagina)))[:6]
    res = []
    for orden, mid in enumerate(ids):
        try:
            m = re.search(r"<title>(.*?) \((\d{4})\)", _abrir(f"{WEB}/movie/{mid}?language=en-US"))
        except Exception:
            continue
        if not m:
            continue
        nombre, estreno = m.group(1), int(m.group(2))
        puntos = (3 if _norma(nombre) == _norma(titulo) else 0) + (2 if estreno == anio else 1 if abs(estreno - anio) == 1 else 0)
        res.append((puntos, -orden, mid, html.unescape(nombre), estreno))
    return [(p, mid, n, a) for p, _, mid, n, a in sorted(res, reverse=True)]


def buscar(titulo, anio, detalle=False):
    try:
        if titulo.lower().startswith("tmdb:"):
            # Para las que no se pueden distinguir por título y año: "tmdb:1075794" va directo a esa ficha.
            mid, nombre, estreno = titulo[5:].strip(), "elegida a mano", anio
        else:
            cand = candidatos(titulo, anio)
            # Menos de 4 puntos = no coincide el título o el año se va más de uno. Y si las dos primeras
            # empatan (dos «Leo» de 2023) no hay forma de saber cuál es: mejor sin póster que con el de otra.
            if not cand or cand[0][0] < 4 or (len(cand) > 1 and cand[1][0] == cand[0][0]):
                return None
            _, mid, nombre, estreno = cand[0]
        imgs = re.findall(r'og:image" content="[^"]*/t/p/w\d+/([A-Za-z0-9]+\.jpg)', _abrir(f"{WEB}/movie/{mid}?language=es-MX"))
        if not imgs:
            return None
        par = (f"https://image.tmdb.org/t/p/w780/{imgs[0]}", f"https://image.tmdb.org/t/p/w1280/{imgs[-1]}")
        return (*par, f"{nombre} ({estreno}), TMDB {mid}") if detalle else par
    except Exception:
        return None


def repetidos(catalogo=Path(__file__).resolve().parent.parent / "src/data/catalog.json"):
    vistos = {}
    for m in json.loads(Path(catalogo).read_text(encoding="utf-8-sig"))["movies"]:
        vistos.setdefault(m.get("poster", ""), []).append(f'{m["id"]} {m["title"]}')
    return [v for k, v in vistos.items() if len(v) > 1 or "image.tmdb.org" not in k]


if __name__ == "__main__":
    if "--repetidos" in sys.argv:
        dudosos = repetidos()
        for grupo in dudosos:
            print("Mismo póster o póster genérico:", " | ".join(grupo))
        print("Nada raro." if not dudosos else "")
    elif len(sys.argv) == 3:
        print(buscar(sys.argv[1], int(sys.argv[2]), detalle=True) or "Sin coincidencia segura: pon el póster a mano.")
        if not sys.argv[1].lower().startswith("tmdb:"):
            for c in candidatos(sys.argv[1], int(sys.argv[2])):
                print("  ", c)
    else:
        sys.exit(__doc__)
