/* ==========================================================================
   ELDOSTORE — Barra de anuncios (franja amarilla superior)
   - Los anuncios se administran en el panel: Tienda online → Barra de anuncios
     (migración 017: anuncios_tienda()).
   - Varios anuncios activos: se desplazan de derecha a izquierda en un ciclo
     continuo y sin cortes (la cinta se repite dos veces y se mueve exactamente
     una vuelta). Se pausa al pasar el mouse o al enfocarla.
   - Un solo anuncio: se muestra fijo, centrado, como la franja de siempre.
   - Ningún anuncio activo: la franja se oculta.
   - «Reducir movimiento» activado en el teléfono o la computadora: no hay
     desplazamiento; los anuncios se turnan cada 5 segundos, sin animación.
   - Si la función no existe o no responde, queda la franja fija de index.html,
     exactamente como antes.
   ========================================================================== */
(function () {
  "use strict";
  const CFG = window.ELDOSTORE_CONFIG || {};
  const barra = document.querySelector(".ship-strip");
  if (!barra || !window.supabase || !CFG.supabaseUrl || !CFG.supabaseKey) return;

  const VELOCIDAD = { lenta: 30, normal: 45, rapida: 70 };      // píxeles por segundo
  const SVG = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONOS = {
    camion: SVG('<path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>'),
    rayo: SVG('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
    regalo: SVG('<path d="M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0"/>'),
    tarjeta: SVG('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>'),
    whatsapp: SVG('<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9.5 9.5c.3 2 2 3.7 4 4l1-1 1.8.8-.3 1.4c-3.5.3-7.5-3.7-7.2-7.2l1.4-.3.8 1.8z"/>'),
    estrella: SVG('<path d="m12 3 2.7 5.6 6.1.8-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.8z"/>'),
    reloj: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    ubicacion: SVG('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
    etiqueta: SVG('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.4"/>')
  };
  const reducir = matchMedia("(prefers-reduced-motion: reduce)");
  let datos = null, leido = 0, tTurno = null, tAncho = null;

  function item(a) {
    const s = document.createElement("span");
    s.className = "ab-item";
    s.innerHTML = ICONOS[a.icono] || "";
    s.appendChild(document.createTextNode(a.texto));
    return s;
  }
  function limpiar() {
    clearInterval(tTurno); tTurno = null;
    barra.classList.remove("ab-mueve", "ab-turnos");
    barra.style.removeProperty("--ab-dur");
  }

  function dibujar() {
    if (!datos) return;
    const lista = datos.anuncios;
    limpiar();
    barra.hidden = lista.length === 0;
    if (!lista.length) return;
    barra.setAttribute("role", "region");
    barra.setAttribute("aria-label", "Anuncios de ELDOSTORE");
    barra.textContent = "";

    if (lista.length === 1) {                       // un solo anuncio: fijo, como siempre
      const it = item(lista[0]);
      it.classList.add("ab-solo");
      barra.appendChild(it);
      return;
    }

    // Texto completo para lectores de pantalla (la cinta animada se oculta para ellos)
    const sr = document.createElement("span");
    sr.className = "sr";
    sr.textContent = lista.map(a => a.texto).join(". ");
    barra.appendChild(sr);

    if (reducir.matches) {                          // sin movimiento: se turnan
      barra.classList.add("ab-turnos");
      const caja = document.createElement("span");
      caja.className = "ab-turno"; caja.setAttribute("aria-hidden", "true");
      barra.appendChild(caja);
      let i = 0;
      const mostrar = () => { caja.textContent = ""; caja.appendChild(item(lista[i % lista.length])); i++; };
      mostrar();
      tTurno = setInterval(mostrar, 5000);
      return;
    }

    // Cinta: una "vuelta" con todos los anuncios (repetida hasta cubrir el ancho), y la vuelta duplicada.
    const visor = document.createElement("div");
    visor.className = "ab-visor"; visor.setAttribute("aria-hidden", "true");
    const cinta = document.createElement("div");
    cinta.className = "ab-cinta";
    const vuelta = document.createElement("div");
    vuelta.className = "ab-vuelta";
    visor.appendChild(cinta); cinta.appendChild(vuelta); barra.appendChild(visor);
    const ancho = visor.clientWidth || window.innerWidth;
    let guard = 0;
    do { lista.forEach(a => vuelta.appendChild(item(a))); guard++; }
    while (vuelta.scrollWidth < ancho && guard < 20);
    cinta.appendChild(vuelta.cloneNode(true));
    const px = vuelta.getBoundingClientRect().width;
    const vel = VELOCIDAD[datos.velocidad] || VELOCIDAD.normal;
    barra.style.setProperty("--ab-dur", Math.max(6, px / vel).toFixed(2) + "s");
    barra.classList.add("ab-mueve");
  }

  async function cargar() {
    try {
      const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await sb.rpc("anuncios_tienda");
      if (error || !data || !Array.isArray(data.anuncios)) return;   // queda la franja fija de siempre
      datos = {
        velocidad: data.velocidad,
        anuncios: data.anuncios.filter(a => a && typeof a.texto === "string" && a.texto.trim())
                               .map(a => ({ texto: a.texto.trim().slice(0, 120), icono: String(a.icono || "") }))
      };
      leido = Date.now();
      dibujar();
    } catch (e) { /* queda la franja fija de siempre */ }
  }

  // Cambios de tamaño (girar el celular, ventana) y de la preferencia de movimiento
  let anchoPrevio = window.innerWidth;
  window.addEventListener("resize", () => {
    if (Math.abs(window.innerWidth - anchoPrevio) < 2) return;
    anchoPrevio = window.innerWidth;
    clearTimeout(tAncho); tAncho = setTimeout(dibujar, 200);
  });
  if (reducir.addEventListener) reducir.addEventListener("change", dibujar);
  // Si la tienda queda abierta, al volver a ella se leen los anuncios otra vez (cada 5 minutos como máximo)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - leido > 5 * 60 * 1000) cargar();
  });
  cargar();
})();
