/* ==========================================================================
   ELDOSTORE CRM — Vendedores asociados / Marketplace (asociados.js) — migraciones 006 y 008

   Etapa C del Marketplace (migración 008), solo el administrador modifica:
   - Interruptor general del Marketplace (apagado = la tienda pública como siempre),
     comisión general e instrucciones de pago.
   - Solicitudes de alta del formulario público «Quiero vender» (aprobar / rechazar).
   - Estados del vendedor: pendiente → activo / suspendido / bloqueado (con motivo).
   - Categorías del Marketplace (bloquear una oculta todos sus productos).
   - Comisión por vendedor y por producto (opcionales: vacía = la general / la del vendedor).
   - Bloqueo de productos con motivo.
   - Cuentas de acceso de los vendedores (portal vendedor.html de SOLO LECTURA).
   Si la 008 no está instalada, todo esto no se muestra y el panel queda como con la 006.

   Todo se administra desde este panel, solo por el administrador (Diego):
   - Vendedores: nombre comercial, logo, descripción, WhatsApp, localidad,
     comisión (10 % inicial) y activo / inactivo.
   - Productos asociados: de qué vendedor son, fotos, precio, descripción,
     stock y aprobación (pendiente → aprobado → pausado / rechazado).
   - Ventas asociadas: cada venta guarda total, % y comisión de ELDOSTORE y lo
     que corresponde al vendedor. Se anulan con motivo; nunca se borran.

   Está separado de la tienda propia: no lee ni escribe products, ventas
   ni promociones. De la caja solo AGREGA (lo hace la base) el ingreso de cada
   comisión cobrada, y su contramovimiento si se deshace. Si la migración 006 no está instalada, MKT.disponible queda
   en false y el panel funciona exactamente como antes (no se ve el menú).
   ========================================================================== */

const MKT = { disponible: false, esAdmin: false, etapaC: false, vendedores: [], productos: [], ventas: [],
  config: null, solicitudes: [], categorias: [], cuentas: [] };
const ESTADOS_VEND = { pendiente: 'Pendiente', activo: 'Activo', suspendido: 'Suspendido', bloqueado: 'Bloqueado' };
const BADGE_VEND = { pendiente: 'badge-pend', activo: 'badge-ok', suspendido: 'badge-info', bloqueado: 'badge-warn' };
const ESTADOS_SOL = { nueva: 'Nueva', aprobada: 'Aprobada', rechazada: 'Rechazada', descartada: 'Descartada' };
const ESTADOS_MKT = { pendiente: 'Pendiente de aprobación', aprobado: 'Publicado', pausado: 'Pausado', rechazado: 'Rechazado' };
const BADGE_MKT = { pendiente: 'badge-pend', aprobado: 'badge-ok', pausado: 'badge-info', rechazado: 'badge-warn' };
const MKT_MAX_FOTOS = 10;

/* ------------------------------- Datos ---------------------------------- */
async function cargarAsociados() {
  // «Tiendas asociadas» es SOLO para el administrador principal (decisión de Diego, 16/11/2026): a los demás
  // usuarios del panel no se les pide ni se les muestra nada de vendedores (datos, WhatsApp, notas ni productos).
  // Solo reciben las reservas de stock de los productos PROPIOS, para no vender lo que ya apartó una compra.
  if (typeof soyAdministrador === 'function' && !soyAdministrador()) {
    Object.assign(MKT, { disponible: false, esAdmin: false, etapaC: false, etapaD: false, vendedores: [], productos: [], ventas: [],
      config: null, solicitudes: [], categorias: [], cuentas: [], compras: [], liquidaciones: [], reservas: new Map() });
    try { for (const x of (await rpcCuentas('mkt_reservas_stock', {})) || []) MKT.reservas.set(x.productoId, { unidades: Number(x.unidades), compras: x.compras || [] }); }
    catch (e) { if (!funcionInexistente(e)) console.warn('No se pudieron leer las reservas del Marketplace:', e); }
    return MKT;
  }
  try {
    const d = await rpcCuentas('mkt_panel', {});
    MKT.disponible = true;
    MKT.esAdmin = !!d.esAdmin;
    MKT.vendedores = d.vendedores || [];
    MKT.productos = (d.productos || []).map(p => Object.assign(p, { precio: Number(p.precio), stock: Number(p.stock) }));
    MKT.ventas = (d.ventas || []).map(v => Object.assign(v, {
      total: Number(v.total), comision: Number(v.comision), monto_vendedor: Number(v.monto_vendedor),
      precio_unitario: Number(v.precio_unitario), comision_pct: Number(v.comision_pct) }));
    // Migración 008 (Etapa C): si no está, estos datos no vienen y el panel sigue como con la 006.
    MKT.etapaC = !!d.config;
    MKT.config = d.config || null;
    MKT.solicitudes = d.solicitudes || [];
    MKT.categorias = d.categorias || [];
    MKT.cuentas = d.cuentas || [];
    // Migración 009 (Etapa D): compras, pagos y liquidaciones. Solo el administrador recibe datos.
    MKT.etapaD = 'compras' in d;
    MKT.compras = (d.compras || []).map(c => Object.assign(c, { total: Number(c.total), total_propio: Number(c.total_propio), total_vendedores: Number(c.total_vendedores),
      pedidos: (c.pedidos || []).map(p => Object.assign(p, { subtotal: Number(p.subtotal), comision: Number(p.comision), monto_vendedor: Number(p.monto_vendedor) })) }));
    MKT.liquidaciones = (d.liquidaciones || []).map(l => Object.assign(l, { monto_vendedor: Number(l.monto_vendedor), comision: Number(l.comision) }));
    MKT.reservas = new Map();
    if (MKT.etapaD) {
      try { for (const x of (await rpcCuentas('mkt_reservas_stock', {})) || []) MKT.reservas.set(x.productoId, { unidades: Number(x.unidades), compras: x.compras || [] }); }
      catch (e) { console.warn('No se pudieron leer las reservas del Marketplace:', e); }
    }
    for (const v of MKT.vendedores) if (!v.estado) v.estado = v.activo ? 'activo' : 'pendiente';
  } catch (e) {
    MKT.disponible = false;
    if (!funcionInexistente(e)) console.warn('No se pudieron leer las tiendas asociadas:', e);
  }
  return MKT;
}
async function rpcMkt(nombre, args) {
  const r = await rpcCuentas(nombre, args);
  await cargarAsociados();
  return r;
}
const vendedorMkt = id => MKT.vendedores.find(v => v.id === id);
/* Reservas de stock propio por compras del Marketplace sin pagar (las usa ui.js en productos, ventas y ajustes). */
function reservaMkt(productId) { return (MKT.reservas && MKT.reservas.get(productId)) || { unidades: 0, compras: [] }; }
const productoMkt = id => MKT.productos.find(p => p.id === id);
const mktAdmin = () => MKT.esAdmin ? '' : 'disabled';
/* Comisión: igual que la base (total × % / 100, al peso). */
const comisionMkt = (total, pct) => Math.round(Number(total) * Number(pct) / 100);
const fmtPct = n => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 }) + ' %';
/* Comisión que rige hoy (008: producto > vendedor > general; 006: la del vendedor). */
const pctVendedorMkt = v => Number(v.comision_aplicable != null ? v.comision_aplicable : v.comision_pct);
const pctProductoMkt = p => Number(p.comision_aplicable != null ? p.comision_aplicable : (vendedorMkt(p.vendedor_id) || {}).comision_pct);
const generalMkt = () => MKT.config ? Number(MKT.config.comision_general_pct) : 10;
/* WhatsApp: 549 + área + número → «área número» (ej.: 549 3751 112233 → 3751 112233) */
function waVisible(n) {
  const s = String(n || ''); const l = s.startsWith('549') && s.length === 13 ? s.slice(3) : s;
  return l.length === 10 ? l.slice(0, 4) + ' ' + l.slice(4) : s;
}
/* Lo que se escribe a mano («3751 11-2233») → formato internacional (549 + área + número, todo junto). */
function waInternacional(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '549' + d;                         // número argentino sin código de país
  if (d.length === 12 && d.startsWith('54') && d[2] !== '9') d = '549' + d.slice(2);
  return d;
}
function enlaceTiendaPublica(v) { return 'index.html#tiendas/' + encodeURIComponent(v.slug); }

/* ------------------------------- Vista ---------------------------------- */
let mktTab = 'vendedores';
const mktFiltro = { vendedor: '', estado: '', q: '', ventasVendedor: '', ventasDesde: '', ventasHasta: '', verAnuladas: false };

function renderAsociados() {
  const el = document.getElementById('asociadosContenido'); if (!el) return;
  if (typeof soyAdministrador === 'function' && !soyAdministrador()) {
    el.innerHTML = `<div class="panel"><h3>Sección del administrador</h3>
      <p class="muted-sm">«Tiendas asociadas» la administra solo Diego. Desde tu usuario seguís usando el resto del panel como siempre.</p></div>`;
    return;
  }
  if (!MKT.disponible) {
    el.innerHTML = `<div class="panel"><h3>Falta instalar la migración 006</h3>
      <p class="muted-sm">Cuando esté instalada, desde acá vas a administrar los vendedores asociados, sus productos y las comisiones.</p></div>`;
    return;
  }
  const pend = MKT.productos.filter(p => p.estado === 'pendiente').length;
  const nuevas = MKT.solicitudes.filter(s => s.estado === 'nueva').length;
  const tabs = [];
  if (MKT.etapaC && MKT.esAdmin) tabs.push(['marketplace', `Marketplace · ${MKT.config.activo ? 'ENCENDIDO' : 'apagado'}`]);
  if (MKT.etapaC && MKT.esAdmin) tabs.push(['solicitudes', `Solicitudes${nuevas ? ` · ${nuevas} nueva${nuevas === 1 ? '' : 's'}` : ''}`]);
  tabs.push(['vendedores', `Vendedores (${MKT.vendedores.length})`], ['productos', `Productos${pend ? ` · ${pend} por aprobar` : ''}`]);
  if (MKT.etapaC) tabs.push(['categorias', `Categorías (${MKT.categorias.length})`]);
  if (MKT.etapaD && MKT.esAdmin) {
    const porPagar = MKT.compras.filter(c => c.estado === 'pendiente_pago').length;
    tabs.push(['compras', `Compras${porPagar ? ` · ${porPagar} sin pagar` : ''}`], ['liquidaciones', 'Liquidaciones']);
  }
  if (MKT.esAdmin) tabs.push(['ventas', 'Ventas y comisiones']);   // información financiera: solo el administrador
  if (!tabs.some(([k]) => k === mktTab)) mktTab = 'vendedores';
  const aviso = MKT.esAdmin ? '' : '<div class="notice">Solo el administrador puede hacer cambios. Vos podés ver la información.</div>';
  const estadoGeneral = MKT.etapaC && !MKT.config.activo
    ? `<div class="notice">El <b>Marketplace está apagado</b>: nada de esta sección se ve en la tienda y el formulario «Quiero vender» no recibe solicitudes.${MKT.esAdmin ? ' Podés preparar todo y encenderlo cuando esté listo.' : ''}</div>` : '';
  el.innerHTML = `<div class="tabs" role="tablist">${tabs.map(([k, t]) =>
      `<button type="button" role="tab" class="tab${mktTab === k ? ' on' : ''}" aria-selected="${mktTab === k}" onclick="mktTab='${k}';renderAsociados()">${t}</button>`).join('')}</div>`
    + aviso + estadoGeneral + ({ marketplace: htmlMarketplaceMkt, solicitudes: htmlSolicitudesMkt, vendedores: htmlVendedoresMkt,
        productos: htmlProductosMkt, categorias: htmlCategoriasMkt, ventas: htmlVentasMkt,
        compras: htmlComprasMkt, liquidaciones: htmlLiquidacionesMkt }[mktTab])();
}

