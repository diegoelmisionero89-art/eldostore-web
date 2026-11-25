/* ==========================================================================
   ELDOSTORE — Panel: varias fotos por producto propio (migración 018)
   - Mismo mecanismo que el portal de las tiendas asociadas: al elegir fotos
     (una o varias, desde la computadora o el celular) cada una se optimiza con
     optimizarImagen() (la compresión publicada: WebP, máx. 1200 px) y se sube.
   - La primera foto es la PORTADA (products.foto, la que se ve en el catálogo,
     el carrito y al compartir). Las demás son adicionales (producto_fotos).
   - Agregar fotos NUNCA reemplaza las que ya tenía el producto: se suman.
   - Ordenar (◀ ▶), elegir otra portada o quitar: se aplica recién al «Guardar».
   - Si la migración 018 no está instalada, el formulario muestra el campo de
     una sola foto de siempre y guarda exactamente como antes.
   ========================================================================== */
const FOTOS_MAX = 12;
let FOTOS_P = null;   // { activa, productId, lista: [urls], original: [urls], subiendo }

function campoFotosProducto(p, campoAnterior) {
  FOTOS_P = { activa: false, productId: p ? p.id : null, lista: [], original: [], subiendo: 0 };
  setTimeout(() => iniciarFotosProducto(p), 0);
  return `<div class="field" id="fpCampo">
    <label>Fotos del producto</label>
    <div id="fpGaleria"><p class="muted-sm">Cargando fotos…</p></div>
    <div id="fpAnterior" hidden>${campoAnterior}</div>
  </div>`;
}

async function iniciarFotosProducto(p) {
  const est = FOTOS_P;
  let datos = { portada: p ? p.foto : '', adicionales: [] };
  try {
    if (p) datos = await rpcCuentas('fotos_producto', { p_product_id: p.id });
    else await rpcCuentas('fotos_producto', { p_product_id: '00000000-0000-0000-0000-000000000000' });   // ¿está instalada?
  } catch (e) {
    if (FOTOS_P !== est) return;
    // Sin la migración 018 (o sin conexión): el campo de una sola foto, como siempre.
    const g = document.getElementById('fpGaleria'), a = document.getElementById('fpAnterior');
    if (g) g.remove(); if (a) a.hidden = false;
    const l = document.querySelector('#fpCampo > label'); if (l) l.remove();
    return;
  }
  if (FOTOS_P !== est || !document.getElementById('fpGaleria')) return;
  const lista = [datos.portada, ...(datos.adicionales || [])].filter(Boolean);
  Object.assign(est, { activa: true, lista: lista.slice(), original: lista.slice() });
  const a = document.getElementById('fpAnterior'); if (a) a.remove();
  dibujarFotosProducto();
}

function dibujarFotosProducto() {
  const g = document.getElementById('fpGaleria'); if (!g || !FOTOS_P) return;
  const f = FOTOS_P.lista, n = f.length;
  g.innerHTML = `
    <div class="fp-grid">${n ? f.map((u, i) => `
      <div class="fp-foto${i === 0 ? ' fp-portada' : ''}">
        ${i === 0 ? '<span class="fp-badge">Portada</span>' : ''}
        <img src="${esc(u)}" alt="Foto ${i + 1}" loading="lazy">
        <div class="fp-acc">
          <button type="button" class="btn btn-sm" onclick="moverFotoProducto(${i}, -1)" ${i ? '' : 'disabled'} aria-label="Mover la foto ${i + 1} antes">◀</button>
          <button type="button" class="btn btn-sm" onclick="moverFotoProducto(${i}, 1)" ${i < n - 1 ? '' : 'disabled'} aria-label="Mover la foto ${i + 1} después">▶</button>
          ${i ? `<button type="button" class="btn btn-sm" onclick="portadaFotoProducto(${i})">Portada</button>` : ''}
          <button type="button" class="btn btn-sm btn-danger" onclick="quitarFotoProducto(${i})" aria-label="Quitar la foto ${i + 1}">Quitar</button>
        </div>
      </div>`).join('') : '<p class="muted-sm">Este producto todavía no tiene fotos.</p>'}
      ${FOTOS_P.subiendo ? Array.from({ length: FOTOS_P.subiendo }, () => '<div class="fp-foto fp-cargando"><span>Optimizando y subiendo…</span></div>').join('') : ''}
    </div>
    <div class="fp-pie">
      <label class="btn btn-sm${n + FOTOS_P.subiendo >= FOTOS_MAX ? ' disabled' : ''}" for="fpArchivos">+ Agregar fotos</label>
      <input type="file" id="fpArchivos" accept="image/jpeg,image/png,image/webp" multiple hidden
        ${n + FOTOS_P.subiendo >= FOTOS_MAX ? 'disabled' : ''} onchange="agregarFotosProducto(this.files); this.value = ''">
      <small class="muted-sm">${n} de ${FOTOS_MAX} fotos · podés elegir varias a la vez · la primera es la portada · se optimizan solas antes de subir.
        Los cambios se aplican al tocar <b>Guardar</b>.</small>
      <p class="fp-error" id="fpError" role="alert" hidden></p>
    </div>`;
  const b = document.getElementById('saveProductBtn');
  if (b && b.textContent !== 'Guardando...') b.disabled = FOTOS_P.subiendo > 0;
}

