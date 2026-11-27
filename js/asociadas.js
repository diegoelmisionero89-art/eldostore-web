/* ==========================================================================
   ELDOSTORE — Tiendas asociadas en la tienda pública (js/asociadas.js)
   Vendedores asociados V1 · migraciones 006 y 008 (Marketplace · Etapa C)

   - Lee todo con la función pública mkt_tienda_publica() (008) o, si todavía no
     está instalada, con tiendas_asociadas() (006). Solo lectura.
     Si el Marketplace está APAGADO (interruptor del panel) o la función no existe,
     no se muestra nada y la tienda queda exactamente como antes.
   - Formulario «Quiero vender» (#quiero-vender): solo con el Marketplace encendido;
     envía la solicitud con mkt_solicitar_alta() y el administrador la aprueba.
   - Etapa D (migración 009, «compras»): los productos de TODAS las tiendas van a una
     sola compra, a la que se pueden sumar los del carrito de ELDOSTORE. Se paga a
     ELDOSTORE (pago completo) y la base calcula precios, comisiones y stock.
     #compra/<enlace privado> muestra el estado de la compra. Sin la 009, cada tienda
     recibe su pedido por WhatsApp (como en la Etapa C). Un carrito SOLO con productos
     de ELDOSTORE sigue funcionando exactamente igual (tienda.js no se toca).
   - Los productos de vendedores NO se mezclan con los de ELDOSTORE: no están
     en catalogo_tienda() («Todos los productos»), ni en el buscador, ni en el
     carrito de ELDOSTORE. Cada tienda tiene su propio pedido, que se envía al
     WhatsApp de ESE vendedor (pago y entrega los coordina él).
   - Direcciones (el botón Atrás funciona):
       #tiendas                     todas las tiendas asociadas
       #tiendas/<tienda>            catálogo de una tienda
       #tiendas/<tienda>/<código>   ficha de un producto
   - El pedido de cada tienda se guarda solo en el navegador del cliente.
   ========================================================================== */