/* ----------------------------- Vendedores -------------------------------- */
function htmlVendedoresMkt() {
  const lista = MKT.vendedores;
  return `<div class="panel">
    <div class="toolbar" style="margin-bottom:6px"><h3 style="margin:0">Vendedores asociados</h3><div class="spacer"></div>
      <button class="btn btn-primary btn-sm" ${mktAdmin()} onclick="abrirVendedorMkt()">+ Nuevo vendedor</button></div>
    <p class="muted-sm">Cada vendedor tiene su propia tienda en la sección pública «Tiendas asociadas». Un vendedor nuevo queda ${MKT.etapaC ? '<b>pendiente</b>' : 'inactivo'} hasta que lo actives. Solo los vendedores <b>activos</b> se ven en la web${MKT.etapaC ? ' (y solo con el Marketplace encendido)' : ''}.</p>
    <div class="promo-list">${lista.length ? lista.map(v => {
      const prods = MKT.productos.filter(p => p.vendedor_id === v.id);
      const pub = prods.filter(p => p.estado === 'aprobado').length, pend = prods.filter(p => p.estado === 'pendiente').length;
      const cuentas = MKT.cuentas.filter(c => c.vendedor_id === v.id);
      const estado = MKT.etapaC
        ? `<span class="badge ${BADGE_VEND[v.estado]}">${ESTADOS_VEND[v.estado]}</span>`
        : (v.activo ? '<span class="badge badge-ok">Activo</span>' : '<span class="badge badge-pend">Inactivo</span>');
      const pct = MKT.etapaC && v.comision_pct == null ? `comisión ${fmtPct(generalMkt())} (general)` : `comisión ${fmtPct(pctVendedorMkt(v))}`;
      const accEstado = !MKT.etapaC
        ? `<button class="btn btn-sm" ${mktAdmin()} onclick="activarVendedorMkt('${v.id}', ${!v.activo})">${v.activo ? 'Desactivar' : 'Activar'}</button>`
        : (v.estado === 'activo'
            ? `<button class="btn btn-sm" ${mktAdmin()} onclick="estadoVendedorMkt('${v.id}','suspendido')">Suspender</button>`
            : `<button class="btn btn-sm btn-primary" ${mktAdmin()} onclick="estadoVendedorMkt('${v.id}','activo')">Activar</button>`)
          + (v.estado !== 'bloqueado' ? `<button class="btn btn-sm btn-danger" ${mktAdmin()} onclick="estadoVendedorMkt('${v.id}','bloqueado')">Bloquear</button>` : '');
      return `<div class="promo-item${v.activo ? '' : ' off'}">
        ${v.logo_url ? `<img src="${esc(v.logo_url)}" alt="" class="promo-thumb" loading="lazy">` : '<span class="promo-thumb vacio">Sin logo</span>'}
        <div class="promo-meta"><strong>${esc(v.nombre)} ${estado}</strong>
          <small>WhatsApp ${esc(waVisible(v.whatsapp))}${v.localidad ? ' · ' + esc(v.localidad) : ''}${MKT.esAdmin ? ' · ' + pct : ''}</small>
          <small>${pub} producto${pub === 1 ? '' : 's'} publicado${pub === 1 ? '' : 's'}${pend ? ` · ${pend} por aprobar` : ''} · ${prods.length} en total${MKT.etapaC && MKT.esAdmin ? ` · ${cuentas.length ? cuentas.length + ' cuenta' + (cuentas.length === 1 ? '' : 's') + ' de acceso' : 'sin cuenta de acceso'}` : ''}</small>
          ${v.motivo_estado && v.estado !== 'activo' ? `<small>Motivo: ${esc(v.motivo_estado)}</small>` : ''}</div>
        <div class="promo-acc">
          <button class="btn btn-sm" ${mktAdmin()} onclick="abrirVendedorMkt('${v.id}')">Editar</button>
          ${accEstado}
          ${MKT.etapaC && MKT.esAdmin ? `<button class="btn btn-sm" onclick="abrirCuentasMkt('${v.id}')">Cuentas de acceso</button>` : ''}
          <button class="btn btn-sm" onclick="mktFiltro.vendedor='${v.id}';mktTab='productos';renderAsociados()">Ver productos</button>
          <a class="btn btn-sm" href="${enlaceTiendaPublica(v)}" target="_blank" rel="noopener">Ver su tienda</a>
          <button class="btn btn-sm" onclick="copiarEnlaceTiendaMkt('${v.id}')">Copiar enlace</button>
          ${MKT.etapaC && MKT.esAdmin ? `<button class="btn btn-sm btn-danger" onclick="eliminarVendedorMkt('${v.id}')">Eliminar</button>` : ''}
        </div></div>`;
    }).join('') : `<p class="muted-sm">Todavía no hay vendedores.${MKT.esAdmin ? ' Tocá «+ Nuevo vendedor».' : ''}</p>`}</div></div>`;
}

function abrirVendedorMkt(id) {
  const v = id ? vendedorMkt(id) : null;
  openModal(`
    <h3>${v ? 'Editar vendedor' : 'Nuevo vendedor asociado'}</h3>
    <div class="field"><label>Nombre comercial</label><input id="mv_nombre" maxlength="80" value="${v ? esc(v.nombre) : ''}"></div>
    <div class="two-col">
      <div class="field"><label>WhatsApp para pedidos</label><input id="mv_wa" inputmode="tel" placeholder="Ej.: 3751 112233" value="${v ? esc(waVisible(v.whatsapp)) : ''}">
        <small>Con código de área, sin 0 ni 15. Ahí le llegan los pedidos.</small></div>
      <div class="field"><label>Localidad</label><input id="mv_loc" maxlength="80" placeholder="Ej.: Eldorado" value="${v ? esc(v.localidad) : ''}"></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Comisión de ELDOSTORE (%)</label><input id="mv_pct" type="number" min="0" max="50" step="0.5" inputmode="decimal"
          value="${v ? (v.comision_pct == null ? '' : Number(v.comision_pct)) : (MKT.etapaC ? '' : 10)}" ${MKT.etapaC ? `placeholder="Vacía = general (${fmtPct(generalMkt())})"` : ''}>
        <small>${MKT.etapaC ? 'Vacía = la comisión general. Un producto puede tener la suya propia. ' : ''}Se copia en cada venta; cambiarla no altera las ventas anteriores.</small></div>
      ${MKT.etapaC ? `<div class="field"><label>Estado</label><p class="muted-sm" style="margin:6px 0 0">${v ? ESTADOS_VEND[v.estado] : 'Pendiente'} · se cambia con los botones Activar / Suspender / Bloquear.</p></div>`
        : `<div class="field"><label>Estado</label><label class="check-row"><input type="checkbox" id="mv_activo" ${v && v.activo ? 'checked' : ''}> Activo (su tienda se ve en la web)</label></div>`}
    </div>
    ${MKT.etapaC ? `<div class="field"><label>Entrega y retiro (se ve en su tienda)</label><textarea id="mv_entrega" rows="2" maxlength="1000" placeholder="Ej.: Retiro en Eldorado km 9 · envíos a toda la zona">${v ? esc(v.entrega_info || '') : ''}</textarea></div>` : ''}
    <div class="field"><label>Descripción (se ve en su tienda)</label><textarea id="mv_desc" rows="3" maxlength="600">${v ? esc(v.descripcion) : ''}</textarea></div>
    <div class="field">
      <label>${v && v.logo_url ? 'Logo (elegí uno nuevo solo si querés reemplazarlo)' : 'Logo'}</label>
      ${v && v.logo_url ? `<img src="${esc(v.logo_url)}" alt="Logo actual" class="img-actual" loading="lazy">
        <label class="check-row"><input type="checkbox" id="mv_sinlogo"> Quitar el logo</label>` : ''}
      <input type="file" id="mv_logo" accept="image/*">
      <small>Se optimiza solo antes de subir (máx. 400 px).</small>
      <div id="mv_logo_prev" class="img-prev" hidden></div>
    </div>
    <div class="field"><label>Notas internas (no se publican)</label><textarea id="mv_notas" rows="2" maxlength="1000">${v ? esc(v.notas) : ''}</textarea></div>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="mvBtn" onclick="guardarVendedorMkt('${v ? v.id : ''}')">Guardar</button>
    </div>`);
  conectarVistaPrevia('mv_logo', 'logo', 'mv_logo_prev');
}

async function guardarVendedorMkt(id) {
  const v = id ? vendedorMkt(id) : null;
  const nombre = document.getElementById('mv_nombre').value.trim();
  const wa = waInternacional(document.getElementById('mv_wa').value);
  const pctTxt = document.getElementById('mv_pct').value.trim();
  const pct = pctTxt === '' && MKT.etapaC ? null : Number(pctTxt);
  if (nombre.length < 2) { showToast('Escribí el nombre comercial.'); return; }
  if (!/^\d{10,15}$/.test(wa)) { showToast('Revisá el WhatsApp: código de área y número, por ejemplo 3751 112233.'); return; }
  if (pct !== null && !(pct >= 0 && pct <= 50)) { showToast('La comisión tiene que estar entre 0 y 50 %.'); return; }
  const btn = document.getElementById('mvBtn'); btn.disabled = true; btn.textContent = 'Preparando logo...';
  let logo = null;
  try { logo = await imagenElegida('mv_logo', 'logo'); }
  catch (e) { showToast(e.message); btn.disabled = false; btn.textContent = 'Guardar'; return; }
  btn.textContent = 'Guardando...';
  try {
    const quitar = document.getElementById('mv_sinlogo');
    let logoUrl = v ? v.logo_url : '';
    if (quitar && quitar.checked) logoUrl = '';
    if (logo) logoUrl = await subirImagenOptimizada(logo, 'logo');
    const datos = { nombre, whatsapp: wa, comision_pct: pct === null ? '' : pct, localidad: document.getElementById('mv_loc').value.trim(),
      descripcion: document.getElementById('mv_desc').value.trim(), notas: document.getElementById('mv_notas').value.trim(),
      logo_url: logoUrl };
    const act = document.getElementById('mv_activo'); if (act) datos.activo = act.checked;           // panel sin la 008
    const ent = document.getElementById('mv_entrega'); if (ent) datos.entrega_info = ent.value.trim();
    await rpcMkt('mkt_guardar_vendedor', { p_id: id || null, p_datos: datos });
    closeModal(); renderAsociados(); showToast('Vendedor guardado.');
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = 'Guardar'; }
}

/* Enlace público (absoluto) de una tienda, para compartir por WhatsApp o redes. */
function enlaceAbsolutoTiendaMkt(v) { return new URL('.', location.href).href + '#tiendas/' + encodeURIComponent(v.slug); }
async function copiarTextoMkt(texto) {
  try { await navigator.clipboard.writeText(texto); return true; }
  catch (e) {
    const t = document.createElement('textarea'); t.value = texto; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    t.remove(); return ok;
  }
}
async function copiarEnlaceTiendaMkt(id) {
  const v = vendedorMkt(id); if (!v) return;
  const enlace = enlaceAbsolutoTiendaMkt(v);
  showToast(await copiarTextoMkt(enlace) ? 'Enlace copiado: ' + enlace : 'Copiá este enlace: ' + enlace);
}
/* Eliminar una tienda (migración 011): solo si nunca vendió; si tiene historial, la base lo impide. */
async function eliminarVendedorMkt(id) {
  const v = vendedorMkt(id); if (!v) return;
  const prods = MKT.productos.filter(p => p.vendedor_id === id).length;
  if (!confirm(`¿Eliminar la tienda «${v.nombre}»? Se borran también sus ${prods} producto${prods === 1 ? '' : 's'} y sus fotos, y se desvincula su cuenta de acceso. No se puede deshacer.\n\nSi la tienda ya vendió, no se puede eliminar: en ese caso suspendela o bloqueala.`)) return;
  try {
    const r = await rpcMkt('mkt_eliminar_vendedor', { p_id: id });
    mktFiltro.vendedor = ''; renderAsociados();
    showToast(`Tienda eliminada (${r.productos} producto${r.productos === 1 ? '' : 's'} y ${r.fotos} foto${r.fotos === 1 ? '' : 's'}).`);
  } catch (e) {
    if (funcionInexistente(e)) showToast('Para eliminar tiendas falta instalar la migración 011. Mientras tanto podés suspenderla o bloquearla.');
    else showError(e);
  }
}

async function activarVendedorMkt(id, activo) {
  const v = vendedorMkt(id); if (!v) return;
  if (!activo && !confirm(`¿Desactivar a ${v.nombre}? Su tienda y sus productos dejan de verse en la web (no se borra nada).`)) return;
  try { await rpcMkt('mkt_activar_vendedor', { p_id: id, p_activo: activo }); renderAsociados(); showToast(activo ? 'Vendedor activado: su tienda ya se ve.' : 'Vendedor desactivado.'); }
  catch (e) { showError(e); }
}

