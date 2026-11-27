/* ==========================================================================
   ELDOSTORE — Panel: «Video del producto» (migración 019)
   1) En Productos → Editar: un video opcional por producto (se achica en el
      navegador con js/videos.js y se publica al guardarlo). Las fotos no cambian.
   2) En Tiendas asociadas → «Videos»: los videos que suben los vendedores,
      para aprobarlos, rechazarlos o eliminarlos (solo el administrador).
   Si la migración 019 no está instalada, no se muestra nada nuevo.
   ========================================================================== */
const BUCKET_VIDEOS = 'productos-videos';
let VIDEOS_019 = null;   // null = sin probar · true/false = migración instalada o no

async function subirArchivoVideo(nombre, blob, mime) {
  const { error } = await sb.storage.from(BUCKET_VIDEOS).upload(nombre, blob, { contentType: mime, cacheControl: '31536000', upsert: false });
  if (error) throw new Error(/exceeded|too large|413/i.test(error.message || '') ? 'El archivo supera el límite de 4 MB.' : (error.message || 'No se pudo subir.'));
  return sb.storage.from(BUCKET_VIDEOS).getPublicUrl(nombre).data.publicUrl;
}
async function borrarArchivosVideo(nombres) {
  const lista = (nombres || []).filter(n => typeof n === 'string' && /^(p|v\/[0-9a-f-]{36})\/[0-9]{10,16}-[a-z0-9]{4,16}\.(mp4|webp|jpg)$/.test(n));
  if (!lista.length) return;
  const { error } = await sb.storage.from(BUCKET_VIDEOS).remove(lista);
  if (error) throw new Error(error.message || 'No se pudo borrar el archivo anterior.');
}

/* ---------- 1. Productos de ELDOSTORE ---------- */
function campoVideoProducto(p) {
  if (VIDEOS_019 === false || !window.EldoVideo) return '';
  setTimeout(() => iniciarVideoProducto(p), 0);
  return `<div class="field" id="vidCampoProd" hidden>
    <label>Video del producto</label>
    <div id="vidProd"></div>
  </div>`;
}
async function iniciarVideoProducto(p) {
  const campo = document.getElementById('vidCampoProd'), cont = document.getElementById('vidProd');
  if (!campo || !cont) return;
  const id = p ? p.id : null;
  if (id) {
    try { await rpcCuentas('video_producto', { p_product_id: id }); VIDEOS_019 = true; }
    catch (e) { if (funcionInexistente(e)) { VIDEOS_019 = false; campo.remove(); return; } }
  } else if (VIDEOS_019 === null) {
    try { await rpcCuentas('mkt_videos_panel', {}); VIDEOS_019 = true; } catch (e) { if (funcionInexistente(e)) { VIDEOS_019 = false; campo.remove(); return; } }
  }
  campo.hidden = false;
  EldoVideo.seccionVideo({
    contenedor: cont, productoId: id, carpeta: 'p',
    clases: { btn: 'btn btn-sm', prim: 'btn btn-primary btn-sm', peligro: 'btn btn-sm btn-danger' },
    leer: () => rpcCuentas('video_producto', { p_product_id: id }),
    subir: subirArchivoVideo,
    guardar: (url, poster, duracion, peso) => rpcCuentas('guardar_video_producto', { p_product_id: id, p_url: url, p_poster: poster, p_duracion: duracion, p_peso: peso }),
    eliminar: () => rpcCuentas('eliminar_video_producto', { p_product_id: id }),
    borrarArchivos: borrarArchivosVideo
  });
}

/* ---------- 1b. Producto de un vendedor, editado por el administrador (Tiendas asociadas → Editar) ----------
   Mismo componente y mismos límites. El archivo va a la carpeta de ESE vendedor y queda aprobado (lo carga ELDOSTORE).
   Si lo subió el vendedor y está pendiente, se puede aprobar desde acá. (migración 020) */
function campoVideoMkt(p) {
  if (VIDEOS_019 === false || !window.EldoVideo) return '';
  setTimeout(() => iniciarVideoMkt(p), 0);
  return `<div class="field" id="vidCampoMkt" hidden>
    <label>Video del producto</label>
    <div id="vidMkt"></div>
  </div>`;
}
async function iniciarVideoMkt(p) {
  const campo = document.getElementById('vidCampoMkt'), cont = document.getElementById('vidMkt');
  if (!campo || !cont) return;
  const id = p ? p.id : null;
  if (id) {
    try { await rpcCuentas('mkt_video_panel', { p_producto_id: id }); }
    catch (e) { if (funcionInexistente(e)) { campo.remove(); return; } }
  }
  campo.hidden = false;
  const refrescarLista = () => { VIDS_MKT.cargado = false; };
  EldoVideo.seccionVideo({
    contenedor: cont, productoId: id, carpeta: p ? 'v/' + p.vendedor_id : '',
    clases: { btn: 'btn btn-sm', prim: 'btn btn-primary btn-sm', peligro: 'btn btn-sm btn-danger' },
    leer: () => rpcCuentas('mkt_video_panel', { p_producto_id: id }),
    subir: subirArchivoVideo,
    guardar: async (url, poster, duracion, peso) => { const r = await rpcCuentas('mkt_guardar_video_admin', { p_producto_id: id, p_url: url, p_poster: poster, p_duracion: duracion, p_peso: peso }); refrescarLista(); return r; },
    eliminar: async () => { const r = await rpcCuentas('mkt_eliminar_video', { p_producto_id: id }); refrescarLista(); return r; },
    aprobar: async () => { await rpcCuentas('mkt_revisar_video', { p_producto_id: id, p_estado: 'aprobado', p_motivo: '' }); refrescarLista(); },
    borrarArchivos: borrarArchivosVideo
  });
}

