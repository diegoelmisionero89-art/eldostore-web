/* ==========================================================================
   ELDOSTORE — Portal de vendedores asociados (js/vendedor.js)
   Marketplace · Etapa C (migración 008)

   SOLO LECTURA. El vendedor ve únicamente SU tienda y SUS productos (y, desde
   la Etapa D, sus pedidos). No puede modificar nada: todo lo valida la base
   (mkt_portal_vendedor y mkt_vendedor_actual, funciones que filtran por su
   cuenta); esta página no tiene ningún botón que escriba datos.

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
      <p class="vp-muted">Para vendedores asociados a ELDOSTORE. La cuenta te la crea ELDOSTORE por invitación: revisá tu email.</p>
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
        <p class="vp-muted">Este portal es de consulta. Para cambiar datos, precios, stock o fotos, ${contacto("Hola, soy " + (t.nombre || "vendedor asociado") + " y quiero hacer un cambio en mi tienda.")}.</p>
      </section>
      <section class="vp-card" aria-labelledby="vpP">
        <h2 id="vpP">Mis productos (${prods.length})</h2>
        <div class="vp-prods">${prods.length ? prods.map(p => {
          const s = PROD[p.estado] || ["", p.estado], foto = url((p.fotos || [])[0]);
          return `<article class="vp-prod">${foto ? `<img src="${esc(foto)}" alt="" loading="lazy">` : '<span class="vp-sin">Sin foto</span>'}
            <div class="vp-prod-t"><b>${esc(p.nombre)}</b>
              <small>${esc(p.codigo)}${p.categoria ? " · " + esc(p.categoria) : ""}</small>
              <small>${money(p.precio)} · stock ${Number(p.stock)}${Number(p.apartado) ? " (" + Number(p.apartado) + " apartado en compras sin pagar)" : ""} · comisión ${pct(p.comisionPct)}</small>
              <span><span class="vp-badge ${s[0]}">${esc(s[1])}</span> ${p.bloqueado ? '<span class="vp-badge no">Bloqueado</span>' : ""}
                <span class="vp-badge ${p.publicado ? "ok" : ""}">${p.publicado ? "Se ve en la web" : "No se ve en la web"}</span></span>
              ${p.motivoBloqueo ? `<small>Motivo: ${esc(p.motivoBloqueo)}</small>` : ""}</div></article>`;
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

  async function iniciar(aviso) {
    const { data: s } = await sb.auth.getSession();
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
    dibujarPortal(r.data, aviso);
    document.title = (r.data.tienda && r.data.tienda.nombre ? r.data.tienda.nombre + " | " : "") + "Portal de vendedores | ELDOSTORE";
  }
  iniciar();
})();