(function () {
  "use strict";
  // Enlace de invitación (o de nueva contraseña) de Supabase: llega a la portada con la sesión en la
  // dirección. Se pasa al portal de vendedores, que pide elegir la contraseña.
  if ((/access_token=/.test(location.hash) && /type=(invite|recovery)/.test(location.hash)) || /error_code=(otp_expired|access_denied)|error=access_denied/.test(location.hash)
      || /^#invitacion=[0-9a-f]{40,128}&tipo=(invite|recovery)$/i.test(location.hash)) {
    location.replace("vendedor.html" + location.hash);
    return;
  }
  const CFG = window.ELDOSTORE_CONFIG || {};
  const CLAVE = "eldostore_asociadas_v1";
  const MAX = 99;

  const $ = s => document.querySelector(s);
  const fmt = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
  const money = n => fmt.format(n).replace(/ /g, " ");
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const limpiar = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const norm = v => String(v == null ? "" : v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const url = v => (typeof v === "string" && /^https:\/\/[^\s"'<>]+$/i.test(v.trim())) ? v.trim() : "";
  const wa = v => { const n = String(v || "").replace(/\D/g, ""); return n.length >= 10 && n.length <= 15 ? n : ""; };
  const WA_SVG = $("#waFab svg") ? $("#waFab svg").outerHTML : "";
  const ATRAS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  const COMPARTIR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>';
  const TIENDA_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9l1.5-5h13L20 9M4 9h16v2a3 3 0 0 1-5.3 1.9A3 3 0 0 1 12 14a3 3 0 0 1-2.7-1.1A3 3 0 0 1 4 11V9zM5 13.5V20h14v-6.5M10 20v-4h4v4"/></svg>';

  /* ---------- Datos ---------- */
  const D = { vendedores: [], productos: [], categorias: [], porSlug: new Map(), listo: false, formulario: false };
  let sb = null;
  /* Video del producto (migración 019): solo los APROBADOS de productos visibles. Cualquier problema → sin video. */
  const vurl = u => (typeof u === "string" && u.length < 400 &&
    /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/productos-videos\/v\/[0-9a-f-]{36}\/[0-9]{10,16}-[a-z0-9]{4,16}\.(mp4|webp|jpg)$/.test(u)) ? u : "";
  async function aplicarVideosAs() {
    try {
      const r = await sb.rpc("mkt_videos_tienda");
      if (r.error || !Array.isArray(r.data)) return;
      const porId = new Map(D.productos.map(p => [p.id, p]));
      for (const f of r.data) {
        const p = f && porId.get(String(f.producto_id)), u = vurl(f.url), po = vurl(f.poster);
        if (p && u && po && /\.mp4$/.test(u)) p.video = { url: u, poster: po, duracion: Math.round(Number(f.duracion) || 0) };
      }
    } catch (e) { /* sin video */ }
  }
  const ICONO_PLAY_AS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
  const itemsAs = p => { const it = p.fotos.map((u, i) => ({ t: "f", u, fi: i })); if (p.video) it.splice(Math.min(1, it.length), 0, Object.assign({ t: "v" }, p.video)); return it; };
  function galeriaVideoAsHTML(v, p) {   // solo para productos CON video; sin video se usa la galería de siempre
    const it = itemsAs(p), n = it.length, nf = p.fotos.length;
    if (fotoI >= n) fotoI = 0;
    const mmss = x => Math.floor(x / 60) + ":" + String(x % 60).padStart(2, "0");
    return `<div class="f-gal"><div class="f-photo${p.disponible ? "" : " is-off"}">${p.disponible ? "" : '<span class="tag grey">Sin stock</span>'}
        <div class="f-track as-track" tabindex="0" aria-label="Fotos y video de ${esc(p.nombre)}">${it.map((x, i) => x.t === "v"
          ? `<div class="f-slide f-vslide"><button type="button" class="f-play" data-as="video" aria-label="Reproducir el video de ${esc(p.nombre)}${x.duracion ? " (" + x.duracion + " segundos)" : ""}"><img src="${esc(x.poster)}" alt="" decoding="async" ${i ? 'loading="lazy"' : ""}><span class="f-play-ic">${ICONO_PLAY_AS}</span>${x.duracion ? `<span class="f-dur">${mmss(x.duracion)}</span>` : ""}</button></div>`
          : `<div class="f-slide"><img src="${esc(x.u)}" alt="${esc(p.nombre)}${nf > 1 ? ", foto " + (x.fi + 1) + " de " + nf : ""}" decoding="async" ${i ? 'loading="lazy"' : ""}></div>`).join("")}</div>
          ${n > 1 ? `<span class="f-count" aria-hidden="true"><b>${fotoI + 1}</b> / ${n}</span>` : ""}
        </div>
        ${n > 1 ? `<div class="f-thumbs">${it.map((x, i) => x.t === "v"
          ? `<button type="button" class="f-th f-th-v" data-as="foto" data-i="${i}" aria-label="Ver el video" aria-current="${i === fotoI}"><img src="${esc(x.poster)}" alt="" loading="lazy"><span class="f-th-play">${ICONO_PLAY_AS}</span></button>`
          : `<button type="button" class="f-th" data-as="foto" data-i="${i}" aria-label="Ver foto ${x.fi + 1}" aria-current="${i === fotoI}"><img src="${esc(x.u)}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
      </div>`;
  }

  async function cargar() {
    if (!window.supabase || !CFG.supabaseUrl) return false;
    try {
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
      // Vista previa PRIVADA (migración 014): con ?vista=<clave> muestra las tiendas aunque el Marketplace esté
      // apagado, SIN compras ni formulario «Quiero vender». Sin clave válida, la tienda queda como siempre.
      let data = null, error = null;
      const clave = (new URLSearchParams(location.search).get("vista") || "").toLowerCase();
      if (/^[0-9a-f]{64}$/.test(clave)) {
        const r = await sb.rpc("mkt_tienda_vista_previa", { p_clave: clave });
        if (!r.error && r.data && r.data.activo === true && r.data.vistaPrevia === true) { data = r.data; D.vistaPrevia = true; }
      }
      if (D.vistaPrevia) {
        D.formulario = false; D.compras = false;
      } else ({ data, error } = await sb.rpc("mkt_tienda_publica"));
      if (D.vistaPrevia) { /* datos de la vista previa */ } else if (error) {   // sin la 008: la función de la 006 (sin interruptor ni formulario)
        ({ data, error } = await sb.rpc("tiendas_asociadas"));
        if (error || !data) { console.info("[ELDOSTORE] Marketplace no disponible: no se muestran tiendas asociadas."); return false; }
      } else {
        if (!data || data.activo !== true) return false;   // interruptor apagado: la tienda queda como siempre
        D.formulario = "formulario" in data ? data.formulario === true : true;   // 016: el administrador decide si está abierto
        D.compras = data.compras === true;   // 009 + 016: compras pagadas a ELDOSTORE (modalidad A) solo si están habilitadas
      }
      D.vendedores = (data.vendedores || []).map(v => ({
        id: String(v.id), slug: String(v.slug || ""), nombre: limpiar(v.nombre, 80), descripcion: String(v.descripcion || "").slice(0, 600),
        logo: url(v.logo), whatsapp: wa(v.whatsapp), localidad: limpiar(v.localidad, 80), entrega: String(v.entrega || "").slice(0, 1000)
      })).filter(v => /^[a-z0-9-]{1,60}$/.test(v.slug) && v.whatsapp);
      const ids = new Map(D.vendedores.map(v => [v.id, v]));
      D.productos = (data.productos || []).map(p => ({
        id: String(p.id), vendedor: ids.get(String(p.vendedorId)), codigo: limpiar(p.codigo, 40), nombre: limpiar(p.nombre, 140) || "Producto",
        descripcion: String(p.descripcion || "").slice(0, 2000), categoria: limpiar(p.categoria, 60),
        categoriaSlug: /^[a-z0-9-]{1,40}$/.test(p.categoriaSlug || "") ? p.categoriaSlug : "",
        precio: Number(p.precio) > 0 ? Math.round(Number(p.precio)) : null, disponible: p.disponible === true,
        fotos: (Array.isArray(p.fotos) ? p.fotos : []).map(url).filter(Boolean).slice(0, 10)
      })).filter(p => p.vendedor);
      D.productos = D.productos.filter(p => p.disponible).concat(D.productos.filter(p => !p.disponible));   // con stock primero
      for (const v of D.vendedores) v.productos = D.productos.filter(p => p.vendedor === v);
      D.porSlug = new Map(D.vendedores.map(v => [v.slug, v]));
      D.categorias = (Array.isArray(data.categorias) ? data.categorias : [])
        .map(c => ({ slug: String(c.slug || ""), nombre: limpiar(c.nombre, 40) }))
        .filter(c => /^[a-z0-9-]{1,40}$/.test(c.slug) && c.nombre && D.productos.some(p => p.categoriaSlug === c.slug));
      await aplicarVideosAs();   // migración 019: videos aprobados (si falla, sin video)
      D.listo = true;
      return true;
    } catch (e) { return false; }
  }

  /* ---------- Pedido por tienda (en el navegador) ---------- */
  let pedidos = {};
  function leer() {
    try {
      const o = JSON.parse(localStorage.getItem(CLAVE) || "{}");
      if (!o || o.v !== 1 || typeof o.p !== "object") return {};
      const r = {};
      for (const [slug, items] of Object.entries(o.p)) {
        if (!items || typeof items !== "object") continue;
        for (const [id, q] of Object.entries(items)) { const n = Math.floor(Number(q)); if (n >= 1) (r[slug] = r[slug] || {})[id] = Math.min(n, MAX); }
      }
      return r;
    } catch (e) { return {}; }
  }
  function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify({ v: 1, p: pedidos })); } catch (e) { /* sin almacenamiento */ } }
  const comprable = p => !!(p && p.disponible && p.precio);
  function lineas(v) {
    const items = pedidos[v.slug] || {};
    return Object.entries(items).map(([id, q]) => ({ p: v.productos.find(x => x.id === id), q })).filter(l => comprable(l.p))
      .map(l => Object.assign(l, { sub: l.p.precio * l.q }));
  }
  function conciliar() {
    for (const slug of Object.keys(pedidos)) {
      const v = D.porSlug.get(slug);
      if (!v) { delete pedidos[slug]; continue; }
      for (const id of Object.keys(pedidos[slug])) if (!comprable(v.productos.find(p => p.id === id))) delete pedidos[slug][id];
      if (!Object.keys(pedidos[slug]).length) delete pedidos[slug];
    }
    guardar();
  }
  function setQ(v, id, q) {
    const n = Math.max(0, Math.min(MAX, Math.floor(q)));
    pedidos[v.slug] = pedidos[v.slug] || {};
    if (n) pedidos[v.slug][id] = n; else delete pedidos[v.slug][id];
    if (!Object.keys(pedidos[v.slug]).length) delete pedidos[v.slug];
    guardar();
  }
  function mensaje(v) {
    const ls = lineas(v), total = ls.reduce((a, l) => a + l.sub, 0);
    const nombre = limpiar(($("#asNombre") || {}).value, 60), zona = limpiar(($("#asZona") || {}).value, 80);
    const r = [`Hola ${v.nombre}, quiero hacer este pedido (lo vi en Tiendas asociadas de ELDOSTORE):`, "", `Vendedor: ${v.nombre}`, ""];
    ls.forEach((l, i) => {
      if (i) r.push("");
      r.push(`${l.q} × ${l.p.nombre}`);
      if (l.p.codigo) r.push(`Código: ${l.p.codigo}`);
      r.push(`— ${money(l.sub)} (${money(l.p.precio)} c/u)`);
    });
    r.push("", `Total estimado: ${money(total)} (sin envío)`);
    if (nombre) r.push(`Nombre: ${nombre}`);
    if (zona) r.push(`Zona o localidad: ${zona}`);
    r.push("", "Quedo a la espera de que me confirmes disponibilidad, forma de pago y entrega.");
    return r.join("\n");
  }
  function consulta(v, p) {
    const r = [`Hola ${v.nombre}, me interesa este producto (lo vi en Tiendas asociadas de ELDOSTORE):`, "", `Producto: ${p.nombre}`];
    if (p.codigo) r.push(`Código: ${p.codigo}`);
    r.push(`Precio: ${p.precio ? money(p.precio) : "a consultar"}`);
    return r.join("\n");
  }

  /* ---------- Sección en la página principal ---------- */
  function iniciales(n) { return esc(n.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase() || "T"); }
  function logoHTML(v, cls) {
    return v.logo ? `<span class="${cls}"><img src="${esc(v.logo)}" alt="" loading="lazy" decoding="async"></span>` : `<span class="${cls} sin-logo" aria-hidden="true">${iniciales(v.nombre)}</span>`;
  }
  function tarjetaTienda(v) {
    const n = v.productos.filter(p => p.disponible).length;
    return `<a class="as-tienda" href="#tiendas/${esc(v.slug)}">
      ${logoHTML(v, "as-logo")}
      <span class="as-tienda-txt"><b>${esc(v.nombre)}</b>
        <small>${v.localidad ? esc(v.localidad) + " · " : ""}${n} producto${n === 1 ? "" : "s"} disponible${n === 1 ? "" : "s"}</small></span>
      <span class="as-ir"><span class="as-ir-txt">Ver tienda</span><span aria-hidden="true">›</span></span></a>`;
  }
  // En la portada y en la lista solo se muestran las tiendas que tienen productos publicados.
  const conProductos = () => D.vendedores.filter(v => v.productos.length);
  function dibujarSeccion() {
    const sec = $("#asociadas"); if (!sec) return;
    const vs = conProductos();
    // A tienda.js: la categoría «Tiendas asociadas» (solo si hay tiendas publicadas) y el flyer «Quiero vender»
    // (solo con el formulario abierto desde el panel).
    document.dispatchEvent(new CustomEvent("eldo:asociadas", { detail: { tiendas: vs.length, vender: D.formulario === true } }));
    // «Quiero vender» (botón de la barra y enlace del menú): solo con el formulario abierto desde el panel.
    for (const id of ["#venderLinkMenu", "#venderLinkHdr"]) { const l = $(id); if (l) l.hidden = !D.formulario; }
    sec.hidden = !vs.length;
    const link = $("#asLinkMenu"); if (link) link.hidden = !vs.length;
    const ver = sec.querySelector(".as-ver"); if (ver) ver.hidden = !vs.length;
    if (sec.hidden) return;
    let cartel = $("#asPrevia");
    if (D.vistaPrevia && !cartel) { cartel = document.createElement("div"); cartel.id = "asPrevia"; cartel.innerHTML = CARTEL_PREVIA; $("#asLista").before(cartel); }
    $("#asLista").innerHTML = vs.slice(0, 8).map(tarjetaTienda).join("") +
      (vs.length > 8 ? `<a class="as-tienda as-todas" href="#tiendas"><span class="as-tienda-txt"><b>Ver las ${vs.length} tiendas</b></span><span class="as-ir" aria-hidden="true">›</span></a>` : "");
  }

  const CARTEL_PREVIA = '<p class="as-previa" role="note"><b>Vista previa privada</b> · no visible al público. Sin compras ni cobros: las consultas y los pedidos van por WhatsApp a cada tienda.</p>';

  /* ---------- Página propia (superpuesta) ---------- */
  const pag = document.createElement("section");
  pag.className = "asp"; pag.id = "asPagina"; pag.hidden = true;
  pag.setAttribute("aria-label", "Tiendas asociadas");
  document.body.appendChild(pag);
  const titulo0 = document.title;
  let ruta = null, foco = null, qFicha = 1, qCard = new Map(), desdeTienda = false, fotoI = 0;

  function leerRuta() {
    const h = location.hash;
    if (h === "#quiero-vender") return { vender: true, slug: "", codigo: "" };
    if (h.startsWith("#compra/")) return { compra: h.slice(8).replace(/[^a-f0-9]/g, "").slice(0, 64), slug: "", codigo: "" };
    if (h !== "#tiendas" && !h.startsWith("#tiendas/")) return null;
    const partes = h.slice(1).split("/").map(x => { try { return decodeURIComponent(x); } catch (e) { return ""; } });
    return { slug: partes[1] || "", codigo: partes.slice(2).join("/") || "" };
  }
  function barra(titulo, v) {
    const ls = v ? lineas(v) : [], u = ls.reduce((a, l) => a + l.q, 0), t = ls.reduce((a, l) => a + l.sub, 0);
    return `<div class="f-bar as-bar">
      <button type="button" class="f-back" data-as="volver" aria-label="Volver">${ATRAS}<span>Volver</span></button>
      <span class="as-bar-t">${esc(titulo)}</span>
      ${D.compras ? botonCompra() : v ? `<button type="button" class="f-cart" data-as="pedido" aria-label="Ver pedido a ${esc(v.nombre)}: ${u} artículos, ${money(t)}">${TIENDA_SVG}<span class="cart-count">${u}</span><span>${money(t)}</span></button>` : "<span></span>"}
    </div>${D.vistaPrevia ? CARTEL_PREVIA : ""}`;
  }
  function cardHTML(v, p, conTienda) {
    const ok = comprable(p) && !conTienda, q = qCard.get(p.id) || 1, en = (pedidos[v.slug] || {})[p.id] || 0;
    const href = `#tiendas/${esc(v.slug)}/${encodeURIComponent(p.codigo)}`;
    return `<article class="card${p.disponible ? "" : " is-off"}" data-id="${esc(p.id)}">
      <a class="pic" href="${href}" aria-label="Ver ${esc(p.nombre)}">${p.disponible ? "" : '<span class="tag grey">Sin stock</span>'}${p.fotos[0] ? `<img src="${esc(p.fotos[0])}" alt="${esc(p.nombre)}" loading="lazy" decoding="async">` : '<span class="ph">' + esc(v.nombre) + "</span>"}</a>
      ${conTienda ? `<p class="cat-lbl">${esc(v.nombre)}</p>` : p.categoria ? `<p class="cat-lbl">${esc(p.categoria)}</p>` : ""}
      <h3 class="name" title="${esc(p.nombre)}"><a href="${href}">${esc(p.nombre)}</a></h3>
      ${p.precio ? `<p class="price">${money(p.precio)}</p>` : '<p class="price na">Consultar precio</p>'}
      ${!p.disponible ? '<span class="stock no">Sin stock</span>' : '<span class="stock ok">Disponible</span>'}
      ${ok ? `<div class="buyrow"><div class="qty" role="group" aria-label="Cantidad de ${esc(p.nombre)}">
          <button type="button" data-as="dec" aria-label="Restar uno" ${q <= 1 ? "disabled" : ""}>−</button><output>${q}</output>
          <button type="button" data-as="inc" aria-label="Sumar uno" ${q >= MAX ? "disabled" : ""}>+</button></div>
          <button class="add" type="button" data-as="add">Agregar</button></div>`
        : conTienda ? `<div class="buyrow"><a class="add" href="${href}">Ver en ${esc(v.nombre)}</a></div>`
        : `<div class="buyrow"><button class="add" type="button" disabled>${p.disponible ? "Consultá por WhatsApp" : "Sin stock"}</button></div>`}
      <p class="incart" ${en ? "" : "hidden"}>En tu pedido: ${en}</p>
    </article>`;
  }
  const filtroTienda = { texto: "" };
  let catSel = "";
  function dibujarTodas() {
    const cat = D.categorias.find(c => c.slug === catSel);
    const prods = cat ? D.productos.filter(p => p.categoriaSlug === cat.slug) : [];
    pag.innerHTML = barra("Tiendas asociadas") + `<div class="f-wrap">
      <h1 class="as-h1" id="asTitulo" tabindex="-1">Tiendas asociadas</h1>
      <p class="as-intro">${D.compras ? "Comercios de la zona que venden a través de ELDOSTORE. Pagás todo junto a ELDOSTORE, en una sola compra, y cada tienda prepara su pedido y coordina la entrega con vos." : "Comercios de la zona que venden a través de ELDOSTORE. Cada tienda recibe su pedido por WhatsApp y coordina con vos el pago y la entrega."}</p>
      ${D.categorias.length ? `<div class="as-cats" role="group" aria-label="Categorías de las tiendas asociadas">
        <button type="button" class="as-cat" data-as="cat" data-c="" aria-pressed="${!cat}">Todas las tiendas</button>
        ${D.categorias.map(c => `<button type="button" class="as-cat" data-as="cat" data-c="${esc(c.slug)}" aria-pressed="${catSel === c.slug}">${esc(c.nombre)}</button>`).join("")}</div>` : ""}
      ${cat ? `<div class="products as-prods">${prods.map(p => cardHTML(p.vendedor, p, true)).join("")}</div>`
        : `<div class="as-grid">${conProductos().map(tarjetaTienda).join("") || '<div class="state"><b>Todavía no hay tiendas asociadas.</b></div>'}</div>`}
      ${D.formulario ? '<p class="as-intro" style="margin-top:18px">¿Tenés un emprendimiento en la zona? <a href="#quiero-vender"><b>Quiero vender en ELDOSTORE</b></a></p>' : ""}</div>`;
    document.title = (cat ? cat.nombre + " | " : "") + "Tiendas asociadas | ELDOSTORE";
  }
  function dibujarTienda(v) {
    const t = norm(filtroTienda.texto);
    const lista = v.productos.filter(p => !t || norm(p.nombre + " " + p.categoria + " " + p.codigo).includes(t));
    const ls = lineas(v);
    pag.innerHTML = barra(v.nombre, v) + `<div class="f-wrap">
      <header class="as-cab">
        ${logoHTML(v, "as-logo grande")}
        <div class="as-cab-txt"><p class="as-sello">Tienda asociada a ELDOSTORE</p>
          <h1 class="as-h1" id="asTitulo" tabindex="-1">${esc(v.nombre)}</h1>
          ${v.localidad ? `<p class="as-loc">${esc(v.localidad)}</p>` : ""}
          ${v.descripcion ? `<p class="as-desc">${esc(v.descripcion)}</p>` : ""}
          ${v.entrega ? `<p class="as-desc"><b>Entrega:</b> ${esc(v.entrega)}</p>` : ""}
          <a class="f-wa as-wa" href="https://wa.me/${v.whatsapp}?text=${encodeURIComponent("Hola " + v.nombre + ", te escribo desde Tiendas asociadas de ELDOSTORE.")}" target="_blank" rel="noopener noreferrer">${WA_SVG}Escribir a ${esc(v.nombre)}</a>
          <button type="button" class="as-compartir" data-as="compartir">${COMPARTIR_SVG}Compartir tienda</button>
        </div>
      </header>
      <p class="as-aviso">${D.compras ? `Los productos de esta tienda los vende y entrega <b>${esc(v.nombre)}</b>. Pagás tu compra a ELDOSTORE (una sola vez, aunque compres en varias tiendas) y ${esc(v.nombre)} recibe su pedido y coordina la entrega con vos.` : `Los productos de esta tienda los vende y entrega <b>${esc(v.nombre)}</b>. El pedido se envía a su WhatsApp y el pago se coordina con el vendedor. No se suman a tu carrito de ELDOSTORE.`}</p>
      ${v.productos.length > 8 ? `<label class="search as-buscar"><span class="sr">Buscar en ${esc(v.nombre)}</span><input type="search" id="asBuscar" placeholder="Buscar en ${esc(v.nombre)}…" value="${esc(filtroTienda.texto)}" autocomplete="off"></label>` : ""}
      <div class="products as-prods" id="asProds">${lista.length ? lista.map(p => cardHTML(v, p)).join("")
        : `<div class="state"><b>${v.productos.length ? "No encontramos productos con esa búsqueda." : "Esta tienda todavía no tiene productos publicados."}</b></div>`}</div>
      ${D.compras ? flotaCompra() : ls.length ? `<button type="button" class="as-flota" data-as="pedido">${TIENDA_SVG}<span>Ver pedido a ${esc(v.nombre)} · <b>${money(ls.reduce((a, l) => a + l.sub, 0))}</b></span></button>` : ""}
    </div>`;
    document.title = v.nombre + " | Tiendas asociadas | ELDOSTORE";
  }
  function dibujarFicha(v, p) {
    const vivo = pag.querySelector("video.f-video"), mismo = vivo && vivo.dataset.pid === p.id;   // migración 019
    dibujarFichaBase(v, p);
    if (mismo) { const b = pag.querySelector(".f-vslide .f-play"); if (b) b.replaceWith(vivo); }
    if (p.video) { const t = pag.querySelector(".as-track"); if (t && fotoI) t.scrollLeft = fotoI * t.clientWidth; }   // con video: misma posición
  }
  function dibujarFichaBase(v, p) {
    const ok = comprable(p), en = (pedidos[v.slug] || {})[p.id] || 0;
    if (fotoI >= (p.video ? itemsAs(p).length : p.fotos.length)) fotoI = 0;
    pag.innerHTML = barra(v.nombre, v) + `<div class="f-wrap"><div class="f-main">
      ${p.video ? galeriaVideoAsHTML(v, p) : `      <div class="f-gal"><div class="f-photo${p.disponible ? "" : " is-off"}">${p.disponible ? "" : '<span class="tag grey">Sin stock</span>'}
        ${p.fotos.length ? `<div class="f-track as-track" tabindex="0" aria-label="Fotos de ${esc(p.nombre)}">${p.fotos.map((u, i) => `<div class="f-slide"><img src="${esc(u)}" alt="${esc(p.nombre)}${p.fotos.length > 1 ? ", foto " + (i + 1) + " de " + p.fotos.length : ""}" decoding="async" ${i ? 'loading="lazy"' : ""}></div>`).join("")}</div>
          ${p.fotos.length > 1 ? `<span class="f-count" aria-hidden="true"><b>${fotoI + 1}</b> / ${p.fotos.length}</span>` : ""}` : '<span class="ph">' + esc(v.nombre) + "</span>"}
        </div>
        ${p.fotos.length > 1 ? `<div class="f-thumbs">${p.fotos.map((u, i) => `<button type="button" class="f-th" data-as="foto" data-i="${i}" aria-label="Ver foto ${i + 1}" aria-current="${i === fotoI}"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
      </div>`}
      <div class="f-info">
        <a class="as-de" href="#tiendas/${esc(v.slug)}">${logoHTML(v, "as-logo mini")}<span>Vendido por <b>${esc(v.nombre)}</b></span></a>
        ${p.categoria ? `<p class="cat-lbl">${esc(p.categoria)}</p>` : ""}
        <h1 class="f-name" id="asTitulo" tabindex="-1">${esc(p.nombre)}</h1>
        ${p.codigo ? `<p class="f-code">Código: <span>${esc(p.codigo)}</span></p>` : ""}
        ${p.precio ? `<p class="f-price">${money(p.precio)}</p>` : '<p class="f-price na">Consultar precio</p>'}
        ${!p.disponible ? '<span class="stock no">Sin stock</span>' : '<span class="stock ok">Disponible</span>'}
        ${ok ? `<div class="f-buy"><div class="qty" role="group" aria-label="Cantidad">
            <button type="button" data-as="fdec" aria-label="Restar uno" ${qFicha <= 1 ? "disabled" : ""}>−</button><output>${qFicha}</output>
            <button type="button" data-as="finc" aria-label="Sumar uno" ${qFicha >= MAX ? "disabled" : ""}>+</button></div>
            <button type="button" class="add f-add" data-as="fadd">Agregar al pedido</button></div>`
          : `<div class="f-buy"><button type="button" class="add f-add" disabled>${p.disponible ? "Precio a confirmar" : "Sin stock"}</button></div>`}
        <p class="incart" ${en ? "" : "hidden"}>En tu pedido a ${esc(v.nombre)}: ${en}</p>
        ${p.descripcion ? `<div class="as-pdesc">${esc(p.descripcion).replace(/\n/g, "<br>")}</div>` : ""}
        <ul class="f-notes"><li>Lo vende y entrega ${esc(v.nombre)}${v.localidad ? " (" + esc(v.localidad) + ")" : ""}.</li><li>${D.compras ? "Pagás a ELDOSTORE y la entrega la coordina " + esc(v.nombre) + " con vos." : "El pago y la entrega se coordinan con el vendedor por WhatsApp."}</li></ul>
        <a class="f-wa" href="https://wa.me/${v.whatsapp}?text=${encodeURIComponent(consulta(v, p))}" target="_blank" rel="noopener noreferrer">${WA_SVG}Consultar a ${esc(v.nombre)}</a>
        <button type="button" class="as-compartir" data-as="compartir" data-p="${esc(p.codigo)}">${COMPARTIR_SVG}Compartir producto</button>
      </div></div></div>`;
    document.title = p.nombre + " | " + v.nombre + " | ELDOSTORE";
  }

  /* ---------- Formulario «Quiero vender» (solo con el Marketplace encendido) ---------- */
  let enviado = false;
  function dibujarFormulario() {
    document.title = "Quiero vender | ELDOSTORE";
    if (!D.formulario) {
      pag.innerHTML = barra("Quiero vender") + '<div class="f-wrap"><div class="state"><b>Por ahora no estamos recibiendo solicitudes de vendedores.</b></div></div>';
      return;
    }
    pag.innerHTML = barra("Quiero vender") + `<div class="f-wrap as-form-wrap">
      <h1 class="as-h1" id="asTitulo" tabindex="-1">Quiero vender en ELDOSTORE</h1>
      <p class="as-intro">Completá tus datos y te escribiremos por WhatsApp para contarte cómo funciona. Enviar la solicitud no te compromete a nada.</p>
      <ul class="vc-puntos as-cond">
        <li>Tu negocio tendrá su propio espacio dentro de ELDOSTORE.</li>
        <li>Podrás publicar tus productos, fotos, precios y disponibilidad.</li>
        <li>Los clientes podrán conocer tu catálogo y comunicarse directamente con vos.</li>
        <li>El cliente te paga directamente a vos y vos coordinás la entrega.</li>
        <li>Si no tenés tiempo o conocimientos técnicos, podemos cargar tus productos y fotos por vos.</li>
      </ul>
      ${enviado ? `<div class="as-ok" role="status" tabindex="-1"><b>¡Recibimos tu solicitud!</b><br>Quedó pendiente de revisión. Te escribiremos por WhatsApp para contarte los próximos pasos.</div>` : `
      <form class="fields as-form" id="asForm" novalidate>
        <label for="avNombre">Nombre y apellido *<input id="avNombre" maxlength="80" required autocomplete="name"></label>
        <label for="avTienda">Nombre de tu negocio o emprendimiento *<input id="avTienda" maxlength="80" required autocomplete="organization"></label>
        <label for="avWa">WhatsApp *<input id="avWa" inputmode="tel" maxlength="20" required placeholder="Ej.: 3751 112233" autocomplete="tel"></label>
        <label for="avLoc">Localidad *<input id="avLoc" maxlength="80" required placeholder="Ej.: Eldorado" autocomplete="address-level2"></label>
        <label for="avRubro">¿Qué productos querés vender? *<input id="avRubro" maxlength="80" required placeholder="Ej.: ropa, velas artesanales, mates"></label>
        <label for="avMsg">Descripción breve de tu emprendimiento *<textarea id="avMsg" rows="4" maxlength="1000" required placeholder="Contanos qué hacés, hace cuánto y cómo entregás hoy."></textarea></label>
        <label for="avEmail">Email (opcional)<input id="avEmail" type="email" maxlength="120" autocomplete="email"></label>
        <label class="as-trampa" aria-hidden="true">No completar<input id="avWeb" tabindex="-1" autocomplete="off"></label>
        <p class="status" id="avEstado" role="alert" hidden></p>
        <button class="send" type="submit" id="avEnviar">Enviar solicitud</button>
        <p class="legal">Usamos estos datos solo para contactarte sobre tu solicitud. Ninguna tienda se publica sin revisión.</p>
      </form>`}</div>`;
  }
  function waIntl(v) {
    let d = String(v || "").replace(/\D/g, "");
    if (d.startsWith("0")) d = d.slice(1);
    if (d.length === 10) d = "549" + d;
    if (d.length === 12 && d.startsWith("54") && d[2] !== "9") d = "549" + d.slice(2);
    return d;
  }
  pag.addEventListener("submit", async e => {
    if (e.target.id !== "asForm") return;
    e.preventDefault();
    const val = id => ($("#" + id) || {}).value || "";
    const est = $("#avEstado"), btn = $("#avEnviar");
    const err = m => { est.textContent = m; est.hidden = false; };
    const datos = { nombre_tienda: limpiar(val("avTienda"), 80), responsable: limpiar(val("avNombre"), 80), whatsapp: waIntl(val("avWa")),
      email: limpiar(val("avEmail"), 120), localidad: limpiar(val("avLoc"), 80), rubro: limpiar(val("avRubro"), 80),
      mensaje: String(val("avMsg")).trim().slice(0, 1000), web: val("avWeb") };
    if (datos.responsable.length < 3) return err("Escribí tu nombre y apellido.");
    if (datos.nombre_tienda.length < 2) return err("Escribí el nombre de tu negocio o emprendimiento.");
    if (!/^\d{10,15}$/.test(datos.whatsapp)) return err("Revisá el WhatsApp: código de área y número, por ejemplo 3751 112233.");
    if (datos.localidad.length < 2) return err("Escribí tu localidad.");
    if (datos.rubro.length < 3) return err("Contanos qué productos querés vender.");
    if (datos.mensaje.length < 10) return err("Escribí una descripción breve de tu emprendimiento (al menos 10 letras).");
    if (datos.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datos.email)) return err("Revisá el email.");
    btn.disabled = true; btn.textContent = "Enviando…"; est.hidden = true;
    try {
      const { error } = await sb.rpc("mkt_solicitar_alta", { p_datos: datos });
      if (error) throw error;
      enviado = true; dibujarFormulario();
      const ok = pag.querySelector(".as-ok"); if (ok) ok.focus && ok.focus();
    } catch (x) {
      err((x && x.message) || "No se pudo enviar. Probá de nuevo en un rato.");
      btn.disabled = false; btn.textContent = "Enviar solicitud";
    }
  });

  /* ---------- Etapa D: una sola compra con productos de varias tiendas (+ los de ELDOSTORE) ---------- */
  const CLAVE_COMPRAS = "eldostore_mis_compras_v1";
  const CLAVE_CARRITO_ELDO = "eldostore_carrito_v1";   // el carrito de tienda.js (solo se LEE; se vacía al incluirlo)
  function todasLasLineas() {
    return D.vendedores.flatMap(v => lineas(v).map(l => Object.assign(l, { v })));
  }
  function carritoEldo() {
    try {
      const o = JSON.parse(localStorage.getItem(CLAVE_CARRITO_ELDO) || "{}");
      if (!o || o.v !== 1 || typeof o.items !== "object" || !o.items) return [];
      return Object.entries(o.items).filter(([k, q]) => /^id:[0-9a-f-]{36}$/.test(k) && Math.floor(Number(q)) >= 1)
        .map(([k, q]) => ({ id: k.slice(3), cantidad: Math.min(99, Math.floor(Number(q))) }));
    } catch (e) { return []; }
  }
  function botonCompra() {
    const ls = todasLasLineas(), u = ls.reduce((a, l) => a + l.q, 0), t = ls.reduce((a, l) => a + l.sub, 0);
    return `<button type="button" class="f-cart" data-as="pedido" aria-label="Ver mi compra en tiendas asociadas: ${u} artículos, ${money(t)}">${TIENDA_SVG}<span class="cart-count">${u}</span><span>${money(t)}</span></button>`;
  }
  function flotaCompra() {
    const ls = todasLasLineas(); if (!ls.length) return "";
    return `<button type="button" class="as-flota" data-as="pedido">${TIENDA_SVG}<span>Ver mi compra · <b>${money(ls.reduce((a, l) => a + l.sub, 0))}</b></span></button>`;
  }
  function misCompras() { try { const a = JSON.parse(localStorage.getItem(CLAVE_COMPRAS) || "[]"); return Array.isArray(a) ? a.filter(x => x && /^[a-f0-9]{64}$/.test(x.token)).slice(0, 20) : []; } catch (e) { return []; } }
  function guardarMiCompra(c) { try { localStorage.setItem(CLAVE_COMPRAS, JSON.stringify([{ token: c.token, numero: c.numero }].concat(misCompras()).slice(0, 20))); } catch (e) { /* sin almacenamiento */ } }

  let compraAbierta = false, enviandoCompra = false;
  function abrirCompra() { compraAbierta = true; focoHoja = document.activeElement; dibujarHojaCompra(); hoja.hidden = false; const b = hoja.querySelector("[data-as=cerrar]"); if (b) b.focus(); }
  function dibujarHojaCompra(error) {
    const ls = todasLasLineas(), eldo = carritoEldo(), uEldo = eldo.reduce((a, x) => a + x.cantidad, 0);
    const total = ls.reduce((a, l) => a + l.sub, 0);
    const val = id => esc(($("#" + id) || {}).value || "");
    const porTienda = D.vendedores.map(v => ({ v, ls: ls.filter(l => l.v === v) })).filter(x => x.ls.length);
    hoja.innerHTML = `<div class="as-hoja-box" role="dialog" aria-modal="true" aria-labelledby="asCompT">
      <div class="pan-hd"><h2 id="asCompT">Tu compra en tiendas asociadas</h2>
        <button class="x-btn" type="button" data-as="cerrar" aria-label="Cerrar">✕</button></div>
      <div class="as-hoja-cuerpo">${ls.length ? porTienda.map(({ v, ls }) => `
        <p class="as-de-tienda">Lo vende y entrega <b>${esc(v.nombre)}</b></p>
        <ul class="items">${ls.map(({ p, q, sub }) => `<li class="it" data-id="${esc(p.id)}" data-slug="${esc(v.slug)}">
          <div class="it-ph">${p.fotos[0] ? `<img src="${esc(p.fotos[0])}" alt="">` : ""}</div>
          <div style="min-width:0"><div class="it-top"><div style="min-width:0"><p class="it-nm">${esc(p.nombre)}</p><p class="it-unit">${esc(p.codigo)} · ${money(p.precio)} c/u</p></div>
            <button class="rm" type="button" data-as="crm" aria-label="Quitar ${esc(p.nombre)}">✕</button></div>
            <div class="it-row"><div class="qty" role="group" aria-label="Cantidad de ${esc(p.nombre)}">
              <button type="button" data-as="cdec" aria-label="Restar uno">−</button><output>${q}</output>
              <button type="button" data-as="cinc" aria-label="Sumar uno" ${q >= MAX ? "disabled" : ""}>+</button></div>
              <span class="it-sub">${money(sub)}</span></div></div></li>`).join("")}</ul>`).join("") + `
        ${uEldo ? `<label class="as-incluir"><input type="checkbox" id="asConEldo" checked> Sumar a esta compra ${uEldo === 1 ? "el producto" : "los " + uEldo + " productos"} de tu carrito de ELDOSTORE</label>` : ""}
        <form class="fields" id="asCompraForm" onsubmit="return false">
          <label for="acNombre">Tu nombre *<input id="acNombre" maxlength="80" autocomplete="name" value="${val("acNombre")}"></label>
          <label for="acWa">Tu WhatsApp *<input id="acWa" inputmode="tel" maxlength="20" placeholder="Ej.: 3751 112233" autocomplete="tel" value="${val("acWa")}"></label>
          <label for="acZona">Zona o dirección de entrega<input id="acZona" maxlength="120" value="${val("acZona")}"></label>
          <label for="acNotas">Notas (opcional)<input id="acNotas" maxlength="300" value="${val("acNotas")}"></label>
        </form>
        ${error ? `<p class="status" role="alert">${esc(error)}</p>` : ""}`
        : '<div class="cart-empty"><p>Todavía no agregaste productos de tiendas asociadas.</p></div>'}
      </div>
      ${ls.length ? `<div class="cart-ft"><div class="tot"><span>Total de tiendas asociadas${uEldo ? " (+ ELDOSTORE si lo sumás)" : ""}</span><strong>${money(total)}</strong></div>
        <button class="send as-btn-compra" type="button" data-as="confirmar" ${enviandoCompra ? "disabled" : ""}>${enviandoCompra ? "Creando tu compra…" : "Confirmar compra"}</button>
        <p class="legal">Pagás todo junto a ELDOSTORE (pago completo). El precio final lo confirma la tienda al crear la compra. Cada tienda prepara y entrega sus productos.</p></div>` : ""}
    </div>`;
  }
  async function confirmarCompra() {
    const val = id => ($("#" + id) || {}).value || "";
    const nombre = limpiar(val("acNombre"), 80), wa = String(val("acWa")).replace(/\D/g, "");
    if (nombre.length < 2) return dibujarHojaCompra("Escribí tu nombre.");
    if (wa.length < 10) return dibujarHojaCompra("Revisá tu WhatsApp: código de área y número.");
    const conEldo = !!($("#asConEldo") || {}).checked, eldo = conEldo ? carritoEldo() : [];
    const items = todasLasLineas().map(l => ({ tipo: "mkt", id: l.p.id, cantidad: l.q })).concat(eldo.map(x => ({ tipo: "eldo", id: x.id, cantidad: x.cantidad })));
    enviandoCompra = true; dibujarHojaCompra();
    try {
      const { data, error } = await sb.rpc("mkt_crear_compra", { p_datos: { cliente_nombre: nombre, cliente_whatsapp: wa,
        cliente_zona: limpiar(val("acZona"), 120), notas: limpiar(val("acNotas"), 300), items } });
      if (error) throw error;
      guardarMiCompra(data);
      pedidos = {}; guardar();
      if (eldo.length) { try { localStorage.removeItem(CLAVE_CARRITO_ELDO); } catch (e) { /* sin almacenamiento */ } }
      enviandoCompra = false;
      location.hash = "#compra/" + data.token;
      if (eldo.length) location.reload();   // el carrito de ELDOSTORE se vuelve a leer vacío
      else { cerrarPedido(); redibujar(); }
    } catch (x) {
      enviandoCompra = false;
      dibujarHojaCompra((x && x.message) || "No se pudo crear la compra. Probá de nuevo.");
    }
  }
  const ESTADO_COMPRA = { pendiente_pago: ["Esperando tu pago", "warn"], pago_registrado: ["Pago registrado", "ok"], pago_acreditado: ["Pago acreditado", "ok"],
    cancelada: ["Cancelada", "off"], vencida: ["Vencida (no se registró el pago a tiempo)", "off"], anulada: ["Anulada", "off"] };
  const ENTREGA = { pendiente: "Pendiente", preparando: "En preparación", entregado: "Entregado", cancelado: "Cancelado" };
  async function dibujarMiCompra(token) {
    pag.innerHTML = barra("Mi compra") + '<div class="f-wrap"><div class="state"><b>Cargando tu compra…</b></div></div>';
    document.title = "Mi compra | ELDOSTORE";
    const { data: c, error } = await sb.rpc("mkt_ver_compra", { p_token: token });
    if (!ruta || ruta.compra !== token) return;
    if (error || !c) { pag.innerHTML = barra("Mi compra") + `<div class="f-wrap"><div class="state"><b>No encontramos esa compra.</b><br>Revisá el enlace.</div></div>`; return; }
    const [txt, cls] = ESTADO_COMPRA[c.estado] || [c.estado, "off"];
    const msg = `Hola ELDOSTORE, hice la compra ${c.numero} por ${money(c.total)}. Te envío el comprobante de pago.`;
    pag.innerHTML = barra("Compra " + c.numero) + `<div class="f-wrap as-compra">
      <h1 class="as-h1" id="asTitulo" tabindex="-1">Compra ${esc(c.numero)}</h1>
      <p><span class="as-est ${cls}">${esc(txt)}</span></p>
      <p class="as-total">Total: <b>${money(c.total)}</b></p>
      ${c.estado === "pendiente_pago" ? `<div class="as-aviso"><b>Cómo pagar:</b> transferí el total exacto${c.instrucciones ? ":<br>" + esc(c.instrucciones).replace(/\n/g, "<br>") : "."}
        <br>Tenés tiempo hasta el ${esc(new Date(c.vence).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }))}. Solo aceptamos el pago completo.</div>
        ${CFG.whatsapp ? `<a class="f-wa" href="https://wa.me/${esc(CFG.whatsapp)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener noreferrer">${WA_SVG}Enviar el comprobante a ELDOSTORE</a>` : ""}` : ""}
      ${c.pedidos.map(pe => `<section class="as-ped"><h2>${pe.esEldostore ? "ELDOSTORE" : esc(pe.vendedor)} <small>${esc(pe.numero)} · ${esc(ENTREGA[pe.entrega] || pe.entrega)}</small></h2>
        <ul>${(pe.items || []).map(i => `<li>${i.cantidad} × ${esc(i.nombre)} <span>${money(i.subtotal)}</span></li>`).join("")}</ul>
        <p class="as-ped-sub">Subtotal ${money(pe.subtotal)}${pe.esEldostore ? "" : " · lo entrega " + esc(pe.vendedor)}</p></section>`).join("")}
      ${c.estado === "pendiente_pago" ? `<button type="button" class="as-cancelar" data-as="cancelar-compra" data-t="${esc(token)}">Cancelar esta compra</button>` : ""}
      <p class="as-intro">Guardá este enlace: es privado y te muestra el estado de tu compra.</p></div>`;
  }
  pag.addEventListener("click", async e => {
    const b = e.target.closest("[data-as=cancelar-compra]"); if (!b) return;
    if (!confirm("¿Cancelar la compra? Si ya transferiste, escribinos antes por WhatsApp.")) return;
    b.disabled = true;
    const { error } = await sb.rpc("mkt_cancelar_compra", { p_token: b.dataset.t });
    if (error) { toast(esc(error.message)); b.disabled = false; return; }
    dibujarMiCompra(b.dataset.t);
  });

  /* Hoja con el pedido de la tienda */
  const hoja = document.createElement("div");
  hoja.className = "as-hoja"; hoja.hidden = true;
  document.body.appendChild(hoja);
  let hojaV = null, focoHoja = null;
  function abrirPedido(v) {
    hojaV = v; focoHoja = document.activeElement;
    dibujarPedido(); hoja.hidden = false;
    const b = hoja.querySelector("[data-as=cerrar]"); if (b) b.focus();
  }
  function cerrarPedido() { if (hoja.hidden) return; hoja.hidden = true; hoja.innerHTML = ""; hojaV = null; compraAbierta = false; if (focoHoja && document.body.contains(focoHoja)) focoHoja.focus(); }
  function dibujarPedido() {
    const v = hojaV; if (!v) return;
    const ls = lineas(v), total = ls.reduce((a, l) => a + l.sub, 0), u = ls.reduce((a, l) => a + l.q, 0);
    const nom = ($("#asNombre") || {}).value || "", zona = ($("#asZona") || {}).value || "";
    hoja.innerHTML = `<div class="as-hoja-box" role="dialog" aria-modal="true" aria-labelledby="asPedT">
      <div class="pan-hd"><h2 id="asPedT">Pedido a ${esc(v.nombre)} ${u ? "(" + u + ")" : ""}</h2>
        <button class="x-btn" type="button" data-as="cerrar" aria-label="Cerrar pedido">✕</button></div>
      <div class="as-hoja-cuerpo">${ls.length ? `
        <ul class="items">${ls.map(({ p, q, sub }) => `<li class="it" data-id="${esc(p.id)}">
          <div class="it-ph">${p.fotos[0] ? `<img src="${esc(p.fotos[0])}" alt="">` : ""}</div>
          <div style="min-width:0"><div class="it-top"><div style="min-width:0"><p class="it-nm">${esc(p.nombre)}</p><p class="it-unit">${esc(p.codigo)} · ${money(p.precio)} c/u</p></div>
            <button class="rm" type="button" data-as="rm" aria-label="Quitar ${esc(p.nombre)}">✕</button></div>
            <div class="it-row"><div class="qty" role="group" aria-label="Cantidad de ${esc(p.nombre)}">
              <button type="button" data-as="pdec" aria-label="Restar uno">−</button><output>${q}</output>
              <button type="button" data-as="pinc" aria-label="Sumar uno" ${q >= MAX ? "disabled" : ""}>+</button></div>
              <span class="it-sub">${money(sub)}</span></div></div></li>`).join("")}</ul>
        <form class="fields" onsubmit="return false">
          <label for="asNombre">Nombre (opcional)<input id="asNombre" maxlength="60" autocomplete="name" value="${esc(nom)}"></label>
          <label for="asZona">Zona o localidad (opcional)<input id="asZona" maxlength="80" value="${esc(zona)}"></label>
        </form>
        <details class="preview"><summary>Ver el mensaje que se va a enviar</summary><pre id="asMsg">${esc(mensaje(v))}</pre></details>`
        : '<div class="cart-empty"><p>Todavía no agregaste productos de esta tienda.</p></div>'}
      </div>
      ${ls.length ? `<div class="cart-ft"><div class="tot"><span>Total estimado (sin envío)</span><strong>${money(total)}</strong></div>
        <a class="send" id="asEnviar" href="https://wa.me/${v.whatsapp}?text=${encodeURIComponent(mensaje(v))}" target="_blank" rel="noopener noreferrer">${WA_SVG}Enviar pedido a ${esc(v.nombre)}</a>
        <p class="status" id="asEstado" role="status" hidden></p>
        <p class="legal">El pedido llega al WhatsApp de ${esc(v.nombre)}, que te confirma disponibilidad, precio final, forma de pago y entrega. ELDOSTORE no cobra este pedido.</p></div>` : ""}
    </div>`;
  }
  hoja.addEventListener("input", () => {
    if (!hojaV || compraAbierta) return;
    const t = mensaje(hojaV), pre = $("#asMsg"), a = $("#asEnviar");
    if (pre) pre.textContent = t;
    if (a) a.href = `https://wa.me/${hojaV.whatsapp}?text=` + encodeURIComponent(t);
  });
  hoja.addEventListener("click", e => {
    if (!compraAbierta) return;
    if (e.target === hoja) { cerrarPedido(); return; }
    const b = e.target.closest("[data-as]"); if (!b) return;
    if (b.dataset.as === "cerrar") { cerrarPedido(); return; }
    if (b.dataset.as === "confirmar") { confirmarCompra(); return; }
    const li = b.closest(".it"); if (!li) return;
    const v = D.porSlug.get(li.dataset.slug), id = li.dataset.id; if (!v) return;
    const q = (pedidos[v.slug] || {})[id] || 0;
    if (b.dataset.as === "cinc") setQ(v, id, q + 1);
    if (b.dataset.as === "cdec") setQ(v, id, q - 1);
    if (b.dataset.as === "crm") setQ(v, id, 0);
    dibujarHojaCompra(); redibujar();
    const again = hoja.querySelector(`.it[data-id="${CSS.escape(id)}"] [data-as="${b.dataset.as}"]`);
    (again && !again.disabled ? again : hoja.querySelector("[data-as=cerrar]")).focus();
  });
  hoja.addEventListener("click", e => {
    if (compraAbierta) return;
    if (e.target === hoja) { cerrarPedido(); return; }
    const b = e.target.closest("[data-as]"); if (!b) return;
    const v = hojaV; if (!v) return;
    if (b.dataset.as === "cerrar") { cerrarPedido(); return; }
    if (b.id === "asEnviar") return;
    const id = b.closest(".it") && b.closest(".it").dataset.id, q = id ? (pedidos[v.slug] || {})[id] || 0 : 0;
    if (b.dataset.as === "pinc") setQ(v, id, q + 1);
    if (b.dataset.as === "pdec") setQ(v, id, q - 1);
    if (b.dataset.as === "rm") setQ(v, id, 0);
    dibujarPedido(); redibujar();
    const again = id && hoja.querySelector(`.it[data-id="${CSS.escape(id)}"] [data-as="${b.dataset.as}"]`);
    (again && !again.disabled ? again : hoja.querySelector("[data-as=cerrar]")).focus();
  });
  hoja.addEventListener("click", e => {
    if (compraAbierta || !e.target.closest("#asEnviar")) return;
    const s = $("#asEstado");
    if (s) { s.textContent = `Se abrió WhatsApp con tu pedido para ${hojaV.nombre}. Enviá el mensaje desde WhatsApp para que te responda.`; s.hidden = false; }
  });

  /* ---------- Navegación ---------- */
  let tToast;
  /* Compartir una tienda o un producto: el menú del teléfono (WhatsApp, Instagram…) o, si no hay, copiar el enlace. */
  async function compartir(v, p) {
    const enlace = location.origin + location.pathname + "#tiendas/" + encodeURIComponent(v.slug) + (p ? "/" + encodeURIComponent(p.codigo) : "");
    const titulo = p ? p.nombre + " · " + v.nombre : v.nombre + " · Tienda asociada a ELDOSTORE";
    const texto = p ? `Mirá ${p.nombre}${p.precio ? " (" + money(p.precio) + ")" : ""} en ${v.nombre}, tienda asociada a ELDOSTORE` : `Mirá la tienda ${v.nombre} en ELDOSTORE`;
    if (D.vistaPrevia) {   // en la vista previa se copia el enlace PÚBLICO (sin la clave) y se avisa que todavía no funciona
      try { await navigator.clipboard.writeText(enlace); toast("<b>Enlace público copiado.</b> Va a funcionar cuando lances Tiendas asociadas."); }
      catch (e) { toast("Enlace público: " + esc(enlace)); }
      return;
    }
    if (navigator.share) { try { await navigator.share({ title: titulo, text: texto, url: enlace }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(enlace); toast("<b>Enlace copiado.</b> Pegalo en WhatsApp o en tus redes."); }
    catch (e) { toast("Copiá este enlace: " + esc(enlace)); }
  }
  function toast(h) { const t = $("#toast"); if (!t) return; t.innerHTML = h; t.classList.add("on"); clearTimeout(tToast); tToast = setTimeout(() => t.classList.remove("on"), 2200); }
  function redibujar() {
    if (pag.hidden || !ruta) return;
    const y = pag.scrollTop;
    mostrar(ruta, false);
    pag.scrollTop = y;
  }
  function mostrar(r, nuevo) {
    const v = r.slug ? D.porSlug.get(r.slug) : null;
    if (r.vender && D.formulario) dibujarFormulario();
    else if (r.vender) dibujarTodas();   // vista previa: el formulario «Quiero vender» no se ofrece
    else if (r.compra !== undefined) dibujarMiCompra(r.compra);
    else if (!r.slug) dibujarTodas();
    else if (!v) pag.innerHTML = barra("Tiendas asociadas") + `<div class="f-wrap"><div class="state"><b>Esta tienda no está disponible.</b>Puede que ya no esté publicada.<br><a class="cta" href="#tiendas">Ver las tiendas asociadas</a></div></div>`;
    else if (r.codigo) {
      const p = v.productos.find(x => x.codigo === r.codigo);
      if (p) dibujarFicha(v, p);
      else pag.innerHTML = barra(v.nombre, v) + `<div class="f-wrap"><div class="state"><b>Este producto ya no está publicado.</b><br><a class="cta" href="#tiendas/${esc(v.slug)}">Ver ${esc(v.nombre)}</a></div></div>`;
    } else dibujarTienda(v);
    if (nuevo) {
      pag.scrollTop = 0;
      const h = pag.querySelector("#asTitulo") || pag.querySelector(".f-back");
      if (h) h.focus({ preventScroll: true });
    }
  }
  function enrutar() {
    const r = leerRuta();
    if (!r) { ocultar(); return; }
    if (!D.listo) return;   // se muestra al terminar de cargar
    const nuevo = !ruta || ruta.slug !== r.slug || ruta.codigo !== r.codigo || !!ruta.vender !== !!r.vender || ruta.compra !== r.compra;
    if (nuevo) { qFicha = 1; fotoI = 0; if (!ruta || ruta.slug !== r.slug) filtroTienda.texto = ""; }
    if (pag.hidden) { const a = document.activeElement; foco = a && a !== document.body ? a : null; }
    ruta = r;
    cerrarPedido();
    mostrar(r, nuevo);
    pag.hidden = false;
    document.body.classList.add("asp-open");
    document.documentElement.classList.add("lock");
  }
  function ocultar() {
    if (pag.hidden) return;
    cerrarPedido();
    pag.hidden = true; pag.innerHTML = ""; ruta = null;
    document.body.classList.remove("asp-open");
    if (!document.body.classList.contains("ficha-open") && !document.body.classList.contains("panel-open")) document.documentElement.classList.remove("lock");
    document.title = titulo0;
    if (foco && document.body.contains(foco)) foco.focus({ preventScroll: true });
    foco = null;
  }
  function volver() {
    if (desdeTienda && history.length > 1) { history.back(); return; }
    const r = ruta || {};
    if (r.vender || r.compra !== undefined) { history.replaceState(null, "", location.pathname + location.search + "#asociadas"); ocultar(); }
    else if (r.codigo) location.hash = "#tiendas/" + r.slug;
    else if (r.slug) location.hash = "#tiendas";
    else { history.replaceState(null, "", location.pathname + location.search + "#asociadas"); ocultar(); }
  }
  window.addEventListener("hashchange", () => { if (leerRuta()) desdeTienda = true; enrutar(); });

  pag.addEventListener("input", e => {
    if (e.target.id !== "asBuscar" || !ruta) return;
    filtroTienda.texto = e.target.value.slice(0, 60);
    const v = D.porSlug.get(ruta.slug); if (!v) return;
    const t = norm(filtroTienda.texto), lista = v.productos.filter(p => !t || norm(p.nombre + " " + p.categoria + " " + p.codigo).includes(t));
    $("#asProds").innerHTML = lista.length ? lista.map(p => cardHTML(v, p)).join("") : '<div class="state"><b>No encontramos productos con esa búsqueda.</b></div>';
  });
  pag.addEventListener("scroll", e => {
    const t = e.target;
    if (!(t instanceof Element) || !t.classList.contains("as-track")) return;
    const i = Math.round(t.scrollLeft / Math.max(1, t.clientWidth));
    if (i === fotoI) return;
    fotoI = i;
    const c = pag.querySelector(".f-count b"); if (c) c.textContent = i + 1;
    pag.querySelectorAll(".f-th").forEach((b, k) => b.setAttribute("aria-current", String(k === i)));
    if (!(pag.querySelectorAll(".as-track > .f-slide")[i] || { classList: { contains: () => false } }).classList.contains("f-vslide"))
      pag.querySelectorAll("video.f-video").forEach(x => x.pause());
  }, true);
  pag.addEventListener("click", e => {
    const b = e.target.closest("[data-as]"); if (!b) return;
    const v = ruta && D.porSlug.get(ruta.slug);
    const a = b.dataset.as;
    if (a === "volver") { volver(); return; }
    if (a === "cat") { catSel = b.dataset.c || ""; mostrar(ruta, false); const f = pag.querySelector(`[data-as="cat"][data-c="${CSS.escape(catSel)}"]`); if (f) f.focus({ preventScroll: true }); return; }
    if (a === "pedido" && D.compras) { abrirCompra(); return; }
    if (a === "pedido" && v) { abrirPedido(v); return; }
    if (!v) return;
    if (a === "compartir") { compartir(v, b.dataset.p ? v.productos.find(x => x.codigo === b.dataset.p) : null); return; }
    if (a === "video") {   // migración 019: el video se descarga recién ahora
      const p = v.productos.find(x => x.codigo === ruta.codigo); if (!p || !p.video) return;
      const el = document.createElement("video");
      el.className = "f-video"; el.dataset.pid = p.id; el.src = p.video.url; el.poster = p.video.poster;
      el.controls = true; el.playsInline = true; el.setAttribute("playsinline", ""); el.preload = "auto"; el.setAttribute("controlslist", "nodownload");
      b.replaceWith(el); const pp = el.play(); if (pp && pp.catch) pp.catch(() => {});
      return;
    }
    if (a === "foto") {
      fotoI = Number(b.dataset.i) || 0;
      const t = pag.querySelector(".as-track"); if (t) t.scrollTo({ left: fotoI * t.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return;
    }
    if (a === "fdec" || a === "finc" || a === "fadd") {
      const p = v.productos.find(x => x.codigo === ruta.codigo); if (!comprable(p)) return;
      if (a === "fdec") qFicha = Math.max(1, qFicha - 1);
      if (a === "finc") qFicha = Math.min(MAX, qFicha + 1);
      if (a === "fadd") {
        const antes = (pedidos[v.slug] || {})[p.id] || 0, nuevo = Math.min(MAX, antes + qFicha);
        if (nuevo === antes) { toast("Llegaste al máximo de " + MAX + " unidades."); return; }
        setQ(v, p.id, nuevo); qFicha = 1;
        toast(D.compras ? `<b>Agregado a tu compra:</b> ${nuevo - antes} × ${esc(p.nombre)} (${esc(v.nombre)})` : `<b>Agregado al pedido a ${esc(v.nombre)}:</b> ${nuevo - antes} × ${esc(p.nombre)}`);
      }
      redibujar();
      const again = pag.querySelector(`[data-as="${a}"]`); if (again && !again.disabled) again.focus({ preventScroll: true });
      return;
    }
    const card = b.closest(".card"), p = card && v.productos.find(x => x.id === card.dataset.id);
    if (!comprable(p)) return;
    const q = qCard.get(p.id) || 1;
    if (a === "inc") qCard.set(p.id, Math.min(MAX, q + 1));
    if (a === "dec") qCard.set(p.id, Math.max(1, q - 1));
    if (a === "add") {
      const antes = (pedidos[v.slug] || {})[p.id] || 0, nuevo = Math.min(MAX, antes + q);
      if (nuevo === antes) { toast("Llegaste al máximo de " + MAX + " unidades."); return; }
      setQ(v, p.id, nuevo); qCard.set(p.id, 1);
      toast(D.compras ? `<b>Agregado a tu compra:</b> ${nuevo - antes} × ${esc(p.nombre)} (${esc(v.nombre)})` : `<b>Agregado al pedido a ${esc(v.nombre)}:</b> ${nuevo - antes} × ${esc(p.nombre)}`);
    }
    redibujar();
    const again = pag.querySelector(`.card[data-id="${CSS.escape(p.id)}"] [data-as="${a}"]`);
    if (again && !again.disabled) again.focus({ preventScroll: true });
  });
  pag.addEventListener("error", e => {
    if (e.target.tagName !== "IMG") return;
    const s = document.createElement("span"); s.className = "ph"; e.target.replaceWith(s);
  }, true);
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!hoja.hidden) { e.stopImmediatePropagation(); cerrarPedido(); return; }
    if (!pag.hidden) { e.stopImmediatePropagation(); volver(); }
  }, true);
  hoja.addEventListener("keydown", e => {
    if (e.key !== "Tab") return;
    const f = Array.from(hoja.querySelectorAll("a[href], button:not([disabled]), input, summary"));
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  });

  /* ---------- Inicio ---------- */
  (async function iniciar() {
    pedidos = leer();
    if (!(await cargar())) return;
    conciliar();
    dibujarSeccion();
    enrutar();
  })();
})();
