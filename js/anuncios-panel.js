/* ==========================================================================
   ELDOSTORE — Panel: Tienda online → «Barra de anuncios» (migración 017)
   Agregar, editar, activar/desactivar, ordenar y eliminar los anuncios de la
   franja amarilla de la tienda, y elegir la velocidad. Todo se guarda con
   funciones de la base que exigen al administrador. Si la migración 017 no
   está instalada, la pestaña lo avisa y el resto del panel sigue igual.
   ========================================================================== */
const ANUNCIOS = { cargado: false, disponible: false, cargando: false, esAdmin: false, velocidad: 'normal', lista: [] };
const ICONOS_ANUNCIO = [['ninguno', 'Sin ícono'], ['camion', '🚚 Envío'], ['rayo', '⚡ Rayo'], ['regalo', '🎁 Regalo'],
  ['tarjeta', '💳 Pago'], ['whatsapp', '💬 WhatsApp'], ['estrella', '⭐ Estrella'], ['reloj', '⏰ Horario'],
  ['ubicacion', '📍 Ubicación'], ['etiqueta', '🏷️ Oferta']];
const VELOCIDADES_ANUNCIO = [['lenta', 'Lenta'], ['normal', 'Normal'], ['rapida', 'Rápida']];
const iconoAnuncio = k => (ICONOS_ANUNCIO.find(x => x[0] === k) || ICONOS_ANUNCIO[0])[1].split(' ')[0];

async function cargarAnuncios() {
  ANUNCIOS.cargando = true;
  try {
    const d = await rpcCuentas('anuncios_panel', {});
    Object.assign(ANUNCIOS, { disponible: true, esAdmin: !!d.esAdmin, velocidad: d.velocidad || 'normal', lista: d.anuncios || [] });
  } catch (e) {
    ANUNCIOS.disponible = false;
    if (!funcionInexistente(e)) console.warn('No se pudieron leer los anuncios:', e);
  }
  ANUNCIOS.cargado = true; ANUNCIOS.cargando = false;
}
async function rpcAnuncio(nombre, args) {
  const r = await rpcCuentas(nombre, args);
  await cargarAnuncios();
  return r;
}
const adminAnuncio = () => ANUNCIOS.esAdmin ? '' : 'disabled';