/* ---------- 2. Videos de los vendedores (Tiendas asociadas → Videos) ---------- */
const VIDS_MKT = { cargado: false, cargando: false, disponible: false, lista: [], viendo: null };
async function cargarVideosMkt() {
  VIDS_MKT.cargando = true;
  try { VIDS_MKT.lista = await rpcCuentas('mkt_videos_panel', {}) || []; VIDS_MKT.disponible = true; VIDEOS_019 = true; }
  catch (e) { VIDS_MKT.disponible = false; if (funcionInexistente(e)) VIDEOS_019 = false; else console.warn('Videos de vendedores:', e); }
  VIDS_MKT.cargado = true; VIDS_MKT.cargando = false;
}
function tabVideosMkt() {   // etiqueta de la pestaña (o null si la migración no está)
  if (VIDEOS_019 === false) return null;
  if (!VIDS_MKT.cargado && !VIDS_MKT.cargando) cargarVideosMkt().then(() => { if (typeof renderAsociados === 'function') renderAsociados(); });
  const pend = VIDS_MKT.lista.filter(v => v.estado === 'pendiente').length;
  return `Videos${pend ? ` · ${pend} por aprobar` : ''}`;
}
const ESTADO_VIDEO = { pendiente: ['badge-pend', 'Pendiente'], aprobado: ['badge-ok', 'Aprobado'], rechazado: ['badge-bad', 'Rechazado'] };
function htmlVideosMkt() {
  if (!VIDS_MKT.cargado) return '<div class="panel"><p class="muted-sm">Cargando videos…</p></div>';
  if (!VIDS_MKT.disponible) return `<div class="panel"><h3>Videos de los vendedores</h3><p class="muted-sm">No se pudieron leer los videos.</p></div>`;
  const lista = VIDS_MKT.lista;
  return `<div class="panel">
    <h3>Videos de los vendedores</h3>
    <p class="muted-sm">Cuando un vendedor sube o cambia el video de un producto, queda <b>pendiente</b> y no se ve en la tienda hasta que lo apruebes. Las fotos de los productos no dependen de esto.</p>
    <div class="promo-list">${lista.length ? lista.map(v => {
      const [cls, txt] = ESTADO_VIDEO[v.estado] || ['', v.estado];
      const viendo = VIDS_MKT.viendo === v.producto_id;
      return `<div class="promo-item vid-mkt">
        ${viendo ? `<video class="vid-mkt-ver" src="${esc(v.url)}" poster="${esc(v.poster)}" controls playsinline autoplay></video>`
                 : `<button type="button" class="vid-mkt-poster" onclick="verVideoMkt('${v.producto_id}')" aria-label="Ver video de ${esc(v.producto)}"><img src="${esc(v.poster)}" alt="" loading="lazy"><span>▶</span></button>`}
        <div class="promo-meta">
          <strong>${esc(v.producto)}</strong>
          <small>${esc(v.vendedor)} · ${Math.round(Number(v.duracion))} s · ${EldoVideo.mb(Number(v.peso))}</small>
          <small><span class="badge ${cls}">${txt}</span>${v.estado === 'rechazado' && v.motivo ? ' ' + esc(v.motivo) : ''}</small>
        </div>
        <div class="promo-acc">
          ${v.estado !== 'aprobado' ? `<button class="btn btn-sm btn-primary" ${mktAdmin()} onclick="revisarVideoMkt('${v.producto_id}','aprobado')">Aprobar</button>` : ''}
          ${v.estado !== 'rechazado' ? `<button class="btn btn-sm" ${mktAdmin()} onclick="revisarVideoMkt('${v.producto_id}','rechazado')">Rechazar</button>` : ''}
          <button class="btn btn-sm btn-danger" ${mktAdmin()} onclick="eliminarVideoMkt('${v.producto_id}')">Eliminar</button>
        </div>
      </div>`; }).join('') : '<p class="muted-sm">Todavía no hay videos de vendedores.</p>'}</div>
  </div>`;
}
function verVideoMkt(id) { VIDS_MKT.viendo = id; renderAsociados(); }
async function revisarVideoMkt(id, estado) {
  let motivo = '';
  if (estado === 'rechazado') { motivo = prompt('Motivo del rechazo (lo ve el vendedor):', ''); if (motivo === null) return; }
  try { await rpcCuentas('mkt_revisar_video', { p_producto_id: id, p_estado: estado, p_motivo: motivo }); showToast(estado === 'aprobado' ? 'Video aprobado: ya se ve en la tienda.' : 'Video rechazado.'); }
  catch (e) { showError(e); }
  await cargarVideosMkt(); renderAsociados();
}
async function eliminarVideoMkt(id) {
  const v = VIDS_MKT.lista.find(x => x.producto_id === id); if (!v) return;
  if (!confirm(`¿Eliminar el video de «${v.producto}» (${v.vendedor})? Las fotos del producto no se tocan.`)) return;
  try {
    const r = await rpcCuentas('mkt_eliminar_video', { p_producto_id: id });
    try { await borrarArchivosVideo(r && r.borrar); } catch (x) { console.warn(x); }
    showToast('Video eliminado.');
  } catch (e) { showError(e); }
  await cargarVideosMkt(); renderAsociados();
}
