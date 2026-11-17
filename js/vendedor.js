/* ==========================================================================
   ELDOSTORE — Portal de vendedores asociados (js/vendedor.js)
   Marketplace · Etapa C (migración 008)

   El vendedor ve únicamente SU tienda, SUS productos y SUS pedidos. Desde la
   migración 012 también CARGA y administra sus productos: todo producto nuevo,
   o con cambios de nombre, descripción, categoría, precio o fotos, queda
   PENDIENTE hasta que ELDOSTORE lo aprueba. Stock y pausa no requieren
   aprobación. Todo lo valida la base (mkt_vendedor_* filtran por su cuenta) y
   las fotos solo se pueden subir a la carpeta de su tienda.

   - Las cuentas se crean por INVITACIÓN (Supabase → Invite user) y Diego las
     vincula a la tienda desde el panel. El enlace de la invitación trae la
     sesión en la dirección: acá se pide elegir la contraseña.
   - La sesión se guarda con una clave propia («eldostore-vendedor»), separada
     de la del panel de administración.
   ========================================================================== */
(function () {
  "use strict";
  const CFG = window.ELDOSTORE_CONFIG || {};
  const $ = s => document.querySelector(s);
  const main = $("#vpMain");
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
  const money = n => fmt.format(Number(n) || 0);
  const pct = n => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 }) + " %";
  const url = v => (typeof v === "string" && /^https:\/\/[^\s"'<>]+$/i.test(v.trim())) ? v.trim() : "";
  const ESTADO = {
    pendiente: ["warn", "Pendiente", "Tu tienda todavía no está publicada. ELDOSTORE la va a activar cuando esté lista."],
    activo: ["ok", "Activa", "Tu tienda está activa."],
    suspendido: ["warn", "Suspendida", "Tu tienda está suspendida: no se ve en la web por ahora."],
    bloqueado: ["no", "Bloqueada", "Tu tienda está bloqueada: no se ve en la web."]
  };
  const ENTREGA = { pendiente: "Entrega pendiente", preparando: "En preparación", entregado: "Entregado", cancelado: "Cancelado" };
  const PROD = { pendiente: ["warn", "Pendiente de aprobación"], aprobado: ["ok", "Aprobado"], pausado: ["", "Pausado"], rechazado: ["no", "Rechazado"] };

  if (!window.supabase || !CFG.supabaseUrl) { main.innerHTML = '<div class="vp-card"><p class="vp-msg err">No se pudo cargar el portal. Probá de nuevo en un rato.</p></div>'; return; }
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { storageKey: "eldostore-vendedor", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const vieneDeInvitacion = /type=(invite|recovery)/.test(location.hash);

  function contacto(texto) {
    return CFG.whatsapp ? `<a href="https://wa.me/${esc(CFG.whatsapp)}?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener noreferrer">escribile a ELDOSTORE por WhatsApp</a>` : "escribile a ELDOSTORE";
  }

  /* ---------- Ingreso ---------- */
  function pantallaIngreso(msg) {
    $("#vpSalir").classList.add("vp-hidden");
    main.innerHTML = `<div class="vp-card">
      <h1>Ingresá a tu tienda</h1>
      <p class="vp-muted">Para vendedores asociados a ELDOSTORE. La cuenta te la crea ELDOSTORE: te manda por WhatsApp un enlace para elegir tu contraseña.</p>
      ${msg ? `<p class="vp-msg err" role="alert">${esc(msg)}</p>` : ""}
      <form class="vp-form" id="vpLogin">
        <label for="vpEmail">Email<input id="vpEmail" type="email" autocomplete="username" required></label>
        <label for="vpPass">Contraseña<input id="vpPass" type="password" autocomplete="current-password" required></label>
        <button class="vp-btn" type="submit" id="vpEntrar">Entrar</button>
      </form>
      <p class="vp-muted">¿No tenés cuenta u olvidaste la contraseña? ${contacto("Hola, soy vendedor asociado y necesito ayuda para entrar al portal.")}.</p>
    </div>`;
  }
  function pantallaContrasena() {
    main.innerHTML = `<div class="vp-card">
      <h1>Elegí tu contraseña</h1>
      <p class="vp-muted">Vas a usarla para entrar al portal de vendedores.</p>
      <p class="vp-msg err vp-hidden" id="vpErr" role="alert"></p>
      <form class="vp-form" id="vpNueva">
        <label for="vpN1">Contraseña nueva (mínimo 8 caracteres)<input id="vpN1" type="password" autocomplete="new-password" minlength="8" required></label>
        <label for="vpN2">Repetila<input id="vpN2" type="password" autocomplete="new-password" minlength="8" required></label>
        <button class="vp-btn" type="submit" id="vpGuardar">Guardar contraseña</button>
      </form></div>`;
  }
  main.addEventListener("submit", async e => {
    e.preventDefault();
    if (e.target.id === "vpLogin") {
      const b = $("#vpEntrar"); b.disabled = true; b.textContent = "Entrando…";
      const { error } = await sb.auth.signInWithPassword({ email: $("#vpEmail").value.trim(), password: $("#vpPass").value });
      if (error) { pantallaIngreso(/invalid login/i.test(error.message) ? "Email o contraseña incorrectos." : error.message); return; }
      iniciar();
    }
    if (e.target.id === "vpNueva") {
      const a = $("#vpN1").value, b2 = $("#vpN2").value, err = $("#vpErr");
      const mal = m => { err.textContent = m; err.classList.remove("vp-hidden"); };
      if (a.length < 8) return mal("La contraseña tiene que tener al menos 8 caracteres.");
      if (a !== b2) return mal("Las dos contraseñas no coinciden.");
      const btn = $("#vpGuardar"); btn.disabled = true; btn.textContent = "Guardando…";
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) { btn.disabled = false; btn.textContent = "Guardar contraseña"; return mal(error.message); }
      history.replaceState(null, "", location.pathname);
      iniciar("Contraseña guardada.");
    }
  });
  $("#vpSalir").addEventListener("click", async () => { await sb.auth.signOut(); pantallaIngreso(); });

  /* ---------- Portal (solo lectura) ---------- */
  function dibujarPortal(d, aviso) {
    const t = d.tienda || {}, e = ESTADO[t.estado] || ["", t.estado, ""];
    const prods = Array.isArray(d.productos) ? d.productos : [];
    const publicados = prods.filter(p => p.publicado).length;
    const pedidos = Array.isArray(d.pedidos) ? d.pedidos : [];
    main.innerHTML = `${aviso ? `<p class="vp-msg ok" role="status">${esc(aviso)}</p>` : ""}
      ${d.marketplaceActivo ? "" : '<p class="vp-msg warn">El Marketplace de ELDOSTORE todavía no está abierto al público: por ahora tu tienda y tus productos no se ven en la web.</p>'}
      <section class="vp-card" aria-labelledby="vpT">
        <h1 id="vpT">${esc(t.nombre)} <span class="vp-badge ${e[0]}">${esc(e[1])}</span></h1>
        <p class="vp-muted">${esc(e[2])}${t.motivoEstado && t.estado !== "activo" ? " Motivo: " + esc(t.motivoEstado) : ""}</p>
        <div class="vp-datos">
          <div class="vp-dato"><span>Comisión de ELDOSTORE</span><b>${pct(t.comisionPct)}</b></div>
          <div class="vp-dato"><span>WhatsApp de la tienda</span><b>${esc(t.whatsapp)}</b></div>
          <div class="vp-dato"><span>Localidad</span><b>${esc(t.localidad || "—")}</b></div>
          <div class="vp-dato"><span>Productos publicados</span><b>${publicados} de ${prods.length}</b></div>
        </div>
        ${t.entrega ? `<p><b>Entrega:</b> ${esc(t.entrega)}</p>` : ""}
        ${t.estado === "activo" && d.marketplaceActivo && t.slug ? `<p><a href="index.html#tiendas/${encodeURIComponent(t.slug)}" target="_blank" rel="noopener">Ver mi tienda en la web</a></p>` : ""}
        <p class="vp-muted">${!("puedeEditar" in d) ? "Este portal es de consulta. Para cambiar precios, stock o fotos, escribile a ELDOSTORE." : d.puedeEditar ? "Desde acá cargás tus productos. Cada producto nuevo, o con cambios de nombre, precio, descripción, categoría o fotos, lo revisa ELDOSTORE antes de publicarlo. El stock y las pausas se aplican al instante." : "Tu tienda está bloqueada: no podés cargar ni cambiar productos."} Para cambiar los datos de la tienda, ${contacto("Hola, soy " + (t.nombre || "vendedor asociado") + " y quiero hacer un cambio en mi tienda.")}.</p>
      </section>
      <section class="vp-card" aria-labelledby="vpP">
        <h2 id="vpP">Mis productos (${prods.length})</h2>
        ${d.puedeEditar ? '<p><button class="vp-btn" type="button" data-acc="nuevo">+ Cargar producto</button></p>' : ""}
        <div class="vp-prods">${prods.length ? prods.map(p => {
          const s = PROD[p.estado] || ["", p.estado], foto = url((p.fotos || [])[0]);
          const libre = Number(p.stock) - Number(p.apartado || 0);
          return `<article class="vp-prod" data-id="${esc(p.id)}">${foto ? `<img src="${esc(foto)}" alt="" loading="lazy">` : '<span class="vp-sin">Sin foto</span>'}
            <div class="vp-prod-t"><b>${esc(p.nombre)}</b>
              <small>${esc(p.codigo)}${p.categoria ? " · " + esc(p.categoria) : ""}</small>
              <small>${money(p.precio)} · stock ${Number(p.stock)}${Number(p.apartado) ? " (" + Number(p.apartado) + " apartado en compras sin pagar, " + libre + " libre)" : ""} · comisión ${pct(p.comisionPct)}</small>
              <span><span class="vp-badge ${s[0]}">${esc(s[1])}</span> ${p.bloqueado ? '<span class="vp-badge no">Bloqueado</span>' : ""}
                <span class="vp-badge ${p.publicado ? "ok" : ""}">${p.publicado ? "Se ve en la web" : "No se ve en la web"}</span></span>
              ${p.estado === "pausado" ? `<small>${p.pausadoPor === "vendedor" ? "Lo pausaste vos." : "Lo pausó ELDOSTORE: para reanudarlo, escribile."}</small>` : ""}
              ${p.estado === "rechazado" ? "<small>ELDOSTORE no lo aprobó. Podés corregirlo y se vuelve a revisar.</small>" : ""}
              ${p.motivoBloqueo ? `<small>Motivo: ${esc(p.motivoBloqueo)}</small>` : ""}
              ${d.puedeEditar ? `<div class="vp-acc">
                <label class="vp-stock">Stock <input type="number" min="${Number(p.apartado || 0)}" max="99999" step="1" inputmode="numeric" value="${Number(p.stock)}" data-stock="${esc(p.id)}" aria-label="Stock de ${esc(p.nombre)}"></label>
                <button class="vp-btn sec chico" type="button" data-acc="stock" data-id="${esc(p.id)}">Guardar stock</button>
                <button class="vp-btn sec chico" type="button" data-acc="editar" data-id="${esc(p.id)}">Editar</button>
                ${p.estado === "aprobado" ? `<button class="vp-btn sec chico" type="button" data-acc="pausar" data-id="${esc(p.id)}">Pausar</button>` : ""}
                ${p.estado === "pausado" && p.pausadoPor === "vendedor" ? `<button class="vp-btn sec chico" type="button" data-acc="reanudar" data-id="${esc(p.id)}">Reanudar</button>` : ""}
                ${p.puedeEliminar ? `<button class="vp-btn sec chico peligro" type="button" data-acc="eliminar" data-id="${esc(p.id)}">Eliminar</button>` : ""}
              </div>` : ""}
            </div></article>`;
        }).join("") : '<p class="vp-muted">Todavía no hay productos cargados en tu tienda.</p>'}</div>
      </section>
      <section class="vp-card" aria-labelledby="vpPed">
        <h2 id="vpPed">Mis pedidos${pedidos.length ? " (" + pedidos.length + ")" : ""}</h2>
        ${pedidos.length ? `<p class="vp-muted">Pedidos con pago registrado por ELDOSTORE. La entrega y la liquidación las actualiza ELDOSTORE.</p>
          <div class="vp-datos" style="margin-bottom:12px">
            <div class="vp-dato"><span>A cobrar (entregados o no, sin liquidar)</span><b>${money(pedidos.filter(p => p.compraEstado === "pago_registrado" && !p.liquidado).reduce((a, p) => a + Number(p.paraVos), 0))}</b></div>
            <div class="vp-dato"><span>Ya liquidado</span><b>${money(pedidos.filter(p => p.liquidado).reduce((a, p) => a + Number(p.paraVos), 0))}</b></div>
          </div>
          <div class="vp-prods">${pedidos.map(p => `<article class="vp-prod" style="display:block">
            <b>${esc(p.numero)}</b> <small class="vp-muted">${esc(new Date(p.fecha).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }))}</small>
            <span class="vp-badge ${p.compraEstado === "anulada" ? "no" : p.entrega === "entregado" ? "ok" : "warn"}">${p.compraEstado === "anulada" ? "Anulado" : esc(ENTREGA[p.entrega] || p.entrega)}</span>
            ${p.liquidado ? '<span class="vp-badge ok">Liquidado</span>' : ""}
            <ul style="margin:8px 0;padding-left:18px">${(p.items || []).map(i => `<li>${Number(i.cantidad)} × ${esc(i.nombre)} (${esc(i.codigo)}) · ${money(i.subtotal)}</li>`).join("")}</ul>
            <small>Venta ${money(p.subtotal)} · comisión ELDOSTORE ${money(p.comision)} · <b>para vos ${money(p.paraVos)}</b></small><br>
            <small>Cliente: ${esc(p.cliente.nombre)} · WhatsApp ${esc(p.cliente.whatsapp)}${p.cliente.zona ? " · " + esc(p.cliente.zona) : ""}${p.cliente.notas ? " · «" + esc(p.cliente.notas) + "»" : ""}</small>
          </article>`).join("")}</div>`
          : '<p class="vp-muted">Todavía no hay pedidos. Cuando ELDOSTORE habilite las compras, acá vas a ver los pedidos de tu tienda.</p>'}
      </section>`;
  }


  /* ---------- Productos del vendedor (migración 012) ---------- */
  let PORTAL = null;            // últimos datos del portal
  let BORRADOR = null;          // { id, fotos: [url], subiendo: n }
  const msgPortal = (texto, tipo) => {
    let el = $("#vpAviso");
    if (!el) { el = document.createElement("p"); el.id = "vpAviso"; el.setAttribute("role", "status"); main.prepend(el); }
    el.className = "vp-msg " + (tipo || "ok"); el.textContent = texto; el.scrollIntoView({ block: "nearest" });
  };
  const errTxt = e => (e && e.message ? e.message : String(e || "Error")).replace(/^.*?ERROR:\s*/, "");
  async function recargar(aviso, tipo) {
    const r = await sb.rpc("mkt_portal_vendedor");
    if (r.error) { msgPortal(errTxt(r.error), "err"); return; }
    PORTAL = r.data; dibujarPortal(r.data); if (aviso) msgPortal(aviso, tipo);
  }
  const prodPorId = id => (PORTAL && PORTAL.productos || []).find(p => p.id === id);

  function dibujarFotosBorrador() {
    const caja = $("#vpFotos"); if (!caja) return;
    const f = BORRADOR.fotos;
    caja.innerHTML = f.length ? f.map((u, i) => `<div class="vp-foto"><img src="${esc(url(u))}" alt="Foto ${i + 1}">
        <div class="vp-foto-acc">
          <button type="button" class="vp-btn sec chico" data-foto="izq" data-i="${i}" ${i ? "" : "disabled"} aria-label="Mover la foto ${i + 1} antes">◀</button>
          <button type="button" class="vp-btn sec chico" data-foto="der" data-i="${i}" ${i < f.length - 1 ? "" : "disabled"} aria-label="Mover la foto ${i + 1} después">▶</button>
          <button type="button" class="vp-btn sec chico peligro" data-foto="quitar" data-i="${i}" aria-label="Quitar la foto ${i + 1}">Quitar</button>
        </div></div>`).join("") : '<p class="vp-muted">Todavía no agregaste fotos. La primera es la principal.</p>';
    const est = $("#vpFotosEstado");
    if (est) est.textContent = BORRADOR.subiendo ? `Subiendo ${BORRADOR.subiendo} foto(s)…` : `${f.length} de ${PORTAL.limites.fotosPorProducto} fotos`;
    const g = $("#vpGuardarProd"); if (g) g.disabled = BORRADOR.subiendo > 0;
  }

  function formularioProducto(id) {
    const p = id ? prodPorId(id) : null;
    if (id && !p) { recargar("Ese producto ya no está disponible.", "err"); return; }
    BORRADOR = { id: p ? p.id : null, fotos: p ? (p.fotos || []).slice() : [], subiendo: 0 };
    const cats = PORTAL.categorias || [];
    main.innerHTML = `<section class="vp-card" aria-labelledby="vpFT">
      <h1 id="vpFT">${p ? "Editar producto" : "Cargar producto"}</h1>
      ${p && p.estado !== "pendiente" ? '<p class="vp-msg warn">Si cambiás nombre, precio, descripción, categoría o fotos, el producto deja de verse en la web hasta que ELDOSTORE lo vuelva a aprobar. Cambiar solo el stock no requiere aprobación.</p>'
        : '<p class="vp-muted">El producto queda <b>en revisión</b>: ELDOSTORE lo revisa y lo publica. Te conviene cargar buenas fotos y una descripción clara.</p>'}
      <p class="vp-msg err vp-hidden" id="vpFErr" role="alert"></p>
      <form class="vp-form vp-form-ancho" id="vpProd" novalidate>
        <label for="vpFN">Nombre<input id="vpFN" maxlength="140" required value="${esc(p ? p.nombre : "")}"></label>
        <label for="vpFC">Categoría<select id="vpFC"><option value="">Sin categoría</option>${cats.map(c => `<option value="${esc(c.id)}" ${p && p.categoriaId === c.id ? "selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select></label>
        <div class="vp-dos">
          <label for="vpFP">Precio (ARS)<input id="vpFP" type="number" min="1" step="0.01" inputmode="decimal" required value="${p ? esc(p.precio) : ""}"></label>
          <label for="vpFS">Stock<input id="vpFS" type="number" min="${p ? Number(p.apartado || 0) : 0}" max="99999" step="1" inputmode="numeric" required value="${p ? Number(p.stock) : ""}"></label>
        </div>
        <label for="vpFD">Descripción<textarea id="vpFD" maxlength="2000" rows="5">${esc(p ? p.descripcion : "")}</textarea></label>
        <fieldset class="vp-fs"><legend>Fotos (hasta ${PORTAL.limites.fotosPorProducto})</legend>
          <div class="vp-fotos" id="vpFotos"></div>
          <label class="vp-btn sec" for="vpFArch" style="display:inline-flex;align-items:center;justify-content:center">Agregar fotos</label>
          <input id="vpFArch" type="file" accept="image/*" multiple class="vp-oculto">
          <small class="vp-muted" id="vpFotosEstado"></small>
        </fieldset>
        <div class="vp-dos">
          <button class="vp-btn" type="submit" id="vpGuardarProd">${p ? "Guardar cambios" : "Enviar a revisión"}</button>
          <button class="vp-btn sec" type="button" data-acc="volver">Volver</button>
        </div>
      </form></section>`;
    dibujarFotosBorrador();
    $("#vpFN").focus();
  }

  async function subirFotos(archivos) {
    const max = PORTAL.limites.fotosPorProducto, err = $("#vpFErr");
    const lugar = max - BORRADOR.fotos.length - BORRADOR.subiendo;
    const lista = Array.from(archivos).slice(0, Math.max(0, lugar));
    if (archivos.length > lista.length) { err.textContent = `Podés tener hasta ${max} fotos por producto.`; err.classList.remove("vp-hidden"); }
    await Promise.all(lista.map(async archivo => {
      BORRADOR.subiendo++; dibujarFotosBorrador();
      try {
        if (typeof optimizarImagen !== "function") throw new Error("No se pudo preparar la foto. Recargá la página.");
        const img = await optimizarImagen(archivo, "asociado");
        const ext = ["webp", "jpg", "jpeg", "png"].includes(img.ext) ? img.ext : null;
        if (!ext) throw new Error("Formato de imagen no admitido. Usá JPG o PNG.");
        const azar = Math.random().toString(36).slice(2, 10).padEnd(6, "0");
        const nombre = `${PORTAL.limites.carpetaFotos}/${Date.now()}-${azar}.${ext}`;
        const { error } = await sb.storage.from("productos-fotos").upload(nombre, img.blob, { contentType: img.mime, cacheControl: "31536000", upsert: false });
        if (error) throw new Error("No se pudo subir la foto: " + (error.message || "error"));
        BORRADOR.fotos.push(sb.storage.from("productos-fotos").getPublicUrl(nombre).data.publicUrl);
      } catch (e) {
        err.textContent = errTxt(e); err.classList.remove("vp-hidden");
      } finally {
        BORRADOR.subiendo--; dibujarFotosBorrador();
      }
    }));
  }

  async function guardarProducto() {
    const err = $("#vpFErr"), btn = $("#vpGuardarProd");
    const mal = m => { err.textContent = m; err.classList.remove("vp-hidden"); err.scrollIntoView({ block: "nearest" }); };
    err.classList.add("vp-hidden");
    const nombre = $("#vpFN").value.trim(), precio = $("#vpFP").value.trim(), stock = $("#vpFS").value.trim();
    if (nombre.length < 2) return mal("Escribí el nombre del producto.");
    if (!(Number(precio) > 0)) return mal("El precio tiene que ser mayor que 0.");
    if (!/^\d+$/.test(stock)) return mal("El stock tiene que ser un número entero (0 o más).");
    if (BORRADOR.subiendo) return mal("Esperá a que terminen de subirse las fotos.");
    btn.disabled = true; btn.textContent = "Guardando…";
    const r = await sb.rpc("mkt_vendedor_guardar_producto", { p_id: BORRADOR.id, p_datos: {
      nombre, precio, stock, descripcion: $("#vpFD").value.trim(), categoria_id: $("#vpFC").value || null, fotos: BORRADOR.fotos } });
    if (r.error) { btn.disabled = false; btn.textContent = BORRADOR.id ? "Guardar cambios" : "Enviar a revisión"; return mal(errTxt(r.error)); }
    BORRADOR = null;
    await recargar(r.data.aRevision ? `«${nombre}» quedó en revisión: ELDOSTORE lo va a revisar antes de publicarlo.` : "Cambios guardados.");
  }

  main.addEventListener("change", e => { if (e.target.id === "vpFArch" && e.target.files.length) { subirFotos(e.target.files); e.target.value = ""; } });
  main.addEventListener("submit", e => { if (e.target.id === "vpProd") { e.preventDefault(); guardarProducto(); } });
  main.addEventListener("click", async e => {
    const f = e.target.closest("[data-foto]");
    if (f && BORRADOR) {
      const i = Number(f.dataset.i), a = BORRADOR.fotos;
      if (f.dataset.foto === "quitar") a.splice(i, 1);
      if (f.dataset.foto === "izq" && i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]];
      if (f.dataset.foto === "der" && i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]];
      dibujarFotosBorrador(); return;
    }
    const b = e.target.closest("[data-acc]"); if (!b) return;
    const acc = b.dataset.acc, id = b.dataset.id;
    if (acc === "nuevo") return formularioProducto(null);
    if (acc === "editar") return formularioProducto(id);
    if (acc === "volver") { BORRADOR = null; return recargar(); }
    if (acc === "eliminar" && b.dataset.seguro !== "si") { b.dataset.seguro = "si"; b.textContent = "¿Eliminar? Tocá de nuevo"; return; }
    b.disabled = true;
    let r;
    if (acc === "stock") {
      const v = (main.querySelector(`[data-stock="${CSS.escape(id)}"]`) || {}).value;
      if (!/^\d+$/.test(String(v || "").trim())) { b.disabled = false; return msgPortal("El stock tiene que ser un número entero (0 o más).", "err"); }
      r = await sb.rpc("mkt_vendedor_stock", { p_id: id, p_stock: Number(v) });
      if (!r.error) return recargar("Stock actualizado.");
    }
    if (acc === "pausar" || acc === "reanudar") {
      r = await sb.rpc("mkt_vendedor_pausar", { p_id: id, p_pausar: acc === "pausar" });
      if (!r.error) return recargar(acc === "pausar" ? "Producto pausado: ya no se ve en la web." : "Producto reanudado.");
    }
    if (acc === "eliminar") {
      r = await sb.rpc("mkt_vendedor_eliminar_producto", { p_id: id });
      if (!r.error) return recargar("Producto eliminado.");
    }
    b.disabled = false;
    if (r && r.error) msgPortal(errTxt(r.error), "err");
  });

  // Enlace vencido o ya usado: Supabase vuelve con #error=…&error_code=otp_expired (u otro). Mensaje claro y sin datos en la dirección.
  const errorEnlace = /error_code=|[#&]error=/.test(location.hash);
  if (errorEnlace) history.replaceState(null, "", location.pathname);
  async function iniciar(aviso) {
    const { data: s } = await sb.auth.getSession();
    if (errorEnlace && !s.session) { pantallaIngreso("El enlace venció o ya se usó. Pedile a ELDOSTORE uno nuevo."); return; }
    if (!s.session) { pantallaIngreso(); return; }
    if (vieneDeInvitacion && !aviso) { pantallaContrasena(); return; }
    $("#vpSalir").classList.remove("vp-hidden");
    main.innerHTML = '<div class="vp-card"><p class="vp-muted">Cargando tu tienda…</p></div>';
    const yo = await sb.rpc("mkt_vendedor_actual");
    if (yo.error) { main.innerHTML = '<div class="vp-card"><p class="vp-msg err">El portal todavía no está disponible.</p></div>'; return; }
    if (yo.data.esPanel) {
      main.innerHTML = `<div class="vp-card"><h1>Esta es una cuenta del panel</h1><p class="vp-muted">Este portal es solo para vendedores asociados. Para administrar, usá el <a href="admin.html">panel de ELDOSTORE</a>.</p></div>`;
      return;
    }
    if (!yo.data.esVendedor) {
      main.innerHTML = `<div class="vp-card"><h1>Tu cuenta todavía no está vinculada</h1><p class="vp-muted">ELDOSTORE tiene que vincularla a tu tienda. Si ya pasó un tiempo, ${contacto("Hola, ya tengo mi cuenta del portal de vendedores pero todavía no está vinculada a mi tienda.")}.</p></div>`;
      return;
    }
    const r = await sb.rpc("mkt_portal_vendedor");
    if (r.error) { main.innerHTML = `<div class="vp-card"><p class="vp-msg err">${esc(r.error.message)}</p></div>`; return; }
    PORTAL = r.data;
    dibujarPortal(r.data, aviso);
    document.title = (r.data.tienda && r.data.tienda.nombre ? r.data.tienda.nombre + " | " : "") + "Portal de vendedores | ELDOSTORE";
  }
  iniciar();
})();
