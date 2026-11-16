#!/usr/bin/env python3
"""Comprobación de privacidad del repositorio público de ELDOSTORE.

Falla (código 1) si encuentra algo que no debe publicarse:
  * archivos de inventario, respaldos, migraciones SQL, planillas o guías internas;
  * listados de productos con su costo (un costo distinto de 0 junto a código, nombre,
    precio o stock, como en un inventario);
  * claves secretas de Supabase (service_role, sb_secret_), conexiones a la base,
    contraseñas, tokens de GitHub o claves privadas;
  * emails, o teléfonos que no sean los 2 números públicos de pedidos por WhatsApp.

Uso:  python3 herramientas/comprobar-privacidad.py [carpeta]   (por defecto, la actual)
Solo lee archivos; no usa internet ni dependencias externas.
"""
import base64
import json
import os
import re
import sys

RAIZ = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")

# Lo ÚNICO que este repositorio puede contener (todo lo demás se rechaza).
PERMITIDOS_EXACTOS = {
    "index.html", "admin.html", "admin.css", "404.html", "CNAME", "README.md", "vendedor.html",
    "css/tienda.css", "herramientas/generar-fichas.py", "herramientas/generar-vendedores.py",
    "herramientas/comprobar-privacidad.py",
    ".github/workflows/fichas-compartir.yml", ".github/workflows/comprobar-privacidad.yml",
}
PERMITIDOS_PATRON = [
    re.compile(r"^js/[a-z0-9-]+\.js$"),
    re.compile(r"^img/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|svg|ico)$"),
    re.compile(r"^p/fotos\.json$"),
    re.compile(r"^p/[A-Za-z0-9-]+/index\.html$"),
    re.compile(r"^p/[A-Za-z0-9-]+/foto\.jpg$"),
    re.compile(r"^vendedores/[a-z0-9]+(-[a-z0-9]+)*/index\.html$"),   # tiendas asociadas (Marketplace)
]
NOMBRES_PROHIBIDOS = re.compile(
    r"(inventario|respaldo|backup|dump|migracion|\.sql$|\.csv$|\.xlsx?$|\.ods$|\.env|\.pem$|\.key$|\.bundle$)",
    re.I)

TELEFONOS_PUBLICOS = {"5493757613059", "5493751366502"}  # pedidos por WhatsApp (index.html)

REGLAS = [
    ("clave secreta de Supabase", re.compile(r"sb_secret_[A-Za-z0-9_-]{8,}")),
    ("conexión a la base", re.compile(r"postgres(ql)?://[^\s\"'<>]+", re.I)),
    ("contraseña o token asignado", re.compile(
        r"""\b(password|passwd|contrase(ñ|n)a|secret|token|api[_-]?key|service[_-]?role)\b\s*[:=]\s*["'][^"'\s]{6,}["']""", re.I)),
    ("token de GitHub", re.compile(r"\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b")),
    ("clave privada", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("email", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
]
# Costo de producto: clave de costo con un número distinto de 0 y, a menos de 200 caracteres,
# otra clave de producto (código, nombre, precio o stock). Así se detecta un inventario y no las
# tarifas de envío (min/max/costo) ni los contadores del panel que empiezan en 0.
COSTO = re.compile(r"""["']?\b(costo|costoUnit|costo_unit|costo_total|cost)\b["']?\s*[:=]\s*["']?([1-9][\d.]*)""", re.I)
CLAVE_PRODUCTO = re.compile(r"""["']?\b(codigo|nombre|precio|precioVenta|stock|stockMin|productoId)\b["']?\s*:""", re.I)
JWT = re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}")
TELEFONO = re.compile(r"\b549?\d{10}\b")
# Emails permitidos: ninguno real; solo el del bot de GitHub en el workflow de fichas.
EMAILS_PERMITIDOS = {"41898282+github-actions[bot]@users.noreply.github.com"}


def permitido(ruta):
    return ruta in PERMITIDOS_EXACTOS or any(p.match(ruta) for p in PERMITIDOS_PATRON)


def main():
    problemas = []
    revisados = 0
    for carpeta, subcarpetas, archivos in os.walk(RAIZ):
        subcarpetas[:] = [d for d in subcarpetas if d != ".git"]
        for nombre in archivos:
            ruta = os.path.relpath(os.path.join(carpeta, nombre), RAIZ).replace(os.sep, "/")
            revisados += 1
            if NOMBRES_PROHIBIDOS.search(ruta):
                problemas.append(f"{ruta}: nombre de archivo no permitido en el sitio público")
            if not permitido(ruta):
                problemas.append(f"{ruta}: no está en la lista de archivos que publica la tienda")
            datos = open(os.path.join(carpeta, nombre), "rb").read()
            if b"\0" in datos[:4096]:
                continue  # imagen u otro binario
            texto = datos.decode("utf-8", "replace")
            for etiqueta, regla in REGLAS:
                for m in regla.finditer(texto):
                    valor = m.group(0)
                    if etiqueta == "email" and valor in EMAILS_PERMITIDOS:
                        continue
                    linea = texto.count("\n", 0, m.start()) + 1
                    problemas.append(f"{ruta}:{linea}: {etiqueta}")
            for m in COSTO.finditer(texto):
                cerca = texto[max(0, m.start() - 200): m.end() + 200]
                if CLAVE_PRODUCTO.search(cerca):
                    linea = texto.count("\n", 0, m.start()) + 1
                    problemas.append(f"{ruta}:{linea}: costo de producto (dato de inventario)")
            for m in JWT.finditer(texto):
                try:
                    carga = m.group(1) + "=" * (-len(m.group(1)) % 4)
                    rol = json.loads(base64.urlsafe_b64decode(carga)).get("role", "?")
                except Exception:
                    rol = "?"
                if rol != "anon":
                    linea = texto.count("\n", 0, m.start()) + 1
                    problemas.append(f"{ruta}:{linea}: clave JWT con rol «{rol}» (solo se permite la pública «anon»)")
            for m in TELEFONO.finditer(texto):
                if m.group(0) not in TELEFONOS_PUBLICOS:
                    linea = texto.count("\n", 0, m.start()) + 1
                    problemas.append(f"{ruta}:{linea}: teléfono que no es de los pedidos públicos")
    if problemas:
        print(f"FALLA: {len(problemas)} problema(s) en {revisados} archivos revisados:")
        for p in problemas:
            print("  - " + p)
        return 1
    print(f"OK: {revisados} archivos revisados, sin inventarios, costos, credenciales ni datos privados.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