function htmlAnuncios() {
  if (!ANUNCIOS.cargado) {
    if (!ANUNCIOS.cargando) cargarAnuncios().then(() => { if (tiendaTab === 'anuncios') renderTienda(); });
    return '<div class="panel"><p class="muted-sm">Cargando anuncios…</p></div>';
  }
  if (!ANUNCIOS.disponible) return `<div class="panel"><h3>Falta instalar la migración 017</h3>
      <p class="muted-sm">Cuando esté instalada, desde acá vas a administrar los anuncios de la franja amarilla de la tienda. Mientras tanto, la tienda muestra la franja de siempre.</p></div>`;
  const lista = ANUNCIOS.lista, activos = lista.filter(a => a.activo).length;
  const estado = activos === 0 ? 'Sin anuncios activos: la franja amarilla <b>no se muestra</b> en la tienda.'
    : activos === 1 ? 'Un anuncio activo: se muestra <b>fijo</b>, como siempre.'
    : `${activos} anuncios activos: se <b>desplazan</b> de derecha a izquierda, en este orden.`;
  return `<div class="panel">
    <h3>Barra de anuncios</h3>
    <p class="muted-sm">Es la franja amarilla de arriba de todo en la tienda. Los cambios se ven en la tienda al recargarla.</p>
    <p class="muted-sm">${estado}</p>
    <div class="anun-cab">
      <label class="anun-vel">Velocidad
        <select ${adminAnuncio()} onchange="velocidadAnuncioUI(this.value)">
          ${VELOCIDADES_ANUNCIO.map(([v, t]) => `<option value="${v}" ${ANUNCIOS.velocidad === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></label>
      <button class="btn btn-primary btn-sm" ${adminAnuncio()} onclick="editarAnuncioUI(null)">+ Agregar anuncio</button>
    </div>
    <div class="promo-list">${lista.length ? lista.map((a, i) => `
      <div class="promo-item${a.activo ? '' : ' off'}">
        <span class="anun-ico" aria-hidden="true">${iconoAnuncio(a.icono)}</span>
        <div class="promo-meta">
          <strong>${esc(a.texto)}</strong>
          <small>${a.activo ? '● Activo' : '○ Inactivo'}</small>
        </div>
        <div class="promo-acc">
          <button class="btn btn-sm" ${adminAnuncio()} ${i === 0 ? 'disabled' : ''} onclick="moverAnuncioUI(${i}, -1)" aria-label="Subir">↑</button>
          <button class="btn btn-sm" ${adminAnuncio()} ${i === lista.length - 1 ? 'disabled' : ''} onclick="moverAnuncioUI(${i}, 1)" aria-label="Bajar">↓</button>
          <button class="btn btn-sm" ${adminAnuncio()} onclick="activarAnuncioUI('${a.id}', ${!a.activo})">${a.activo ? 'Desactivar' : 'Activar'}</button>
          <button class="btn btn-sm" ${adminAnuncio()} onclick="editarAnuncioUI('${a.id}')">Editar</button>
          <button class="btn btn-sm btn-danger" ${adminAnuncio()} onclick="eliminarAnuncioUI('${a.id}')">Eliminar</button>
        </div>
      </div>`).join('') : '<p class="muted-sm">Todavía no hay anuncios.</p>'}</div>
  </div>`;
}

function editarAnuncioUI(id) {
  const a = id ? ANUNCIOS.lista.find(x => x.id === id) : { texto: '', icono: 'ninguno', activo: true };
  if (!a) return;
  openModal(`
    <h3>${id ? 'Editar anuncio' : 'Nuevo anuncio'}</h3>
    <div class="field"><label for="an_texto">Texto (hasta 120 caracteres)</label>
      <input id="an_texto" maxlength="120" value="${esc(a.texto)}" placeholder="Ej.: Pagá con transferencia o efectivo"
        oninput="document.getElementById('an_cuenta').textContent = this.value.length + ' / 120'">
      <small class="muted-sm" id="an_cuenta">${a.texto.length} / 120</small></div>
    <div class="field"><label for="an_icono">Ícono</label>
      <select id="an_icono">${ICONOS_ANUNCIO.map(([v, t]) => `<option value="${v}" ${a.icono === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <label class="check-row"><input type="checkbox" id="an_activo" ${a.activo ? 'checked' : ''}> Activo</label>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="anBtn" onclick="guardarAnuncioUI(${id ? `'${id}'` : 'null'})">Guardar</button>
    </div>`);
  setTimeout(() => { const t = document.getElementById('an_texto'); if (t) t.focus(); }, 50);
}
async function guardarAnuncioUI(id) {
  const texto = document.getElementById('an_texto').value.trim();
  if (!texto) { showToast('Escribí el texto del anuncio.'); return; }
  const btn = document.getElementById('anBtn'); btn.disabled = true;
  try {
    await rpcAnuncio('guardar_anuncio', { p_id: id, p_texto: texto,
      p_icono: document.getElementById('an_icono').value, p_activo: document.getElementById('an_activo').checked });
    closeModal(); showToast('Anuncio guardado.'); renderTienda();
  } catch (e) { showError(e); btn.disabled = false; }
}
async function activarAnuncioUI(id, activo) {
  const a = ANUNCIOS.lista.find(x => x.id === id); if (!a) return;
  try { await rpcAnuncio('guardar_anuncio', { p_id: id, p_texto: a.texto, p_icono: a.icono, p_activo: activo }); renderTienda(); }
  catch (e) { showError(e); }
}
async function moverAnuncioUI(i, dir) {
  const ids = ANUNCIOS.lista.map(a => a.id), j = i + dir;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  try { await rpcAnuncio('ordenar_anuncios', { p_ids: ids }); renderTienda(); } catch (e) { showError(e); }
}
async function eliminarAnuncioUI(id) {
  const a = ANUNCIOS.lista.find(x => x.id === id); if (!a) return;
  if (!confirm('¿Eliminar este anuncio?\n\n«' + a.texto + '»')) return;
  try { await rpcAnuncio('eliminar_anuncio', { p_id: id }); showToast('Anuncio eliminado.'); renderTienda(); }
  catch (e) { showError(e); }
}
async function velocidadAnuncioUI(v) {
  try { await rpcAnuncio('guardar_velocidad_anuncios', { p_velocidad: v }); showToast('Velocidad guardada.'); renderTienda(); }
  catch (e) { showError(e); renderTienda(); }
}