function errorFotosProducto(m) {
  const e = document.getElementById('fpError'); if (!e) return;
  e.textContent = m; e.hidden = !m;
}

async function agregarFotosProducto(archivos) {
  if (!FOTOS_P || !FOTOS_P.activa) return;
  const est = FOTOS_P;
  const lugar = FOTOS_MAX - est.lista.length - est.subiendo;
  const lista = Array.from(archivos || []).slice(0, Math.max(0, lugar));
  const errores = [];
  if ((archivos || []).length > lista.length) errores.push(`Cada producto puede tener hasta ${FOTOS_MAX} fotos.`);
  await Promise.all(lista.map(async archivo => {
    est.subiendo++; dibujarFotosProducto();
    try {
      const img = await optimizarImagen(archivo, 'producto');   // la compresión publicada (js/imagenes.js)
      const ext = ['webp', 'jpg', 'jpeg', 'png'].includes(img.ext) ? img.ext : null;
      if (!ext) throw new Error('Formato de imagen no admitido. Usá JPG, PNG o WebP.');
      const azar = Math.random().toString(36).slice(2, 12).padEnd(6, '0');
      const nombre = `${Date.now()}-${azar}.${ext}`;
      const { error } = await sb.storage.from('productos-fotos').upload(nombre, img.blob, { contentType: img.mime, cacheControl: '31536000', upsert: false });
      if (error) throw new Error('No se pudo subir «' + archivo.name + '»: ' + (error.message || 'error'));
      if (FOTOS_P === est) est.lista.push(sb.storage.from('productos-fotos').getPublicUrl(nombre).data.publicUrl);
    } catch (e) {
      errores.push(e && e.message ? e.message : 'No se pudo subir una foto.');
    } finally {
      est.subiendo--; if (FOTOS_P === est) dibujarFotosProducto();
    }
  }));
  if (FOTOS_P === est) errorFotosProducto(errores.join(' '));
}

function moverFotoProducto(i, d) {
  const f = FOTOS_P.lista, j = i + d; if (j < 0 || j >= f.length) return;
  [f[i], f[j]] = [f[j], f[i]]; dibujarFotosProducto();
}
function portadaFotoProducto(i) {
  const f = FOTOS_P.lista; f.unshift(f.splice(i, 1)[0]); dibujarFotosProducto();
}
function quitarFotoProducto(i) {
  const f = FOTOS_P.lista;
  if (i === 0 && f.length === 1 && !confirm('¿Quitar la única foto? El producto va a quedar sin foto en la tienda.')) return;
  f.splice(i, 1); dibujarFotosProducto();
}

/* Para saveProduct(): ¿hay que usar la galería? ¿cambió algo? */
function galeriaProductoActiva() { return !!(FOTOS_P && FOTOS_P.activa); }
function fotosProductoSubiendo() { return FOTOS_P ? FOTOS_P.subiendo : 0; }
function portadaProductoNueva() { return FOTOS_P && FOTOS_P.lista[0] || ''; }
async function guardarFotosProducto(productId) {
  if (!galeriaProductoActiva()) return;
  const f = FOTOS_P.lista;
  if (f.join('\n') === FOTOS_P.original.join('\n') && FOTOS_P.productId) return;   // sin cambios
  const r = await rpcCuentas('guardar_fotos_producto', { p_product_id: productId, p_portada: f[0] || '', p_adicionales: f.slice(1) });
  const p = DB.products.find(x => x.id === productId);
  if (p && r) p.foto = r.portada || '';
}