/* ------------------------------ Productos -------------------------------- */
function productosFiltradosMkt() {
  const t = mktFiltro.q.trim().toLowerCase();
  return MKT.productos.filter(p => (!mktFiltro.vendedor || p.vendedor_id === mktFiltro.vendedor)
    && (!mktFiltro.estado || p.estado === mktFiltro.estado)
    && (!t || (p.codigo + ' ' + p.nombre + ' ' + p.categoria).toLowerCase().includes(t)));
}
function opcionesVendedoresMkt(sel, vacia) {
  return (vacia ? `<option value="">${vacia}</option>` : '') +
    MKT.vendedores.map(v => `<option value="${v.id}" ${v.id === sel ? 'selected' : ''}>${esc(v.nombre)}${v.activo ? '' : ' (inactivo)'}</option>`).join('');
}
function htmlProductosMkt() {
  const lista = productosFiltradosMkt();
  return `<div class="panel">
    <div class="toolbar">
      <select onchange="mktFiltro.vendedor=this.value;renderAsociados()" aria-label="Vendedor">${opcionesVendedoresMkt(mktFiltro.vendedor, 'Todos los vendedores')}</select>
      <select onchange="mktFiltro.estado=this.value;renderAsociados()" aria-label="Estado"><option value="">Todos los estados</option>
        ${Object.entries(ESTADOS_MKT).map(([k, t]) => `<option value="${k}" ${mktFiltro.estado === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input type="text" placeholder="Buscar por código o nombre..." value="${esc(mktFiltro.q)}" oninput="mktFiltro.q=this.value;dibujarListaProductosMkt()">
      <div class="spacer"></div>
      <button class="btn btn-primary btn-sm" ${mktAdmin()} ${MKT.vendedores.length ? '' : 'disabled title="Primero creá un vendedor"'} onclick="abrirProductoMkt()">+ Nuevo producto asociado</button>
    </div>
    <p class="muted-sm">Un producto nuevo queda <b>pendiente</b>: se publica recién cuando lo aprobás y su vendedor está activo. Nunca aparece en «Todos los productos» de ELDOSTORE.</p>
    <div class="promo-list" id="mktListaProd">${htmlListaProductosMkt(lista)}</div></div>`;
}
function dibujarListaProductosMkt() { const el = document.getElementById('mktListaProd'); if (el) el.innerHTML = htmlListaProductosMkt(productosFiltradosMkt()); }
function htmlListaProductosMkt(lista) {
  if (!lista.length) return '<p class="muted-sm">No hay productos con este filtro.</p>';
  return lista.map(p => {
    const v = vendedorMkt(p.vendedor_id);
    const acc = {
      pendiente: [['aprobado', 'Aprobar y publicar', 'btn-primary'], ['rechazado', 'Rechazar', '']],
      aprobado: [['pausado', 'Pausar', '']],
      pausado: [['aprobado', 'Volver a publicar', 'btn-primary']],
      rechazado: [['aprobado', 'Aprobar y publicar', 'btn-primary']]
    }[p.estado] || [];
    return `<div class="promo-item${p.estado === 'aprobado' ? '' : ' off'}">
      ${p.fotos && p.fotos[0] ? `<img src="${esc(p.fotos[0])}" alt="" class="promo-thumb" loading="lazy">` : '<span class="promo-thumb vacio">Sin foto</span>'}
      <div class="promo-meta"><strong>${esc(p.nombre)} <span class="badge ${BADGE_MKT[p.estado]}">${ESTADOS_MKT[p.estado]}</span>${p.bloqueado ? ' <span class="badge badge-warn">Bloqueado</span>' : ''}</strong>
        <small>${esc(p.codigo)} · <b>${v ? esc(v.nombre) : '—'}</b>${v && !v.activo ? ' (vendedor no activo: no se ve)' : ''}</small>
        <small>${fmt(p.precio)} · stock ${p.stock}${p.stock === 0 ? ' (se ve «Sin stock»)' : ''}${p.categoria ? ' · ' + esc(p.categoria) : ''} · ${(p.fotos || []).length} foto${(p.fotos || []).length === 1 ? '' : 's'}${MKT.esAdmin ? ` · comisión ${fmtPct(pctProductoMkt(p))}${p.comision_pct != null ? ' (propia)' : ''}` : ''}</small>
        ${p.bloqueado && p.motivo_bloqueo ? `<small>Motivo del bloqueo: ${esc(p.motivo_bloqueo)}</small>` : ''}
        ${p.estado === 'pendiente' && p.cambio_vendedor ? `<small><b>Cargado o modificado por el vendedor</b> el ${fmtDate(p.cambio_vendedor)}: revisá nombre, precio, descripción y fotos antes de aprobar.</small>` : ''}
        ${p.estado === 'pausado' && p.pausado_por === 'vendedor' ? '<small>Lo pausó el vendedor (puede reanudarlo él mismo).</small>' : ''}</div>
      <div class="promo-acc">
        ${acc.map(([e, t, c]) => `<button class="btn btn-sm ${c}" ${mktAdmin()} onclick="estadoProductoMkt('${p.id}','${e}')">${t}</button>`).join('')}
        ${MKT.etapaC ? `<button class="btn btn-sm${p.bloqueado ? '' : ' btn-danger'}" ${mktAdmin()} onclick="bloquearProductoMkt('${p.id}', ${!p.bloqueado})">${p.bloqueado ? 'Desbloquear' : 'Bloquear'}</button>` : ''}
        <button class="btn btn-sm" ${mktAdmin()} onclick="abrirProductoMkt('${p.id}')">Editar</button>
        <button class="btn btn-sm btn-danger" ${mktAdmin()} onclick="eliminarProductoMkt('${p.id}')">Eliminar</button>
      </div></div>`;
  }).join('');
}

let mktFotos = [];   // borrador de fotos del producto: [{ url }] ya subidas o [{ archivo, img }] nuevas
function abrirProductoMkt(id) {
  const p = id ? productoMkt(id) : null;
  mktFotos = p ? (p.fotos || []).map(url => ({ url })) : [];
  const cats = Array.from(new Set(MKT.productos.map(x => x.categoria).filter(Boolean).concat(listaCategorias()))).sort();
  openModal(`
    <h3>${p ? 'Editar producto asociado' : 'Nuevo producto asociado'}</h3>
    <div class="field"><label>Vendedor</label><select id="mp_vend">${opcionesVendedoresMkt(p ? p.vendedor_id : (mktFiltro.vendedor || ''), p ? '' : 'Elegí el vendedor')}</select></div>
    <div class="field"><label>Nombre del producto</label><input id="mp_nombre" maxlength="140" value="${p ? esc(p.nombre) : ''}"></div>
    <div class="two-col">
      <div class="field"><label>Código</label><input id="mp_codigo" maxlength="40" placeholder="Automático (TA0001…)" value="${p ? esc(p.codigo) : ''}"></div>
      ${MKT.etapaC ? `<div class="field"><label>Categoría del Marketplace</label><select id="mp_catid"><option value="">Sin categoría</option>
          ${MKT.categorias.map(c => `<option value="${c.id}" ${p && p.categoria_id === c.id ? 'selected' : ''}>${esc(c.nombre)}${c.bloqueada ? ' (bloqueada)' : ''}</option>`).join('')}</select>
          <small>Se crean en la pestaña «Categorías».</small></div>`
        : `<div class="field"><label>Categoría</label><input id="mp_cat" maxlength="60" list="mp_cats" value="${p ? esc(p.categoria) : ''}"><datalist id="mp_cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>`}
    </div>
    ${MKT.etapaC ? `<div class="field"><label>Comisión propia de este producto (%)</label><input id="mp_pct" type="number" min="0" max="50" step="0.5" inputmode="decimal"
        value="${p && p.comision_pct != null ? Number(p.comision_pct) : ''}" placeholder="Vacía = la del vendedor o la general">
      <small>Prevalece sobre la del vendedor y la general. Las ventas ya hechas conservan su comisión.</small></div>` : ''}
    <div class="two-col">
      <div class="field"><label>Precio de venta</label><input id="mp_precio" type="number" min="1" step="1" inputmode="numeric" value="${p ? p.precio : ''}"></div>
      <div class="field"><label>Stock</label><input id="mp_stock" type="number" min="0" step="1" inputmode="numeric" value="${p ? p.stock : 1}"></div>
    </div>
    <div class="field"><label>Descripción</label><textarea id="mp_desc" rows="4" maxlength="2000">${p ? esc(p.descripcion) : ''}</textarea></div>
    <div class="field"><label>Fotos (hasta ${MKT_MAX_FOTOS}; la primera es la principal)</label>
      <div id="mp_fotos" class="mkt-fotos"></div>
      <label class="btn btn-sm file-btn">+ Agregar fotos<input type="file" accept="image/*" multiple onchange="agregarFotosMkt(this)"></label>
      <small>Se optimizan solas antes de subir (máx. 1200 px).</small></div>
    ${p ? '' : '<p class="muted-sm">Queda <b>pendiente de aprobación</b>: no se publica hasta que lo apruebes.</p>'}
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="mpBtn" onclick="guardarProductoMkt('${p ? p.id : ''}')">Guardar</button>
    </div>`, true);
  dibujarFotosMkt();
}
function dibujarFotosMkt() {
  const el = document.getElementById('mp_fotos'); if (!el) return;
  el.innerHTML = mktFotos.map((f, i) => `<div class="mkt-foto">
      ${f.url ? `<img src="${esc(f.url)}" alt="Foto ${i + 1}">` : f.vista ? `<img src="${f.vista}" alt="Foto nueva ${i + 1}">` : '<span class="promo-thumb vacio">Preparando…</span>'}
      ${f.error ? `<small class="mkt-foto-err">${esc(f.error)}</small>` : ''}
      <div class="mkt-foto-acc">
        <button type="button" class="btn btn-sm" ${i === 0 ? 'disabled' : ''} onclick="moverFotoMkt(${i},-1)" aria-label="Mover antes">←</button>
        <button type="button" class="btn btn-sm btn-danger" onclick="quitarFotoMkt(${i})" aria-label="Quitar foto">✕</button>
      </div></div>`).join('') || '<p class="muted-sm">Sin fotos todavía.</p>';
}
function agregarFotosMkt(input) {
  const archivos = Array.from(input.files || []); input.value = '';
  const lugar = MKT_MAX_FOTOS - mktFotos.length;
  if (archivos.length > lugar) showToast(`Se agregan ${Math.max(0, lugar)}: el máximo es ${MKT_MAX_FOTOS} fotos.`);
  for (const archivo of archivos.slice(0, Math.max(0, lugar))) {
    const f = { archivo };
    f.img = optimizarImagen(archivo, 'asociado').then(r => { f.vista = URL.createObjectURL(r.blob); dibujarFotosMkt(); return r; })
      .catch(e => { f.error = e.message; dibujarFotosMkt(); throw e; });
    f.img.catch(() => {});
    mktFotos.push(f);
  }
  dibujarFotosMkt();
}
function moverFotoMkt(i, d) { const j = i + d; if (j < 0 || j >= mktFotos.length) return; [mktFotos[i], mktFotos[j]] = [mktFotos[j], mktFotos[i]]; dibujarFotosMkt(); }
function quitarFotoMkt(i) { mktFotos.splice(i, 1); dibujarFotosMkt(); }

async function guardarProductoMkt(id) {
  const datos = {
    vendedor_id: document.getElementById('mp_vend').value,
    nombre: document.getElementById('mp_nombre').value.trim(),
    codigo: document.getElementById('mp_codigo').value.trim(),
    categoria: document.getElementById('mp_cat') ? document.getElementById('mp_cat').value.trim() : '',
    precio: Number(document.getElementById('mp_precio').value),
    stock: Number(document.getElementById('mp_stock').value),
    descripcion: document.getElementById('mp_desc').value.trim()
  };
  if (document.getElementById('mp_catid')) datos.categoria_id = document.getElementById('mp_catid').value;
  if (document.getElementById('mp_pct')) {
    const t = document.getElementById('mp_pct').value.trim();
    if (t !== '' && !(Number(t) >= 0 && Number(t) <= 50)) { showToast('La comisión tiene que estar entre 0 y 50 %.'); return; }
    datos.comision_pct = t;
  }
  if (!datos.vendedor_id) { showToast('Elegí a qué vendedor pertenece el producto.'); return; }
  if (datos.nombre.length < 2) { showToast('Escribí el nombre del producto.'); return; }
  if (!(datos.precio > 0)) { showToast('Indicá un precio mayor que 0.'); return; }
  if (!(datos.stock >= 0) || datos.stock !== Math.trunc(datos.stock)) { showToast('El stock tiene que ser un número entero, 0 o más.'); return; }
  if (datos.codigo && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(datos.codigo)) { showToast('El código solo puede tener letras, números, punto, guion y guion bajo.'); return; }
  if (mktFotos.some(f => f.error)) { showToast('Quitá las fotos que no se pudieron preparar (marcadas en rojo).'); return; }
  const btn = document.getElementById('mpBtn'); btn.disabled = true; btn.textContent = 'Subiendo fotos...';
  try {
    const urls = [];
    for (const f of mktFotos) {
      if (f.url) { urls.push(f.url); continue; }
      const r = await f.img;
      f.url = await subirImagenOptimizada(r, 'asociado');   // si se reintenta, no se vuelve a subir
      urls.push(f.url);
    }
    datos.fotos = urls;
    btn.textContent = 'Guardando...';
    const r = await rpcMkt('mkt_guardar_producto', { p_id: id || null, p_datos: datos });
    closeModal(); renderAsociados();
    showToast(id ? 'Producto guardado.' : `Producto ${r.codigo} creado: queda pendiente de aprobación.`);
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = 'Guardar'; }
}

async function estadoProductoMkt(id, estado) {
  const p = productoMkt(id); if (!p) return;
  const v = vendedorMkt(p.vendedor_id);
  if (estado === 'aprobado' && !(p.fotos || []).length && !confirm(`${p.nombre} no tiene fotos. ¿Publicarlo igual?`)) return;
  try {
    await rpcMkt('mkt_estado_producto', { p_id: id, p_estado: estado });
    renderAsociados();
    showToast(estado === 'aprobado' ? (v && v.activo ? 'Producto publicado.' : 'Producto aprobado. Se va a ver cuando actives al vendedor.') : 'Estado actualizado: ' + ESTADOS_MKT[estado] + '.');
  } catch (e) { showError(e); }
}
async function eliminarProductoMkt(id) {
  const p = productoMkt(id); if (!p) return;
  if (!confirm(`¿Eliminar ${p.nombre} (${p.codigo})? Si tiene ventas no se puede: en ese caso pausalo.`)) return;
  try { await rpcMkt('mkt_eliminar_producto', { p_id: id }); renderAsociados(); showToast('Producto eliminado.'); }
  catch (e) { showError(e); }
}

/* ===================== Marketplace · Etapa C (migración 008) ===================== */
/* Pide un motivo en una ventana (sin prompt() del navegador) y ejecuta la acción. */
function pedirMotivoMkt(titulo, texto, boton, accion, obligatorio = true) {
  window.__mktAccion = accion;
  openModal(`<h3>${titulo}</h3><p class="muted-sm">${texto}</p>
    <div class="field"><label>Motivo${obligatorio ? '' : ' (opcional)'}</label><input id="mm_motivo" maxlength="300"></div>
    <div class="modal-actions"><button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="mmBtn" onclick="confirmarMotivoMkt(${obligatorio})">${boton}</button></div>`);
  setTimeout(() => { const i = document.getElementById('mm_motivo'); if (i) i.focus(); }, 50);
}
async function confirmarMotivoMkt(obligatorio) {
  const m = document.getElementById('mm_motivo').value.trim();
  if (obligatorio && m.length < 3) { showToast('Escribí el motivo.'); return; }
  const btn = document.getElementById('mmBtn'); btn.disabled = true;
  try { await window.__mktAccion(m); closeModal(); renderAsociados(); }
  catch (e) { showError(e); btn.disabled = false; }
}

/* ---- Interruptor y configuración general ---- */
// 016: las compras pagadas a ELDOSTORE (modalidad A) y el formulario «Quiero vender» son opciones aparte del interruptor.
const con016Mkt = c => c && 'compras_eldostore' in c;
function modoMkt(c) {
  if (!con016Mkt(c)) return 'También el formulario «Quiero vender»' + (MKT.etapaD ? ' y las compras pagadas a ELDOSTORE.' : '.');
  return (c.compras_eldostore ? 'Compras pagadas a ELDOSTORE (modalidad A).' : 'Modalidad B: cada pedido va al WhatsApp de la tienda, el cliente le paga al vendedor y ELDOSTORE registra la venta y cobra la comisión.')
    + ` Formulario «Quiero vender»: ${c.formulario_abierto ? 'ABIERTO' : 'cerrado'}.`;
}
function htmlMarketplaceMkt() {
  const c = MKT.config;
  if (MKT.etapaD) setTimeout(dibujarFinanzasMkt, 0);
  return `${MKT.etapaD ? '<div id="mktFinanzas"><p class="muted-sm">Calculando el dinero del Marketplace…</p></div>' : ''}<div class="panel">
    <h3>Interruptor del Marketplace</h3>
    <p style="font-size:1.05rem;margin:8px 0">${c.activo ? `<span class="badge badge-ok">ENCENDIDO</span> La tienda muestra las tiendas asociadas activas. ${modoMkt(c)}`
      : '<span class="badge badge-pend">APAGADO</span> La tienda pública funciona exactamente como siempre: no se ve nada del Marketplace.'}</p>
    <button class="btn btn-sm ${c.activo ? 'btn-danger' : 'btn-primary'}" ${mktAdmin()} onclick="interruptorMkt(${!c.activo})">${c.activo ? 'Apagar el Marketplace' : 'Encender el Marketplace'}</button>
  </div>
  ${c.activo ? '' : `<div class="panel" id="mktPrevia">
    <h3>Vista previa privada</h3>
    <p class="muted-sm">Un enlace secreto para ver «Tiendas asociadas» como se verá en la tienda, con el Marketplace apagado. Muestra solo tiendas activas y productos aprobados, <b>sin compras ni cobros</b> y sin el formulario «Quiero vender». Las consultas y los pedidos van por WhatsApp a cada tienda. Nadie más lo ve si no le pasás el enlace.</p>
    <div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" ${mktAdmin()} onclick="vistaPreviaMkt(false)">Ver enlace de vista previa</button>
      <button class="btn btn-sm" ${mktAdmin()} onclick="vistaPreviaMkt(true)">Generar un enlace nuevo (anula el anterior)</button>
      <button class="btn btn-sm btn-danger" ${mktAdmin()} onclick="anularVistaPreviaMkt()">Anular el enlace</button>
    </div>
    <div id="mktPreviaRes"></div>
  </div>`}
  <div class="panel">
    <h3>Configuración</h3>
    <div class="two-col">
      <div class="field"><label>Comisión general de ELDOSTORE (%)</label><input id="mc_pct" type="number" min="0" max="50" step="0.5" inputmode="decimal" value="${Number(c.comision_general_pct)}">
        <small>Rige cuando ni el producto ni el vendedor tienen una propia. Se copia en cada venta: cambiarla no altera las anteriores.</small></div>
      <div class="field"><label>Vencimiento de compras sin pago (horas)</label><input id="mc_horas" type="number" min="1" max="168" step="1" inputmode="numeric" value="${Number(c.horas_vencimiento)}">
        <small>Se usa en la Etapa D (compras y pagos).</small></div>
    </div>
    <div class="field"><label>Instrucciones de pago para el cliente (alias / CBU / link)</label><textarea id="mc_pago" rows="3" maxlength="1000">${esc(c.instrucciones_pago || '')}</textarea>
      <small>Se usa en la Etapa D. Es texto público: no pongas contraseñas ni datos privados.</small></div>
    <label class="check-row"><input type="checkbox" id="mc_entregados" ${c.liquidar_solo_entregados ? 'checked' : ''}> Liquidar a los vendedores solo pedidos entregados (Etapa E)</label>
    ${con016Mkt(c) ? `<label class="check-row"><input type="checkbox" id="mc_compras" ${c.compras_eldostore ? 'checked' : ''}> Compras pagadas a ELDOSTORE (modalidad A: el cliente le paga a ELDOSTORE y ELDOSTORE liquida al vendedor)</label>
    <p class="muted-sm" style="margin-top:-4px">Apagado = modalidad B: el cliente le paga al vendedor por WhatsApp y vos registrás la venta en «Ventas y comisiones».</p>
    <label class="check-row"><input type="checkbox" id="mc_form" ${c.formulario_abierto ? 'checked' : ''}> Formulario público «Quiero vender» abierto</label>` : ''}
    <div class="modal-actions" style="justify-content:flex-start"><button class="btn btn-primary btn-sm" ${mktAdmin()} id="mcfgBtn" onclick="guardarConfigMkt()">Guardar configuración</button></div>
    <p class="muted-sm">Última modificación: ${c.actualizado ? fmtDate(c.actualizado) : '—'}</p>
  </div>`;
}
/* Vista previa privada (migración 014): enlace secreto con ?vista=<clave>. Solo el administrador. */
async function vistaPreviaMkt(nueva) {
  const res = document.getElementById('mktPreviaRes'); if (!res) return;
  res.innerHTML = '<p class="muted-sm">Preparando el enlace…</p>';
  const { data, error } = await sb.rpc('mkt_vista_previa_enlace', { p_nueva: !!nueva });
  if (error) { res.innerHTML = `<div class="notice">${esc(/mkt_vista_previa_enlace/.test(error.message || '') ? 'Falta instalar la migración 014.' : (error.message || 'No se pudo crear el enlace.'))}</div>`; return; }
  const enlace = new URL('.', location.href).href + '?vista=' + encodeURIComponent(data.clave) + '#tiendas';
  res.innerHTML = `<div class="field" style="margin-top:10px"><label for="mktPreviaUrl">Enlace privado${nueva ? ' (nuevo: el anterior ya no funciona)' : ''}</label>
    <input id="mktPreviaUrl" readonly value="${esc(enlace)}" onclick="this.select()"><small>Creado el ${fmtDate(data.creada)}. Pasalo solo a quien tenga que revisar (por ejemplo, el vendedor de prueba).</small></div>
    <div class="modal-actions" style="justify-content:flex-start">
      <button class="btn btn-sm btn-primary" onclick="copiarVistaPreviaMkt()">Copiar enlace</button>
      <a class="btn btn-sm" href="${esc(enlace)}" target="_blank" rel="noopener noreferrer">Abrir vista previa</a></div>`;
}
async function copiarVistaPreviaMkt() {
  const i = document.getElementById('mktPreviaUrl'); if (!i) return;
  showToast(await copiarTextoMkt(i.value) ? 'Enlace de vista previa copiado' : 'Seleccioná el enlace y copialo');
}
async function anularVistaPreviaMkt() {
  const res = document.getElementById('mktPreviaRes');
  const { error } = await sb.rpc('mkt_vista_previa_anular');
  if (res) res.innerHTML = error ? `<div class="notice">${esc(error.message || 'No se pudo anular.')}</div>` : '<p class="muted-sm"><b>Enlace anulado:</b> la vista previa ya no se puede abrir con ningún enlace anterior.</p>';
}
async function interruptorMkt(activo) {
  const activos = MKT.vendedores.filter(v => v.estado === 'activo').length;
  if (activo && !confirm(`¿Encender el Marketplace? La tienda pública va a mostrar ${activos} tienda${activos === 1 ? '' : 's'} activa${activos === 1 ? '' : 's'}. ${modoMkt(MKT.config)}`)) return;
  if (!activo && !confirm('¿Apagar el Marketplace? Las tiendas asociadas dejan de verse en la web (no se borra nada).')) return;
  try { await rpcMkt('mkt_guardar_config', { p_datos: { activo } }); renderAsociados(); showToast(activo ? 'Marketplace encendido.' : 'Marketplace apagado.'); }
  catch (e) { showError(e); }
}
async function guardarConfigMkt() {
  const pct = Number(document.getElementById('mc_pct').value), horas = Number(document.getElementById('mc_horas').value);
  if (!(pct >= 0 && pct <= 50)) { showToast('La comisión tiene que estar entre 0 y 50 %.'); return; }
  if (!(horas >= 1 && horas <= 168) || horas !== Math.trunc(horas)) { showToast('El vencimiento tiene que ser entre 1 y 168 horas.'); return; }
  const btn = document.getElementById('mcfgBtn'); btn.disabled = true;
  try {
    await rpcMkt('mkt_guardar_config', { p_datos: { comision_general_pct: pct, horas_vencimiento: horas,
      instrucciones_pago: document.getElementById('mc_pago').value.trim(), liquidar_solo_entregados: document.getElementById('mc_entregados').checked,
      ...(document.getElementById('mc_compras') ? { compras_eldostore: document.getElementById('mc_compras').checked, formulario_abierto: document.getElementById('mc_form').checked } : {}) } });
    renderAsociados(); showToast('Configuración guardada.');
  } catch (e) { showError(e); btn.disabled = false; }
}

/* ---- Solicitudes del formulario «Quiero vender» ---- */
let mktSolFiltro = 'nueva';
function htmlSolicitudesMkt() {
  const lista = MKT.solicitudes.filter(s => !mktSolFiltro || s.estado === mktSolFiltro);
  return `<div class="panel">
    <div class="toolbar"><h3 style="margin:0">Solicitudes de vendedores</h3><div class="spacer"></div>
      <select onchange="mktSolFiltro=this.value;renderAsociados()" aria-label="Estado"><option value="">Todas</option>
        ${Object.entries(ESTADOS_SOL).map(([k, t]) => `<option value="${k}" ${mktSolFiltro === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <p class="muted-sm">Llegan desde el formulario público «Quiero vender» (solo con el Marketplace encendido). Aprobar crea la tienda en estado <b>pendiente</b>: completala (logo, descripción, entrega) y activala cuando esté lista.</p>
    <div class="promo-list">${lista.length ? lista.map(s => `<div class="promo-item${s.estado === 'nueva' ? '' : ' off'}">
      <div class="promo-meta"><strong>${esc(s.nombre_tienda)} <span class="badge ${s.estado === 'nueva' ? 'badge-pend' : s.estado === 'aprobada' ? 'badge-ok' : 'badge-warn'}">${ESTADOS_SOL[s.estado]}</span></strong>
        <small>${esc(s.responsable)} · WhatsApp <a href="https://wa.me/${esc(s.whatsapp)}" target="_blank" rel="noopener">${esc(waVisible(s.whatsapp))}</a>${s.email ? ' · ' + esc(s.email) : ''}</small>
        <small>${[s.localidad, s.rubro].filter(Boolean).map(esc).join(' · ') || 'Sin localidad ni rubro'} · ${fmtDate(s.creada)}</small>
        ${s.mensaje ? `<small style="white-space:pre-line">«${esc(s.mensaje)}»</small>` : ''}
        ${s.motivo ? `<small>Motivo: ${esc(s.motivo)}</small>` : ''}</div>
      <div class="promo-acc">${s.estado === 'nueva' ? `
        <button class="btn btn-sm btn-primary" ${mktAdmin()} onclick="resolverSolicitudMkt('${s.id}','aprobar')">Aprobar</button>
        <button class="btn btn-sm" ${mktAdmin()} onclick="resolverSolicitudMkt('${s.id}','rechazar')">Rechazar</button>
        <button class="btn btn-sm" ${mktAdmin()} onclick="resolverSolicitudMkt('${s.id}','descartar')">Descartar</button>`
        : s.vendedor_id ? `<button class="btn btn-sm" onclick="mktTab='vendedores';renderAsociados()">Ver tienda</button>` : ''}</div></div>`).join('')
      : '<p class="muted-sm">No hay solicitudes con este filtro.</p>'}</div></div>`;
}
function resolverSolicitudMkt(id, accion) {
  const s = MKT.solicitudes.find(x => x.id === id); if (!s) return;
  const txt = { aprobar: `Se crea la tienda «${esc(s.nombre_tienda)}» en estado pendiente (todavía no se ve en la web).`,
    rechazar: 'La solicitud queda rechazada (no se borra).', descartar: 'Para spam o pruebas: queda descartada (no se borra).' }[accion];
  pedirMotivoMkt({ aprobar: 'Aprobar solicitud', rechazar: 'Rechazar solicitud', descartar: 'Descartar solicitud' }[accion], txt,
    { aprobar: 'Aprobar', rechazar: 'Rechazar', descartar: 'Descartar' }[accion],
    async m => { await rpcMkt('mkt_resolver_solicitud', { p_id: id, p_accion: accion, p_motivo: m });
      showToast(accion === 'aprobar' ? 'Tienda creada en estado pendiente.' : 'Solicitud resuelta.'); }, accion === 'rechazar');
}

/* ---- Estados del vendedor ---- */
function estadoVendedorMkt(id, estado) {
  const v = vendedorMkt(id); if (!v) return;
  const accion = async m => { await rpcMkt('mkt_estado_vendedor', { p_id: id, p_estado: estado, p_motivo: m || '' });
    showToast(estado === 'activo' ? (MKT.config && MKT.config.activo ? 'Vendedor activo: su tienda ya se ve.' : 'Vendedor activo: se va a ver cuando enciendas el Marketplace.') : 'Estado actualizado: ' + ESTADOS_VEND[estado] + '.'); };
  if (estado === 'activo') { accion('').then(renderAsociados).catch(showError); return; }
  pedirMotivoMkt(estado === 'bloqueado' ? `Bloquear a ${esc(v.nombre)}` : `Suspender a ${esc(v.nombre)}`,
    'Su tienda y sus productos dejan de verse en la web. No se borra nada y se puede revertir.',
    estado === 'bloqueado' ? 'Bloquear' : 'Suspender', accion, estado === 'bloqueado');
}

/* ---- Bloqueo de productos ---- */
function bloquearProductoMkt(id, bloquear) {
  const p = productoMkt(id); if (!p) return;
  const accion = async m => { await rpcMkt('mkt_bloquear_producto', { p_id: id, p_bloqueado: bloquear, p_motivo: m || '' });
    showToast(bloquear ? 'Producto bloqueado: no se ve en la web.' : 'Producto desbloqueado.'); };
  if (!bloquear) { accion('').then(renderAsociados).catch(showError); return; }
  pedirMotivoMkt(`Bloquear ${esc(p.nombre)}`, 'Deja de verse en la web aunque esté aprobado. El vendedor ve el motivo en su portal.', 'Bloquear', accion, true);
}

/* ---- Categorías del Marketplace ---- */
function htmlCategoriasMkt() {
  const cats = MKT.categorias;
  return `<div class="panel">
    <div class="toolbar"><h3 style="margin:0">Categorías del Marketplace</h3><div class="spacer"></div>
      <button class="btn btn-primary btn-sm" ${mktAdmin()} onclick="abrirCategoriaMkt()">+ Nueva categoría</button></div>
    <p class="muted-sm">Son distintas de las categorías de ELDOSTORE. Bloquear una categoría oculta en la web todos sus productos, sin borrarlos.</p>
    <div class="promo-list">${cats.length ? cats.map(c => {
      const n = MKT.productos.filter(p => p.categoria_id === c.id).length;
      return `<div class="promo-item${c.bloqueada ? ' off' : ''}"><div class="promo-meta"><strong>${esc(c.nombre)}${c.bloqueada ? ' <span class="badge badge-warn">Bloqueada</span>' : ''}</strong>
        <small>${n} producto${n === 1 ? '' : 's'} · orden ${c.orden}</small></div>
        <div class="promo-acc"><button class="btn btn-sm" ${mktAdmin()} onclick="abrirCategoriaMkt('${c.id}')">Editar</button>
          <button class="btn btn-sm${c.bloqueada ? '' : ' btn-danger'}" ${mktAdmin()} onclick="bloquearCategoriaMkt('${c.id}', ${!c.bloqueada})">${c.bloqueada ? 'Desbloquear' : 'Bloquear'}</button></div></div>`;
    }).join('') : '<p class="muted-sm">Todavía no hay categorías.</p>'}</div></div>`;
}
function abrirCategoriaMkt(id) {
  const c = id ? MKT.categorias.find(x => x.id === id) : null;
  openModal(`<h3>${c ? 'Editar categoría' : 'Nueva categoría'}</h3>
    <div class="two-col"><div class="field"><label>Nombre</label><input id="mk_nombre" maxlength="40" value="${c ? esc(c.nombre) : ''}"></div>
      <div class="field"><label>Orden</label><input id="mk_orden" type="number" step="1" inputmode="numeric" value="${c ? c.orden : ''}" placeholder="Al final"></div></div>
    <div class="modal-actions"><button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="mkBtn" onclick="guardarCategoriaMkt('${c ? c.id : ''}')">Guardar</button></div>`);
}
async function guardarCategoriaMkt(id) {
  const nombre = document.getElementById('mk_nombre').value.trim();
  if (nombre.length < 2 || nombre.length > 40) { showToast('El nombre tiene que tener entre 2 y 40 letras.'); return; }
  const btn = document.getElementById('mkBtn'); btn.disabled = true;
  try { await rpcMkt('mkt_guardar_categoria', { p_id: id || null, p_datos: { nombre, orden: document.getElementById('mk_orden').value } });
    closeModal(); renderAsociados(); showToast('Categoría guardada.'); }
  catch (e) { showError(e); btn.disabled = false; }
}
async function bloquearCategoriaMkt(id, bloquear) {
  const c = MKT.categorias.find(x => x.id === id); if (!c) return;
  if (bloquear && !confirm(`¿Bloquear «${c.nombre}»? Todos sus productos dejan de verse en la web (no se borra nada).`)) return;
  try { await rpcMkt('mkt_bloquear_categoria', { p_id: id, p_bloqueada: bloquear }); renderAsociados(); showToast(bloquear ? 'Categoría bloqueada.' : 'Categoría desbloqueada.'); }
  catch (e) { showError(e); }
}

/* ---- Cuentas de acceso de los vendedores (portal de solo lectura) ---- */
function abrirCuentasMkt(id) {
  const v = vendedorMkt(id); if (!v) return;
  const cuentas = MKT.cuentas.filter(c => c.vendedor_id === id);
  openModal(`<h3>Cuentas de acceso · ${esc(v.nombre)}</h3>
    <p class="muted-sm">Con su cuenta, el vendedor entra a <b>vendedor.html</b> y ve SOLO su tienda, sus productos y sus pedidos. No puede modificar nada ni entrar a este panel.</p>
    ${cuentas.length ? `<div class="promo-list">${cuentas.map(c => `<div class="promo-item${c.activo ? '' : ' off'}"><div class="promo-meta"><strong>${esc(c.email)} ${c.activo ? '<span class="badge badge-ok">Activa</span>' : '<span class="badge badge-pend">Desactivada</span>'}</strong>
        <small>Vinculada el ${fmtDate(c.creado)}</small></div>
      <div class="promo-acc">${c.activo ? `<button class="btn btn-sm" data-nuevo-enlace onclick="invitarCuentaMkt('${id}', '${esc(c.email)}')" title="Para que elija (o vuelva a elegir) su contraseña">Nuevo enlace</button>` : ''}
        <button class="btn btn-sm" onclick="activarCuentaMkt('${c.user_id}', ${!c.activo})">${c.activo ? 'Desactivar' : 'Reactivar'}</button>
        <button class="btn btn-sm btn-danger" onclick="desvincularCuentaMkt('${c.user_id}')">Desvincular</button></div></div>`).join('')}</div>` : '<p class="muted-sm">Todavía no tiene cuenta de acceso.</p>'}
    <div id="muEnlace"></div>
    <div class="notice">Escribí el email del vendedor y tocá <b>Crear enlace de invitación</b>. No se manda ningún correo: el panel te da un enlace
      para <b>copiar</b> o <b>enviar por WhatsApp</b> al vendedor. Con ese enlace crea su contraseña y su cuenta queda vinculada SOLO a esta tienda.
      El enlace sirve una sola vez y vence en 1 hora; si venció, generá uno nuevo.<br>
      Una cuenta del panel (Diego, Niko u otro usuario habilitado) no se puede vincular, y una cuenta de vendedor nunca puede habilitarse en el panel.</div>
    <div class="field"><label>Email del vendedor</label><input id="mu_email" type="email" maxlength="120" autocomplete="off"></div>
    <div class="modal-actions"><button class="btn btn-sm" onclick="closeModal()">Cerrar</button>
      <button class="btn btn-sm" id="muBtn" onclick="vincularCuentaMkt('${id}')">Solo vincular</button>
      <button class="btn btn-primary btn-sm" id="muInv" onclick="invitarCuentaMkt('${id}')">Crear enlace de invitación</button></div>`);
}
/* Enlace de invitación (función de Supabase «mkt-invitar-vendedor», v2): NO envía correos. Genera un enlace de un solo
   uso para que el vendedor cree su contraseña, deja la cuenta vinculada a ESTA tienda y el panel lo muestra para copiar
   o mandar por WhatsApp. El enlace no se guarda en ningún lado: si se pierde, se genera otro. */
let mktUltimoEnlace = null, mktInvitando = false;
async function invitarCuentaMkt(vendedorId, emailExistente) {
  if (mktInvitando) return;   // un toque = un enlace (dos toques seguidos generaban dos y anulaban el primero)
  const campo = document.getElementById('mu_email');
  const correo = (emailExistente || (campo ? campo.value : '')).trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) { showToast('Escribí un email válido.'); return; }
  const btn = document.getElementById('muInv'); if (btn) { btn.disabled = true; btn.textContent = 'Creando enlace...'; }
  mktInvitando = true;
  document.querySelectorAll('[data-nuevo-enlace]').forEach(b => { b.disabled = true; });
  try {
    const { data, error } = await sb.functions.invoke('mkt-invitar-vendedor', { body: { email: correo, vendedor_id: vendedorId, sitio: new URL('.', location.href).href } });
    let msg = data && data.error;
    if (error && !msg) { try { msg = (await error.context.json()).error; } catch (_) { msg = ''; } }
    if (error || !data || !data.ok || !data.enlace) {
      if (!msg && error && /Failed to send|Not Found|404|FunctionsFetchError|FunctionsRelayError/i.test(String(error.name || '') + ' ' + String(error.message || '')))
        msg = 'La invitación todavía no está instalada en Supabase (función «mkt-invitar-vendedor»).';
      throw new Error(msg || 'No se pudo crear el enlace de invitación.');
    }
    await cargarAsociados(); renderAsociados(); abrirCuentasMkt(vendedorId);
    mostrarEnlaceInvitacionMkt(vendedorId, correo, data);
  } catch (e) { showError(e); if (btn) { btn.disabled = false; btn.textContent = 'Crear enlace de invitación'; } }
  finally { mktInvitando = false; document.querySelectorAll('[data-nuevo-enlace]').forEach(b => { b.disabled = false; }); }
}
function mensajeInvitacionMkt(v, data) {
  return `Hola ${v.nombre}, ¡somos ELDOSTORE!\n`
    + `Este es tu acceso al portal de vendedores de ELDOSTORE, donde vas a ver tu tienda, tus productos y tus pedidos.\n\n`
    + `1. Abrí este enlace: ${data.enlace}\n`
    + `2. Elegí tu contraseña (mínimo 8 caracteres) y tocá «${data.cuentaNueva ? 'Crear mi contraseña' : 'Guardar mi contraseña'}».\n`
    + `3. Después entrás siempre desde ${new URL('vendedor.html', location.href).href} con tu email y esa contraseña.\n\n`
    + `El enlace es personal, sirve una sola vez y vence en 1 hora: no lo compartas. Si venció, avisanos y te enviaremos otro.`;
}
function mostrarEnlaceInvitacionMkt(vendedorId, correo, data) {
  const v = vendedorMkt(vendedorId); const caja = document.getElementById('muEnlace'); if (!v || !caja) return;
  mktUltimoEnlace = { vendedorId, correo, data };
  const wa = String(v.whatsapp || '').replace(/\D/g, '');
  caja.innerHTML = `<div class="notice" role="status"><b>${data.cuentaNueva ? 'Enlace de invitación listo' : 'Enlace para elegir contraseña listo'}</b> · ${esc(correo)} quedó vinculada a <b>${esc(v.nombre)}</b>.<br>
      Mandale el enlace solo a esa persona. Sirve una sola vez y vence en 1 hora (si pasa, generá uno nuevo).
      <div class="field"><label>Enlace</label><input id="muLink" type="text" readonly value="${esc(data.enlace)}" onclick="this.select()"></div>
      <div class="modal-actions" style="justify-content:flex-start">
        <button class="btn btn-sm" onclick="copiarEnlaceInvitacionMkt()">Copiar enlace</button>
        ${/^\d{10,15}$/.test(wa) ? `<a class="btn btn-sm btn-wa" href="https://wa.me/${wa}?text=${encodeURIComponent(mensajeInvitacionMkt(v, data))}" target="_blank" rel="noopener">Enviar por WhatsApp a ${esc(v.nombre)}</a>` : '<span class="muted-sm">La tienda no tiene WhatsApp cargado: copiá el enlace.</span>'}
      </div></div>`;
}
async function copiarEnlaceInvitacionMkt() {
  if (!mktUltimoEnlace) return;
  const ok = await copiarTextoMkt(mktUltimoEnlace.data.enlace);
  if (!ok) { const i = document.getElementById('muLink'); if (i) i.select(); }
  showToast(ok ? 'Enlace copiado. Pegalo solo en el chat con el vendedor.' : 'Seleccioná el enlace y copialo.');
}
async function vincularCuentaMkt(vendedorId, email, activo = true) {
  const correo = email || document.getElementById('mu_email').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) { showToast('Escribí un email válido.'); return; }
  try { await rpcMkt('mkt_vincular_cuenta', { p_email: correo, p_vendedor_id: vendedorId, p_activo: activo });
    abrirCuentasMkt(vendedorId); renderAsociados(); showToast(activo ? 'Cuenta vinculada.' : 'Cuenta desactivada.'); }
  catch (e) { showError(e); }
}
function activarCuentaMkt(userId, activo) {
  const c = MKT.cuentas.find(x => x.user_id === userId); if (c) vincularCuentaMkt(c.vendedor_id, c.email, activo);
}
async function desvincularCuentaMkt(userId) {
  const c = MKT.cuentas.find(x => x.user_id === userId); if (!c) return;
  if (!confirm(`¿Desvincular ${c.email}? Deja de poder ver la tienda en el portal.`)) return;
  try { await rpcMkt('mkt_desvincular_cuenta', { p_user_id: userId }); abrirCuentasMkt(c.vendedor_id); renderAsociados(); showToast('Cuenta desvinculada.'); }
  catch (e) { showError(e); }
}


/* ===================== Marketplace · Etapa D (migración 009) =====================
   Compras, pagos MANUALES (solo pago completo, «pago registrado»), entregas, liquidaciones y
   la separación del dinero: caja propia / dinero de vendedores / dinero físico total.
   Todo lo calcula y valida la base; acá solo se muestra y se piden los datos. */
const ESTADOS_COMPRA = { pendiente_pago: 'Sin pagar', pago_registrado: 'Pago registrado', pago_acreditado: 'Pago acreditado',
  cancelada: 'Cancelada', vencida: 'Vencida', anulada: 'Anulada' };
const BADGE_COMPRA = { pendiente_pago: 'badge-pend', pago_registrado: 'badge-ok', pago_acreditado: 'badge-ok', cancelada: 'badge-info', vencida: 'badge-info', anulada: 'badge-warn' };
const ENTREGAS_MKT = { pendiente: 'Pendiente', preparando: 'En preparación', entregado: 'Entregado', cancelado: 'Cancelado' };
let mktCompraFiltro = 'pendiente_pago';

async function finanzasMkt() { return await rpcCuentas('mkt_finanzas', { p_desde: null, p_hasta: null }); }
async function dibujarFinanzasMkt() {
  const el = document.getElementById('mktFinanzas'); if (!el) return;
  let f;
  try { f = await finanzasMkt(); } catch (e) { el.innerHTML = `<div class="notice">${esc(e.message)}</div>`; return; }
  const n = x => Number(x || 0);
  el.innerHTML = `<div class="panel">
    <h3>Dinero: propio y de vendedores</h3>
    <div class="grid grid-3" style="margin-bottom:10px">
      ${kpiBox('Caja propia', fmt(n(f.cajaPropia)), 'ELDOSTORE + Niko + Ayelen', 'gold')}
      ${kpiBox('Dinero de vendedores', fmt(n(f.dineroVendedores)), `no es de ELDOSTORE · ${fmt(n(f.aPagarVendedores))} a pagar + ${fmt(n(f.comisionesNoGanadas))} de comisiones todavía no ganadas`, '')}
      ${kpiBox('Dinero físico total', fmt(n(f.fisicoTotal)), 'para contar la caja (propio + vendedores)', '')}
    </div>
    ${f.conciliacion && f.conciliacion.ok ? '<p class="muted-sm">✔ Conciliación: el dinero de vendedores coincide con los pedidos pagados sin liquidar.</p>'
      : `<div class="notice" style="border-color:var(--red)"><b>Atención:</b> el dinero de vendedores (${fmt(n(f.conciliacion && f.conciliacion.real))}) no coincide con lo esperado (${fmt(n(f.conciliacion && f.conciliacion.esperado))}). Revisá antes de liquidar.</div>`}
    <div class="table-wrap"><table><thead><tr><th>Quién tiene el dinero</th><th>Propio</th><th>De vendedores</th><th>Total físico</th></tr></thead>
      <tbody>${(f.porCustodio || []).map(h => `<tr><td>${esc(h.nombre)}</td><td>${fmt(n(h.propio))}</td><td>${fmt(n(h.vendedores))}</td><td>${fmt(n(h.propio) + n(h.vendedores))}</td></tr>`).join('')}</tbody></table></div>
    <div class="grid grid-4" style="margin-top:12px">
      ${kpiBox('Comisiones generadas', fmt(n(f.periodo.comisionesGeneradas)), 'de compras con pago registrado', 'gold')}
      ${kpiBox('Comisiones cobradas', fmt(n(f.periodo.comisionesCobradas)), 'pasaron a ELDOSTORE al liquidar', 'green')}
      ${kpiBox('Comisiones pendientes', fmt(n(f.periodo.comisionesPendientes)), 'se cobran al liquidar', n(f.periodo.comisionesPendientes) ? 'red' : '')}
      ${kpiBox('Vendido por las tiendas', fmt(n(f.periodo.ventasVendedores)), 'no es ingreso de ELDOSTORE', '')}
    </div></div>`;
}

function htmlComprasMkt() {
  const lista = MKT.compras.filter(c => !mktCompraFiltro || c.estado === mktCompraFiltro);
  return `<div class="panel">
    <div class="toolbar"><h3 style="margin:0">Compras del Marketplace</h3><div class="spacer"></div>
      <select onchange="mktCompraFiltro=this.value;renderAsociados()" aria-label="Estado"><option value="">Todas</option>
        ${Object.entries(ESTADOS_COMPRA).map(([k, t]) => `<option value="${k}" ${mktCompraFiltro === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <p class="muted-sm">Registrá el pago recién cuando veas el dinero (pago <b>completo</b>). Al registrarlo: la parte de ELDOSTORE se guarda como venta normal, el stock se descuenta y la parte de las tiendas va a <b>Dinero de vendedores</b> (no es de ELDOSTORE).</p>
    <div class="promo-list">${lista.length ? lista.map(c => `<div class="promo-item${['cancelada', 'vencida', 'anulada'].includes(c.estado) ? ' off' : ''}">
      <div class="promo-meta"><strong>${esc(c.numero)} · ${fmt(c.total)} <span class="badge ${BADGE_COMPRA[c.estado]}">${ESTADOS_COMPRA[c.estado]}</span></strong>
        <small>${esc(c.cliente_nombre)} · WhatsApp <a href="https://wa.me/${esc(c.cliente_whatsapp)}" target="_blank" rel="noopener">${esc(waVisible(c.cliente_whatsapp))}</a>${c.cliente_zona ? ' · ' + esc(c.cliente_zona) : ''} · ${fmtDate(c.creada)}</small>
        <small>ELDOSTORE ${fmt(c.total_propio)} · tiendas ${fmt(c.total_vendedores)}${c.estado === 'pendiente_pago' ? ' · vence ' + fmtDate(c.vence) : ''}${c.pago ? ` · ${esc(c.pago.medio)}${c.pago.referencia ? ' «' + esc(c.pago.referencia) + '»' : ''}` : ''}</small>
        ${c.motivo ? `<small>Motivo: ${esc(c.motivo)}</small>` : ''}
        ${(c.pedidos || []).map(pe => `<small>${esc(pe.numero)} · <b>${esc(pe.vendedor_nombre)}</b> · ${fmt(pe.subtotal)}${pe.vendedor_id ? ` (comisión ${fmt(pe.comision)}, para la tienda ${fmt(pe.monto_vendedor)})` : ''}
          · ${(pe.items || []).map(i => `${i.cantidad}× ${esc(i.nombre)}`).join(', ')}
          ${c.estado === 'pago_registrado' && pe.vendedor_id ? (pe.liquidacion_id ? ' · <span class="badge badge-ok">Liquidado</span>'
            : ` · <select aria-label="Entrega de ${esc(pe.numero)}" onchange="entregaMkt('${pe.id}', this.value)">${Object.entries(ENTREGAS_MKT).filter(([k]) => k !== 'cancelado').map(([k, t]) => `<option value="${k}" ${pe.estado_entrega === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`)
            : pe.vendedor_id ? ' · ' + ENTREGAS_MKT[pe.estado_entrega] : ''}
          ${c.estado === 'pago_registrado' && pe.vendedor_id && enlacePedidoWaMkt(c, pe) ? ` · <a class="btn btn-sm btn-wa" href="${enlacePedidoWaMkt(c, pe)}" target="_blank" rel="noopener">Enviar pedido a ${esc(pe.vendedor_nombre)} por WhatsApp</a>` : ''}</small>`).join('')}</div>
      <div class="promo-acc">
        ${['pendiente_pago', 'vencida'].includes(c.estado) ? `<button class="btn btn-sm btn-primary" onclick="abrirPagoMkt('${c.id}')">Registrar pago</button>` : ''}
        ${['pendiente_pago', 'vencida', 'pago_registrado'].includes(c.estado) ? `<button class="btn btn-sm btn-danger" onclick="anularCompraMkt('${c.id}')">${c.estado === 'pago_registrado' ? 'Anular y devolver' : 'Cancelar'}</button>` : ''}
      </div></div>`).join('') : '<p class="muted-sm">No hay compras con este filtro.</p>'}</div></div>`;
}
/* Pedido de UNA tienda (compra con pago registrado) listo para mandarle por WhatsApp a ESE vendedor.
   Solo lleva lo de su tienda: sus productos, su parte y los datos del cliente para coordinar la entrega. */
function mensajePedidoVendedorMkt(c, pe) {
  const items = (pe.items || []).map(i => `• ${i.cantidad} × ${i.nombre}${i.codigo ? ' (' + i.codigo + ')' : ''} — ${fmt(Number(i.subtotal))}`).join('\n');
  return `Hola ${pe.vendedor_nombre}, ¡somos ELDOSTORE!\n`
    + `Tenés un pedido PAGADO: ${pe.numero} (compra ${c.numero}).\n\n${items}\n\n`
    + `Total del pedido: ${fmt(pe.subtotal)}\nComisión ELDOSTORE: ${fmt(pe.comision)}\nPara tu tienda: ${fmt(pe.monto_vendedor)} (se te paga en la liquidación)\n\n`
    + `Cliente: ${c.cliente_nombre}\nWhatsApp del cliente: ${waVisible(c.cliente_whatsapp)}${c.cliente_zona ? '\nZona: ' + c.cliente_zona : ''}${c.notas ? '\nNotas: ' + c.notas : ''}\n\n`
    + `Por favor coordiná la entrega con el cliente y avisanos cuando esté entregado.`;
}
function enlacePedidoWaMkt(c, pe) {
  const v = vendedorMkt(pe.vendedor_id); const n = String((v && v.whatsapp) || '').replace(/\D/g, '');
  return /^\d{10,15}$/.test(n) ? `https://wa.me/${n}?text=${encodeURIComponent(mensajePedidoVendedorMkt(c, pe))}` : '';
}
function abrirPagoMkt(id) {
  const c = MKT.compras.find(x => x.id === id); if (!c) return;
  openModal(`<h3>Registrar pago de ${esc(c.numero)}</h3>
    <div class="notice">Total a cobrar: <b>${fmt(c.total)}</b> (solo pago completo). ELDOSTORE ${fmt(c.total_propio)} · tiendas ${fmt(c.total_vendedores)}.<br>
      Queda como <b>pago registrado</b> (manual): no es un pago verificado por Mercado Pago.</div>
    <div class="two-col">
      <div class="field"><label>Medio</label><select id="mpg_medio"><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="link_mercadopago">Link de Mercado Pago</option><option value="otro">Otro</option></select></div>
      <div class="field"><label>Monto recibido</label><input id="mpg_monto" type="number" inputmode="numeric" value="${c.total}"><small>Tiene que ser igual al total.</small></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Referencia / nº de operación</label><input id="mpg_ref" maxlength="120"></div>
      ${quienSelectMkt('mpg_quien', '¿Quién recibió el dinero?')}
    </div>
    <div class="modal-actions"><button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="mpgBtn" onclick="confirmarPagoMkt('${c.id}')">Registrar pago</button></div>`);
}
async function confirmarPagoMkt(id) {
  const c = MKT.compras.find(x => x.id === id); if (!c) return;
  const monto = Number(document.getElementById('mpg_monto').value);
  if (monto !== c.total) { showToast(`Solo se aceptan pagos completos: ${fmt(c.total)}.`); return; }
  const btn = document.getElementById('mpgBtn'); btn.disabled = true; btn.textContent = 'Registrando...';
  try {
    await rpcMkt('mkt_registrar_pago', { p_compra: id, p_datos: { medio: document.getElementById('mpg_medio').value, monto,
      referencia: document.getElementById('mpg_ref').value.trim(), holder_id: document.getElementById('mpg_quien').value } });
    await Promise.all([refreshCash(), refreshProducts(), refreshSales()]); closeModal(); mktCompraFiltro = 'pago_registrado'; renderAsociados();
    showToast(`Pago de ${c.numero} registrado: venta propia ${fmt(c.total_propio)} y ${fmt(c.total_vendedores)} a «Dinero de vendedores».`);
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = 'Registrar pago'; }
}
function anularCompraMkt(id) {
  const c = MKT.compras.find(x => x.id === id); if (!c) return;
  const pagada = c.estado === 'pago_registrado';
  openModal(`<h3>${pagada ? 'Anular y devolver' : 'Cancelar'} ${esc(c.numero)}</h3>
    ${pagada ? `<div class="notice">Se anula la venta propia (vuelve el stock y sale el dinero de la caja propia), vuelve el stock de las tiendas y sale de <b>Dinero de vendedores</b> la devolución al cliente. No se borra nada: todo queda con contramovimientos.</div>
      ${quienSelectMkt('mac_quien', '¿Quién le devuelve el dinero al cliente?')}` : '<p class="muted-sm">La compra no tiene pago: se cancela sin movimientos de dinero ni de stock.</p>'}
    <div class="field"><label>Motivo</label><input id="mac_motivo" maxlength="200"></div>
    <div class="modal-actions"><button class="btn btn-sm" onclick="closeModal()">Volver</button>
      <button class="btn btn-danger btn-sm" id="macBtn" onclick="confirmarAnularCompraMkt('${id}')">${pagada ? 'Anular y devolver' : 'Cancelar compra'}</button></div>`);
}
async function confirmarAnularCompraMkt(id) {
  const motivo = document.getElementById('mac_motivo').value.trim();
  if (motivo.length < 3) { showToast('Indicá el motivo.'); return; }
  const q = document.getElementById('mac_quien'), btn = document.getElementById('macBtn'); btn.disabled = true;
  try { await rpcMkt('mkt_anular_compra', { p_compra: id, p_motivo: motivo, p_holder_id: q ? q.value : null }); await Promise.all([refreshCash(), refreshProducts(), refreshSales()]); closeModal(); renderAsociados(); showToast('Compra anulada.'); }
  catch (e) { showError(e); btn.disabled = false; }
}
async function entregaMkt(pedidoId, estado) {
  try { await rpcMkt('mkt_estado_entrega', { p_pedido: pedidoId, p_estado: estado }); renderAsociados(); showToast('Entrega actualizada: ' + ENTREGAS_MKT[estado] + '.'); }
  catch (e) { showError(e); renderAsociados(); }
}

/* ---- Liquidaciones: recién acá la comisión pasa a ELDOSTORE ---- */
function pedidosLiquidablesMkt() {
  const soloEntregados = !MKT.config || MKT.config.liquidar_solo_entregados !== false;
  return MKT.compras.filter(c => c.estado === 'pago_registrado').flatMap(c => (c.pedidos || []).map(pe => Object.assign({}, pe, { compra: c })))
    .filter(pe => pe.vendedor_id && !pe.liquidacion_id && pe.estado_entrega !== 'cancelado' && (!soloEntregados || pe.estado_entrega === 'entregado'));
}
function htmlLiquidacionesMkt() {
  const pend = pedidosLiquidablesMkt();
  const porVend = MKT.vendedores.map(v => ({ v, ps: pend.filter(p => p.vendedor_id === v.id) })).filter(x => x.ps.length);
  return `<div class="panel"><h3>Para liquidar</h3>
    <p class="muted-sm">Pedidos con pago registrado${MKT.config && MKT.config.liquidar_solo_entregados !== false ? ' y <b>entregados</b>' : ''}, todavía sin pagar a la tienda. Al liquidar se registran por separado el pago a la tienda (sale de Dinero de vendedores) y la comisión, que recién ahí pasa a la caja de ELDOSTORE.</p>
    ${porVend.length ? porVend.map(({ v, ps }) => `<div class="promo-item"><div class="promo-meta"><strong>${esc(v.nombre)}</strong>
        ${ps.map(p => `<label class="check-row"><input type="checkbox" class="mkt-liq" data-v="${v.id}" value="${p.id}" checked> ${esc(p.numero)} · ${fmt(p.subtotal)} → tienda ${fmt(p.monto_vendedor)} · comisión ${fmt(p.comision)}</label>`).join('')}
        <small>Total: para la tienda <b>${fmt(ps.reduce((a, p) => a + p.monto_vendedor, 0))}</b> · comisión ELDOSTORE <b>${fmt(ps.reduce((a, p) => a + p.comision, 0))}</b></small></div>
      <div class="promo-acc"><button class="btn btn-sm btn-primary" onclick="abrirLiquidacionMkt('${v.id}')">Liquidar</button></div></div>`).join('')
      : '<p class="muted-sm">No hay pedidos para liquidar.</p>'}</div>
    <div class="panel"><h3>Liquidaciones registradas</h3>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Tienda</th><th>Pedidos</th><th>Pagado a la tienda</th><th>Comisión</th><th>Medio</th><th></th></tr></thead>
      <tbody>${MKT.liquidaciones.length ? MKT.liquidaciones.map(l => `<tr${l.anulada ? ' style="opacity:.55"' : ''}><td>${fmtDate(l.registrada)}</td><td>${esc(l.vendedor)}</td>
        <td>${(l.pedidos || []).map(esc).join(', ') || '—'}</td><td>${fmt(l.monto_vendedor)}</td><td>${fmt(l.comision)}</td><td>${esc(l.medio)}${l.referencia ? ' «' + esc(l.referencia) + '»' : ''}</td>
        <td>${l.anulada ? `<span class="badge badge-anulada" title="${esc(l.motivo_anulacion)}">Anulada</span>` : `<button class="btn btn-sm btn-danger" onclick="anularLiquidacionMkt('${l.id}')">Anular</button>`}</td></tr>`).join('')
        : '<tr><td colspan="7" class="empty-state">Todavía no hay liquidaciones.</td></tr>'}</tbody></table></div></div>`;
}
function abrirLiquidacionMkt(vendedorId) {
  const v = vendedorMkt(vendedorId); if (!v) return;
  const ids = Array.from(document.querySelectorAll(`.mkt-liq[data-v="${vendedorId}"]:checked`)).map(i => i.value);
  const ps = pedidosLiquidablesMkt().filter(p => ids.includes(p.id));
  if (!ps.length) { showToast('Marcá al menos un pedido.'); return; }
  window.__mktLiq = { vendedorId, ids };
  openModal(`<h3>Liquidar a ${esc(v.nombre)}</h3>
    <div class="notice">${ps.length} pedido${ps.length === 1 ? '' : 's'} (${ps.map(p => esc(p.numero)).join(', ')}).<br>
      Pagás a la tienda <b>${fmt(ps.reduce((a, p) => a + p.monto_vendedor, 0))}</b> y pasan a la caja de ELDOSTORE <b>${fmt(ps.reduce((a, p) => a + p.comision, 0))}</b> de comisión.</div>
    <div class="two-col">
      <div class="field"><label>Cómo se le paga</label><select id="mlq_medio"><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="otro">Otro</option></select></div>
      ${quienSelectMkt('mlq_quien', '¿Quién le paga?')}
    </div>
    <div class="field"><label>Referencia (opcional)</label><input id="mlq_ref" maxlength="120"></div>
    <div class="modal-actions"><button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="mlqBtn" onclick="confirmarLiquidacionMkt()">Registrar liquidación</button></div>`);
}
async function confirmarLiquidacionMkt() {
  const { vendedorId, ids } = window.__mktLiq || {}; if (!vendedorId) return;
  const btn = document.getElementById('mlqBtn'); btn.disabled = true;
  try {
    const r = await rpcMkt('mkt_registrar_liquidacion', { p_vendedor: vendedorId, p_pedidos: ids, p_datos: {
      medio: document.getElementById('mlq_medio').value, referencia: document.getElementById('mlq_ref').value.trim(), holder_id: document.getElementById('mlq_quien').value } });
    await refreshCash(); closeModal(); renderAsociados();
    showToast(`Liquidación registrada: ${fmt(r.montoVendedor)} a la tienda y ${fmt(r.comision)} de comisión a ELDOSTORE.`);
  } catch (e) { showError(e); btn.disabled = false; }
}
function anularLiquidacionMkt(id) {
  pedirMotivoMkt('Anular liquidación', 'Se registran contramovimientos: el pago a la tienda y la comisión vuelven a «Dinero de vendedores». No se borra nada.', 'Anular',
    async m => { await rpcMkt('mkt_anular_liquidacion', { p_liq: id, p_motivo: m }); await refreshCash(); showToast('Liquidación anulada.'); }, true);
}

/* ------------------------- Ventas y comisiones --------------------------- */
/* Fecha de Argentina de una venta (igual que la base: America/Argentina/Buenos_Aires). */
const fechaAR = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
function ventasFiltradasMkt(conAnuladas) {
  return MKT.ventas.filter(s => (conAnuladas || !s.anulada)
    && (!mktFiltro.ventasVendedor || s.vendedor_id === mktFiltro.ventasVendedor)
    && (!mktFiltro.ventasDesde || fechaAR(s.fecha) >= mktFiltro.ventasDesde)
    && (!mktFiltro.ventasHasta || fechaAR(s.fecha) <= mktFiltro.ventasHasta));
}
/* Indicadores del Marketplace: los calcula la base (mkt_indicadores, solo administrador). */
async function indicadoresMkt(desde, hasta, vendedor) {
  return await rpcCuentas('mkt_indicadores', { p_desde: desde || null, p_hasta: hasta || null, p_vendedor: vendedor || null });
}
function htmlIndicadoresMkt(d) {
  return `<div class="grid grid-4" style="margin-bottom:12px">
      ${kpiBox('Comisiones generadas', fmt(d.generadas), `${d.ventas} venta${d.ventas === 1 ? '' : 's'} asociada${d.ventas === 1 ? '' : 's'} · cobradas + pendientes`, 'gold')}
      ${kpiBox('Comisiones cobradas', fmt(d.cobradas), 'de las ventas del período', '')}
      ${kpiBox('Comisiones pendientes', fmt(d.pendientes), 'ELDOSTORE todavía tiene que cobrarlas', d.pendientes ? 'red' : '')}
      ${kpiBox('Ingresos efectivos por comisiones', fmt(d.ingresos_efectivos), 'lo que entró a la caja de ELDOSTORE', 'green')}
    </div>
    <p class="muted-sm">Generadas y cobradas: por fecha de la venta (sin anuladas). Ingresos efectivos: por fecha de cobro, solo lo que entró a la caja (${d.caja_movimientos} movimiento${d.caja_movimientos === 1 ? '' : 's'}); nunca incluye pendientes. Vendido por los asociados: ${fmt(d.ventas_vendedores)} (para los vendedores ${fmt(d.para_vendedores)}; no es ingreso de ELDOSTORE).</p>`;
}
async function dibujarIndicadoresVentasMkt() {
  const el = document.getElementById('mktIndicadores'); if (!el) return;
  try { el.innerHTML = htmlIndicadoresMkt(await indicadoresMkt(mktFiltro.ventasDesde, mktFiltro.ventasHasta, mktFiltro.ventasVendedor)); }
  catch (e) { el.innerHTML = `<div class="notice">${esc(e.message || 'No se pudieron calcular los indicadores.')}</div>`; }
}
function htmlVentasMkt() {
  const validas = ventasFiltradasMkt(false);
  const porVendedor = MKT.vendedores.map(v => {
    const vs = validas.filter(s => s.vendedor_id === v.id);
    return { v, n: vs.length, total: vs.reduce((a, s) => a + s.total, 0), com: vs.reduce((a, s) => a + s.comision, 0),
             vend: vs.reduce((a, s) => a + s.monto_vendedor, 0), cob: vs.filter(s => s.comision_cobrada).reduce((a, s) => a + s.comision, 0),
             pend: vs.filter(s => !s.comision_cobrada).reduce((a, s) => a + s.comision, 0) };
  }).filter(x => x.n);
  const lista = ventasFiltradasMkt(mktFiltro.verAnuladas);
  setTimeout(dibujarIndicadoresVentasMkt, 0);
  return `<div class="toolbar">
      <select onchange="mktFiltro.ventasVendedor=this.value;renderAsociados()" aria-label="Vendedor">${opcionesVendedoresMkt(mktFiltro.ventasVendedor, 'Todos los vendedores')}</select>
      <div class="field" style="margin:0"><label>Desde</label><input type="date" value="${mktFiltro.ventasDesde}" onchange="mktFiltro.ventasDesde=this.value;renderAsociados()"></div>
      <div class="field" style="margin:0"><label>Hasta</label><input type="date" value="${mktFiltro.ventasHasta}" onchange="mktFiltro.ventasHasta=this.value;renderAsociados()"></div>
      <label class="check-row" style="margin:0"><input type="checkbox" ${mktFiltro.verAnuladas ? 'checked' : ''} onchange="mktFiltro.verAnuladas=this.checked;renderAsociados()"> Mostrar anuladas</label>
      <div class="spacer"></div>
      <button class="btn btn-primary btn-sm" ${mktAdmin()} ${MKT.productos.length ? '' : 'disabled'} onclick="abrirVentaMkt()">+ Registrar venta asociada</button>
    </div>
    <div id="mktIndicadores"><p class="muted-sm">Calculando indicadores…</p></div>
    ${porVendedor.length ? `<div class="panel"><h3>Por vendedor</h3><div class="table-wrap"><table>
      <thead><tr><th>Vendedor</th><th>Ventas</th><th>Total vendido</th><th>Comisión generada</th><th>Cobrada</th><th>Pendiente</th><th>Para el vendedor</th></tr></thead>
      <tbody>${porVendedor.map(x => `<tr><td>${esc(x.v.nombre)}</td><td>${x.n}</td><td>${fmt(x.total)}</td><td>${fmt(x.com)}</td><td>${fmt(x.cob)}</td><td>${x.pend ? `<b style="color:var(--red)">${fmt(x.pend)}</b>` : fmt(0)}</td><td>${fmt(x.vend)}</td></tr>`).join('')}</tbody>
    </table></div></div>` : ''}
    <div class="table-wrap"><table>
      <thead><tr><th>Fecha</th><th>Vendedor</th><th>Producto</th><th>Cant.</th><th>Total</th><th>Comisión</th><th>Al vendedor</th><th>Comisión</th><th></th></tr></thead>
      <tbody>${lista.length ? lista.map(s => `<tr${s.anulada ? ' style="opacity:.55"' : ''}>
        <td>${fmtDate(s.fecha)}</td><td>${esc(s.vendedor_nombre)}</td>
        <td>${esc(s.producto_nombre)}<br><small style="color:var(--muted)">${esc(s.producto_codigo)} · ${fmt(s.precio_unitario)} c/u${s.cliente ? ' · ' + esc(s.cliente) : ''}</small></td>
        <td>${s.cantidad}</td><td>${fmt(s.total)}</td><td>${fmt(s.comision)}<br><small style="color:var(--muted)">${fmtPct(s.comision_pct)}</small></td><td>${fmt(s.monto_vendedor)}</td>
        <td>${s.anulada ? `<span class="badge badge-anulada" title="${esc(s.motivo_anulacion)}">Anulada</span>` : s.comision_cobrada
          ? `<span class="badge badge-ok">Cobrada</span><br><small style="color:var(--muted)">${s.comision_cobrada_en ? fmtDate(s.comision_cobrada_en) : ''}${s.comision_mov_id ? ' · en caja' : ''}</small>`
          : '<span class="badge badge-pend">Por cobrar</span>'}</td>
        <td style="white-space:nowrap">${s.anulada ? '' : `<button class="btn btn-sm" ${mktAdmin()} onclick="comisionCobradaMkt('${s.id}', ${!s.comision_cobrada})">${s.comision_cobrada ? 'Marcar por cobrar' : 'Marcar cobrada'}</button>
          <button class="btn btn-sm btn-danger" ${mktAdmin()} onclick="anularVentaMkt('${s.id}')">Anular</button>`}</td></tr>`).join('')
        : '<tr><td colspan="9" class="empty-state">No hay ventas asociadas con este filtro.</td></tr>'}</tbody>
    </table></div>
    <p class="muted-sm" style="margin-top:10px">El cliente le paga al vendedor; ELDOSTORE le cobra la comisión al vendedor. Al marcarla <b>cobrada</b>, solo la comisión entra como ingreso en la caja de ELDOSTORE (origen «comision_asociado»). El total de la venta no entra a la caja ni a las ventas propias.</p>`;
}

function abrirVentaMkt() {
  const prods = MKT.productos.filter(p => p.estado === 'aprobado' || p.estado === 'pausado');
  openModal(`
    <h3>Registrar venta asociada</h3>
    <div class="field"><label>Producto vendido</label>
      <select id="ms_prod" onchange="vistaVentaMkt(true)"><option value="">Elegí el producto</option>
        ${MKT.vendedores.map(v => { const ps = prods.filter(p => p.vendedor_id === v.id); return ps.length ? `<optgroup label="${esc(v.nombre)}">${ps.map(p =>
          `<option value="${p.id}">${esc(p.codigo)} · ${esc(p.nombre)} · ${fmt(p.precio)} · stock ${p.stock}</option>`).join('')}</optgroup>` : ''; }).join('')}
      </select></div>
    <div class="two-col">
      <div class="field"><label>Cantidad</label><input id="ms_cant" type="number" min="1" step="1" value="1" inputmode="numeric" oninput="vistaVentaMkt()"></div>
      <div class="field"><label>Precio unitario</label><input id="ms_precio" type="number" min="1" step="1" inputmode="numeric" oninput="vistaVentaMkt()"><small>El del producto; cambialo solo si se vendió a otro precio.</small></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Cliente (opcional)</label><input id="ms_cliente" maxlength="120"></div>
      <div class="field"><label>Fecha</label><input id="ms_fecha" type="datetime-local"></div>
    </div>
    <div class="field"><label>Notas (opcional)</label><input id="ms_notas" maxlength="500"></div>
    <div id="ms_vista" class="notice" hidden></div>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="msBtn" onclick="guardarVentaMkt()">Registrar</button>
    </div>`);
  const ahora = new Date(); ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
  document.getElementById('ms_fecha').value = ahora.toISOString().slice(0, 16);
}
function vistaVentaMkt(cambioProducto) {
  const p = productoMkt(document.getElementById('ms_prod').value), el = document.getElementById('ms_vista');
  if (!p) { el.hidden = true; return; }
  if (cambioProducto) document.getElementById('ms_precio').value = p.precio;
  const v = vendedorMkt(p.vendedor_id);
  const cant = Number(document.getElementById('ms_cant').value), precio = Number(document.getElementById('ms_precio').value);
  if (!(cant >= 1 && precio > 0)) { el.hidden = true; return; }
  const pct = pctProductoMkt(p), total = Math.round(cant * precio * 100) / 100, com = comisionMkt(total, pct);
  el.hidden = false;
  el.innerHTML = `Total <b>${fmt(total)}</b> · comisión ELDOSTORE (${fmtPct(pct)}) <b>${fmt(com)}</b> · para ${esc(v.nombre)} <b>${fmt(total - com)}</b>`
    + (cant > p.stock ? `<br><b style="color:var(--red)">Stock insuficiente (hay ${p.stock}). Actualizá el stock del producto primero.</b>` : '');
}
async function guardarVentaMkt() {
  const id = document.getElementById('ms_prod').value, p = productoMkt(id);
  const cant = Number(document.getElementById('ms_cant').value), precio = Number(document.getElementById('ms_precio').value);
  const fecha = document.getElementById('ms_fecha').value;
  if (!p) { showToast('Elegí el producto vendido.'); return; }
  if (!(cant >= 1) || cant !== Math.trunc(cant)) { showToast('La cantidad tiene que ser un número entero, 1 o más.'); return; }
  if (!(precio > 0)) { showToast('Indicá el precio.'); return; }
  const btn = document.getElementById('msBtn'); btn.disabled = true; btn.textContent = 'Registrando...';
  try {
    const r = await rpcMkt('mkt_registrar_venta', { p_datos: { producto_id: id, cantidad: cant,
      precio_unitario: precio === p.precio ? null : precio, fecha: fecha ? new Date(fecha).toISOString() : null,
      cliente: document.getElementById('ms_cliente').value.trim(), notas: document.getElementById('ms_notas').value.trim() } });
    closeModal(); mktTab = 'ventas'; renderAsociados();
    showToast(`Venta registrada: ${fmt(r.total)} · comisión ${fmt(r.comision)}.`);
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = 'Registrar'; }
}
/* Caja: la comisión cobrada entra como ingreso en la caja de ELDOSTORE (cash_movements, origen
   «comision_asociado», con la referencia de la venta). Lo registra la base; acá se elige quién
   recibió el dinero. Volver a «por cobrar» o anular agrega el contramovimiento (no borra nada). */
function quienSelectMkt(id, etiqueta) {
  return `<div class="field"><label>${etiqueta}</label><select id="${id}">${holderOptions(CUENTAS.miHolderId)}</select></div>`;
}
function anularVentaMkt(id) {
  const s = MKT.ventas.find(x => x.id === id); if (!s) return;
  openModal(`<h3>Anular venta asociada</h3>
    <p class="muted-sm">${s.cantidad} × ${esc(s.producto_nombre)} · ${esc(s.vendedor_nombre)} · ${fmt(s.total)}. La venta queda en el historial como anulada y el stock vuelve al producto.</p>
    ${s.comision_cobrada && s.comision > 0 ? `<div class="notice">La comisión de ${fmt(s.comision)} ya estaba cobrada: se registra un <b>egreso</b> en la caja de ELDOSTORE que la compensa (el ingreso original no se borra).</div>
      ${quienSelectMkt('ma_quien', '¿Quién devuelve el dinero?')}` : ''}
    <div class="field"><label>Motivo</label><input id="ma_motivo" maxlength="200"></div>
    <div class="modal-actions"><button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger btn-sm" id="maBtn" onclick="confirmarAnularMkt('${id}')">Anular venta</button></div>`);
}
async function confirmarAnularMkt(id) {
  const motivo = document.getElementById('ma_motivo').value.trim();
  if (motivo.length < 3) { showToast('Indicá el motivo de la anulación.'); return; }
  const q = document.getElementById('ma_quien');
  const btn = document.getElementById('maBtn'); btn.disabled = true;
  try {
    const r = await rpcMkt('mkt_anular_venta', { p_id: id, p_motivo: motivo, p_holder_id: q ? q.value : null });
    await refreshCash();
    closeModal(); renderAsociados(); showToast(r && r.comisionDevuelta ? 'Venta anulada. La comisión salió de la caja.' : 'Venta anulada.');
  } catch (e) { showError(e); btn.disabled = false; }
}
function comisionCobradaMkt(id, cobrada) {
  const s = MKT.ventas.find(x => x.id === id); if (!s) return;
  openModal(cobrada ? `<h3>Comisión cobrada</h3>
      <p class="muted-sm">${esc(s.vendedor_nombre)} · ${s.cantidad} × ${esc(s.producto_nombre)} (${esc(s.producto_codigo)}) · venta de ${fmt(s.total)}.</p>
      <div class="notice">${s.comision > 0 ? `Entra a la <b>caja de ELDOSTORE</b> un ingreso de <b>${fmt(s.comision)}</b> (solo la comisión del ${fmtPct(s.comision_pct)}; el resto es del vendedor).`
        : 'La comisión de esta venta es $0: se marca como cobrada sin movimiento de caja.'}</div>
      ${s.comision > 0 ? quienSelectMkt('mc_quien', '¿Quién recibió el dinero?') : ''}
      <div class="modal-actions"><button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="mcBtn" onclick="confirmarComisionMkt('${id}', true)">Registrar cobro</button></div>`
    : `<h3>Volver a «por cobrar»</h3>
      <div class="notice">Se registra un <b>egreso de ${fmt(s.comision)}</b> en la caja de ELDOSTORE que compensa el cobro anterior (el ingreso no se borra).</div>
      ${s.comision > 0 ? quienSelectMkt('mc_quien', '¿Quién devuelve o corrige el dinero?') : ''}
      <div class="modal-actions"><button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-danger btn-sm" id="mcBtn" onclick="confirmarComisionMkt('${id}', false)">Volver a por cobrar</button></div>`);
}
async function confirmarComisionMkt(id, cobrada) {
  const q = document.getElementById('mc_quien');
  const btn = document.getElementById('mcBtn'); btn.disabled = true;   // evita el doble clic
  try {
    const r = await rpcMkt('mkt_comision_cobrada', { p_id: id, p_cobrada: cobrada, p_holder_id: q ? q.value : null });
    await refreshCash();
    closeModal(); renderAsociados();
    showToast(cobrada ? (r && r.monto ? `Comisión cobrada: ingresaron ${fmt(r.monto)} a la caja de ELDOSTORE.` : 'Comisión marcada como cobrada.') : 'Comisión otra vez por cobrar (contramovimiento en caja).');
  } catch (e) { showError(e); btn.disabled = false; }
}

/* ---------------- Reportes: ingresos de ELDOSTORE + Marketplace ----------------
   Se llama al final de renderReportes() con lo que ESE reporte ya calculó para las
   ventas propias (no se recalcula ni se cambia nada de ese cálculo). Las comisiones
   salen de mkt_indicadores (solo administrador). Las ventas completas de los
   asociados nunca se suman como ingreso de ELDOSTORE. */
let repMktVendedor = '';
async function renderIndicadoresMkt({ desde, hasta, cuenta, propias, gastos }) {
  const el = document.getElementById('repMarketplace'); if (!el) return;
  if (!MKT.disponible || !MKT.esAdmin) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const eldo = cuentaEldostoreId();
  if (cuenta && cuenta !== eldo) {
    el.innerHTML = `<h3>Marketplace (tiendas asociadas)</h3><p class="muted-sm">Las comisiones del Marketplace son de la cuenta ELDOSTORE. Elegí «Todas» o ELDOSTORE para verlas junto a las ventas.</p>`;
    return;
  }
  el.innerHTML = '<h3>Ingresos de ELDOSTORE: ventas propias + Marketplace</h3><p class="muted-sm">Calculando…</p>';
  let d;
  try { d = await indicadoresMkt(desde, hasta, repMktVendedor); }
  catch (e) { el.innerHTML = `<h3>Marketplace</h3><div class="notice">${esc(e.message)}</div>`; return; }
  const ventasPropias = propias.todas.total, gananciaPropia = propias.todas.ganancia;
  const fila = (t, v, nota, fuerte) => `<tr${fuerte ? ' style="font-weight:700"' : ''}><td>${t}</td><td>${fmt(v)}</td><td style="color:var(--muted);font-size:.8rem">${nota}</td></tr>`;
  el.innerHTML = `<h3>Ingresos de ELDOSTORE: ventas propias + Marketplace</h3>
    <div class="toolbar" style="margin:6px 0 10px"><select onchange="repMktVendedor=this.value;renderReportes()" aria-label="Vendedor asociado">${opcionesVendedoresMkt(repMktVendedor, 'Todos los vendedores asociados')}</select></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Concepto</th><th>Importe</th><th></th></tr></thead>
      <tbody>
        ${fila('Ingresos por ventas propias', ventasPropias, `${propias.todas.cantidad} ventas de la tienda (propias y por revendedor)${cuenta ? ' · cuenta ELDOSTORE' : ''}`)}
        ${fila('Ingresos por comisiones del Marketplace', d.ingresos_efectivos, `solo cobradas: lo que entró a la caja${repMktVendedor ? ' · ' + esc((vendedorMkt(repMktVendedor) || {}).nombre || '') : ''} (las pendientes no se suman)`)}
        ${fila('Ingresos totales de ELDOSTORE', ventasPropias + d.ingresos_efectivos, 'ventas propias + comisiones cobradas (las ventas de los asociados no se suman)', true)}
      </tbody></table></div>
    <div class="grid grid-4" style="margin-top:14px">
      ${kpiBox('Ganancia por ventas propias', fmt(gananciaPropia), 'el mismo cálculo de siempre (ganancia bruta)', 'gold')}
      ${kpiBox('Comisiones generadas', fmt(d.generadas), `${d.ventas} ventas asociadas · cobradas + pendientes`, 'gold')}
      ${kpiBox('Comisiones cobradas', fmt(d.cobradas), 'de las ventas del período', '')}
      ${kpiBox('Comisiones pendientes', fmt(d.pendientes), 'por cobrar a los vendedores', d.pendientes ? 'red' : '')}
    </div>
    <p class="muted-sm" style="margin-top:8px">Fechas: ventas propias según el reporte de arriba; comisiones generadas, cobradas y pendientes por la fecha de la venta asociada; ingresos efectivos por la fecha del cobro (hora de Argentina). Vendido por los asociados en el período: ${fmt(d.ventas_vendedores)} (no es ingreso de ELDOSTORE). Gastos del período: ${fmt(gastos)}.</p>`;
}
