#!/usr/bin/env python3
"""ELDOSTORE — Direcciones públicas de las tiendas asociadas: /vendedores/<tienda>/

Genera vendedores/<tienda>/index.html para cada tienda asociada PUBLICADA, con metadatos
Open Graph propios (nombre, descripción y logo) para que el enlace se vea bien en WhatsApp
y Facebook. Quien abre la dirección pasa enseguida a la tienda: <base>#tiendas/<tienda>.

- Lee SOLO la función pública mkt_tienda_publica() (migración 008), con la clave publicable
  de index.html. No escribe nada en Supabase.
- Si el Marketplace está APAGADO, no se publica ninguna dirección: se quitan las páginas que
  generó este script (nunca otras).
- Si la función no existe o responde con error, se detiene SIN tocar nada.
"""
import argparse, html, json, os, re, shutil, sys, urllib.request, urllib.error

SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
URL_OK = re.compile(r"^https://[^\s\"'<>]+$")
MARCA = '<meta name="eldostore-tienda"'


def leer_config(index_html):
    s = open(index_html, encoding="utf-8").read()
    url = re.search(r"supabaseUrl:\s*'([^']+)'", s)
    key = re.search(r"supabaseKey:\s*'([^']+)'", s)
    if not url or not key:
        sys.exit("No encontré supabaseUrl/supabaseKey en index.html")
    return url.group(1).rstrip("/"), key.group(1)


def leer_tiendas(url, key):
    pedido = urllib.request.Request(url + "/rest/v1/rpc/mkt_tienda_publica", data=b"{}", method="POST",
                                    headers={"apikey": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(pedido, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:   # la migración 008 todavía no está instalada: no hay nada que publicar
            print("mkt_tienda_publica() no existe todavía (falta la migración 008): no se cambia nada.")
            sys.exit(0)
        sys.exit(f"mkt_tienda_publica() respondió {e.code}: no se cambia nada. {e.read()[:200]!r}")


def pagina(v, url_tienda, destino, imagen):
    a = lambda x: html.escape(str(x), quote=True)
    n = v["productos"]
    desc = (v["descripcion"] or f"Tienda asociada a ELDOSTORE{(' en ' + v['localidad']) if v['localidad'] else ''}.")[:200]
    desc += f" · {n} producto{'' if n == 1 else 's'} · Tiendas asociadas de ELDOSTORE"
    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{a(v['nombre'])} | Tiendas asociadas | ELDOSTORE</title>
<meta name="description" content="{a(desc)}">
<link rel="canonical" href="{a(url_tienda)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ELDOSTORE">
<meta property="og:locale" content="es_AR">
<meta property="og:title" content="{a(v['nombre'])} · Tiendas asociadas de ELDOSTORE">
<meta property="og:description" content="{a(desc)}">
<meta property="og:url" content="{a(url_tienda)}">
<meta property="og:image" content="{a(imagen)}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#080808">
<meta name="eldostore-tienda" content="{a(v['slug'])}">
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#080808;color:#fff;font:16px/1.5 Arial,Helvetica,sans-serif;text-align:center}}b{{color:#f4c84f}}a{{color:#f4c84f}}</style>
<script>location.replace({json.dumps(destino)});</script>
</head>
<body>
<p>Abriendo la tienda <b>{a(v['nombre'])}</b> en ELDOSTORE…<br><a href="{a(destino)}">Ver la tienda</a></p>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="Raíz del sitio, p. ej. https://eldostore.com.ar/")
    ap.add_argument("--pagina", default="", help='"" en el dominio oficial; "index.html" en una prueba')
    ap.add_argument("--salida", default=".", help="Carpeta del repositorio")
    ap.add_argument("--entrada", help="JSON de mkt_tienda_publica() (solo para pruebas locales)")
    ap.add_argument("--resumen", help="Archivo donde agregar el resumen (GITHUB_STEP_SUMMARY)")
    o = ap.parse_args()
    base = o.base.rstrip("/") + "/"
    datos = json.load(open(o.entrada, encoding="utf-8")) if o.entrada else leer_tiendas(*leer_config(os.path.join(o.salida, "index.html")))
    if not isinstance(datos, dict) or "activo" not in datos:
        sys.exit("mkt_tienda_publica() devolvió un formato inesperado: no se cambia nada.")

    hechos = set()
    carpeta = os.path.join(o.salida, "vendedores")
    if datos.get("activo") is True:
        for r in datos.get("vendedores") or []:
            slug = str(r.get("slug") or "")
            if not SLUG.match(slug) or len(slug) > 60 or not int(r.get("productos") or 0):
                continue                     # solo tiendas con productos publicados (como en la tienda)
            v = {"slug": slug, "nombre": re.sub(r"\s+", " ", str(r.get("nombre") or "Tienda")).strip()[:80],
                 "descripcion": re.sub(r"\s+", " ", str(r.get("descripcion") or "")).strip(),
                 "localidad": re.sub(r"\s+", " ", str(r.get("localidad") or "")).strip()[:80],
                 "productos": int(r.get("productos") or 0)}
            logo = str(r.get("logo") or "").strip()
            imagen = logo if URL_OK.match(logo) else base + "img/banner-tecnologia.jpg"
            d = os.path.join(carpeta, slug)
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
                f.write(pagina(v, base + "vendedores/" + slug + "/" + o.pagina, base + o.pagina + "#tiendas/" + slug, imagen))
            hechos.add(slug)

    quitadas = []
    if os.path.isdir(carpeta):
        for nombre in sorted(os.listdir(carpeta)):
            archivo = os.path.join(carpeta, nombre, "index.html")
            if nombre in hechos or not os.path.isfile(archivo):
                continue
            if MARCA in open(archivo, encoding="utf-8").read():
                shutil.rmtree(os.path.join(carpeta, nombre)); quitadas.append(nombre)
        if not os.listdir(carpeta):
            os.rmdir(carpeta)

    texto = ["## Tiendas asociadas: direcciones /vendedores/", "",
             f"- Marketplace: {'encendido' if datos.get('activo') else 'APAGADO (no se publica ninguna dirección)'}",
             f"- Páginas generadas: **{len(hechos)}**",
             f"- Quitadas: {len(quitadas)}" + (f" ({', '.join(quitadas)})" if quitadas else "")]
    print("\n".join(texto))
    if o.resumen:
        with open(o.resumen, "a", encoding="utf-8") as f: f.write("\n".join(texto) + "\n")


if __name__ == "__main__":
    main()
