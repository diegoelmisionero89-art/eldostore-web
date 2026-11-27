/* ==========================================================================
   ELDOSTORE — Video del producto: preparación en el navegador (videos.js)

   Archivo NUEVO y separado de imagenes.js (las fotos no cambian en nada).
   Lo usan el panel (productos de ELDOSTORE) y el portal de vendedores.

   Cómo se achica el video sin subir el original:
   - El navegador reproduce el video elegido (MP4/MOV del celular) sobre un
     lienzo de 960 px como máximo en su lado más largo, y lo vuelve a grabar
     en MP4 (H.264 + AAC, el formato que se ve en iPhone, Android y PC) a
     ~1 Mbps de imagen y 64 kbps de sonido. Tarda lo que dura el video.
   - Un video de 15 s queda en ~1,5–2,5 MB. Si supera 4 MB se intenta una vez
     más con menos calidad; si aun así no entra, no se sube.
   - Además se guarda una imagen fija (póster) para mostrar el video en la
     tienda SIN descargarlo hasta que el cliente lo toca.
   - Duración máxima: 15 s. Si es más largo, o el navegador no puede leerlo
     (p. ej. HEVC en una PC), se avisa y no se sube nada.
   - Nunca modifica ni borra archivos existentes: sube archivos nuevos y la
     base devuelve cuáles quedaron viejos para borrar SOLO esos.
   ========================================================================== */
(function () {
  "use strict";
  const V = {
    MAX_SEG: 15, TOLERANCIA: 1,              // 15 s (+ 1 s de margen: el celular rara vez graba justo 15 s)
    MAX_ENTRADA: 400 * 1024 * 1024,          // lo que se puede elegir (un 4K de 15 s pesa ~100 MB)
    MAX_FINAL: 4 * 1024 * 1024,              // lo máximo que se sube (igual que el límite del depósito)
    LADO: 960, VBPS: 1000000, ABPS: 64000, FPS: 30,
    REINTENTO: { LADO: 720, VBPS: 600000 },
    POSTER_CALIDAD: 0.8
  };
  // Sonido SIEMPRE en AAC (el que reproducen todos los iPhone). Si el navegador no puede grabar AAC, el video se guarda
  // SIN sonido antes que en otro formato que un iPhone viejo podría no reproducir.
  const TIPOS_AAC = ['video/mp4;codecs="avc1.42E01F,mp4a.40.2"', "video/mp4;codecs=avc1,mp4a.40.2", 'video/mp4;codecs="avc1.4D401F,mp4a.40.2"', 'video/mp4;codecs="avc1.640028,mp4a.40.2"'];
  const TIPOS_MUDO = ['video/mp4;codecs="avc1.42E01F"', "video/mp4;codecs=avc1", 'video/mp4;codecs="avc1.4D401F"'];
  const esVideo = f => !!f && (/^video\//.test(f.type) || /\.(mp4|mov|m4v|3gp|webm|mkv)$/i.test(f.name || ""));
  const mb = n => (n / 1048576).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + " MB";
  const seg = s => Math.round(s) + " s";
  const soporta = t => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } };
  // → { mime, sonido } ; "" si no se puede grabar MP4 con H.264
  function tipoGrabacion() {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return "";
    const aac = TIPOS_AAC.find(soporta);
    if (aac) return { mime: aac, sonido: true };
    // Safari: «video/mp4» graba H.264 + AAC por defecto (no admite Opus en MP4, así que no hay duda del sonido)
    if (soporta("video/mp4") && !soporta("video/mp4;codecs=avc1,opus") && !soporta('video/mp4;codecs="avc1.42E01F,opus"')) return { mime: "video/mp4", sonido: true };
    const mudo = TIPOS_MUDO.find(soporta);
    return mudo ? { mime: mudo, sonido: false } : "";
  }
  const puedePreparar = () => !!tipoGrabacion();
  const esperar = (el, ok, mal, ms) => new Promise((res, rej) => {
    let t = null;
    const fin = (f, v) => { clearTimeout(t); el.removeEventListener(ok, a); if (mal) el.removeEventListener(mal, b); f(v); };
    const a = () => fin(res), b = () => fin(rej, new Error("no se pudo leer"));
    el.addEventListener(ok, a, { once: true }); if (mal) el.addEventListener(mal, b, { once: true });
    if (ms) t = setTimeout(() => fin(rej, new Error("tiempo")), ms);
  });

  /* 1) Leer el video elegido: duración y tamaño. No sube nada. */
  async function leerVideo(archivo) {
    if (!esVideo(archivo)) throw new Error("Ese archivo no es un video. Elegí un video MP4 o MOV.");
    if (archivo.size > V.MAX_ENTRADA) throw new Error(`El video es muy pesado (${mb(archivo.size)}). Elegí uno más corto.`);
    const url = URL.createObjectURL(archivo);
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.setAttribute("playsinline", ""); video.preload = "auto";
    video.src = url;
    try {
      await esperar(video, "loadedmetadata", "error", 20000);
      if (!video.videoWidth || !video.videoHeight) await esperar(video, "loadeddata", "error", 8000);
    } catch (e) {
      URL.revokeObjectURL(url);
      throw new Error("Este navegador no puede abrir ese video (formato no compatible). Probá con otro video, o en el celular grabalo en «Más compatible» (Ajustes → Cámara → Formatos).");
    }
    const dur = video.duration;
    if (!video.videoWidth) { URL.revokeObjectURL(url); throw new Error("Este navegador no puede mostrar ese video (formato no compatible, por ejemplo HEVC en una computadora). Probá con otro video, o en el celular grabalo en «Más compatible» (Ajustes → Cámara → Formatos)."); }
    if (!isFinite(dur) || dur <= 0) { URL.revokeObjectURL(url); throw new Error("No se pudo leer la duración del video. Probá con otro."); }
    if (dur > V.MAX_SEG + V.TOLERANCIA) { URL.revokeObjectURL(url); throw new Error(`El video dura ${seg(dur)}. El máximo es ${V.MAX_SEG} segundos: recortalo en el celular y volvé a elegirlo.`); }
    return { archivo, url, video, duracion: dur, ancho: video.videoWidth, alto: video.videoHeight, peso: archivo.size,
      cerrar() { try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) {} URL.revokeObjectURL(url); } };
  }

  /* 2) Preparar (achicar) el video. Llamarla DIRECTO desde el toque del botón (sin esperas antes),
        así el navegador permite grabar el sonido. */
  function prepararVideo(info, onProgreso) {
    const tipo = tipoGrabacion(), mime = tipo && tipo.mime;
    if (!mime) return Promise.reject(new Error("Este navegador no puede preparar videos. Actualizá Chrome o Safari e intentá de nuevo."));
    // El sonido se toma con Web Audio (sin pasar por los parlantes). Se crea YA, dentro del toque.
    let audio = null;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && tipo.sonido) {
        if (!info._audio) {
          const ctx = new Ctx(), fuente = ctx.createMediaElementSource(info.video), destino = ctx.createMediaStreamDestination();
          fuente.connect(destino);
          info._audio = { ctx, destino };
        }
        audio = info._audio; audio.ctx.resume && audio.ctx.resume().catch(() => {});
      }
    } catch (e) { audio = null; }
    // Safari (iPhone) solo deja reproducir con sonido si play() arranca dentro del toque: se arranca acá y se rebobina después.
    try { info.video.muted = !audio; const pp = info.video.play(); if (pp && pp.catch) pp.catch(() => {}); } catch (e) {}
    const intento = async (lado, vbps) => grabar(info, mime, lado, vbps, audio, onProgreso);
    return intento(V.LADO, V.VBPS).then(r => r.blob.size <= V.MAX_FINAL ? r
      : intento(V.REINTENTO.LADO, V.REINTENTO.VBPS).then(r2 => {
          if (r2.blob.size > V.MAX_FINAL) throw new Error(`Aun achicado, el video pesa ${mb(r2.blob.size)} (máximo 4 MB). Probá con uno más corto.`);
          return r2;
        }));
  }

  async function grabar(info, mime, lado, vbps, audio, onProgreso) {
    const v = info.video, esc = Math.min(1, lado / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.max(2, Math.round(v.videoWidth * esc / 2) * 2), h = Math.max(2, Math.round(v.videoHeight * esc / 2) * 2);
    const lienzo = document.createElement("canvas"); lienzo.width = w; lienzo.height = h;
    const g = lienzo.getContext("2d", { alpha: false });
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    const flujo = lienzo.captureStream(V.FPS);
    let conSonido = false;
    if (audio && audio.destino.stream.getAudioTracks()[0]) { flujo.addTrack(audio.destino.stream.getAudioTracks()[0]); conSonido = true; }
    const rec = new MediaRecorder(flujo, conSonido ? { mimeType: mime, videoBitsPerSecond: vbps, audioBitsPerSecond: V.ABPS } : { mimeType: mime, videoBitsPerSecond: vbps });
    const partes = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) partes.push(e.data); };
    v.pause(); v.muted = !conSonido; v.volume = 1; v.loop = false;
    if (v.currentTime > 0.01) { v.currentTime = 0; await esperar(v, "seeked", null, 8000).catch(() => {}); }

    let posterBlob = null, vivo = true, ultimo = performance.now(), ultimoT = -1;
    const dibujar = () => { try { g.drawImage(v, 0, 0, w, h); } catch (e) {} };
    const cuadro = () => {
      if (!vivo) return;
      dibujar();
      if (v.currentTime !== ultimoT) { ultimoT = v.currentTime; ultimo = performance.now(); }
      if (onProgreso && isFinite(v.duration)) onProgreso(Math.min(0.99, v.currentTime / v.duration));
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(cuadro); else requestAnimationFrame(cuadro);
    };
    dibujar();
    const termina = new Promise((ok, mal) => {
      rec.onstop = () => ok();
      rec.onerror = e => mal(new Error("No se pudo grabar el video: " + ((e && e.error && e.error.message) || "error")));
    });
    const oculto = () => { if (document.hidden) { vivo = false; try { rec.stop(); } catch (e) {} v.pause(); } };
    document.addEventListener("visibilitychange", oculto);
    const guardia = setInterval(() => {   // si el video se traba (pantalla bloqueada, etc.) se corta con aviso
      if (performance.now() - ultimo > 10000) { vivo = false; try { rec.stop(); } catch (e) {} v.pause(); }
    }, 1000);
    try {
      rec.start(1000);
      try { await v.play(); }
      catch (e) { v.muted = true; conSonido = false; await v.play(); }   // si no deja con sonido, se prepara sin sonido
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(cuadro); else requestAnimationFrame(cuadro);
      // Póster: el primer cuadro con imagen
      await new Promise(r => setTimeout(r, 120));
      posterBlob = await posterDe(lienzo);
      await esperar(v, "ended", "error", (v.duration + 30) * 1000);
      dibujar();
      await new Promise(r => setTimeout(r, 150));
      vivo = false;
      if (rec.state !== "inactive") rec.stop();
      await termina;
    } catch (e) {
      vivo = false; try { if (rec.state !== "inactive") rec.stop(); } catch (x) {}
      if (document.hidden) throw new Error("Se interrumpió porque saliste de la pantalla. Dejala abierta mientras se prepara el video.");
      throw new Error("No se pudo preparar el video. Probá de nuevo o con otro video.");
    } finally {
      clearInterval(guardia); document.removeEventListener("visibilitychange", oculto);
      flujo.getVideoTracks().forEach(t => t.stop());
    }
    if (!vivo && v.currentTime < v.duration - 1) {
      throw new Error(document.hidden ? "Se interrumpió porque saliste de la pantalla. Dejala abierta mientras se prepara el video." : "El video se trabó al prepararlo. Probá de nuevo.");
    }
    let blob = new Blob(partes, { type: "video/mp4" });
    if (!blob.size) throw new Error("No se pudo preparar el video. Probá de nuevo o con otro video.");
    try { const plano = aplanarMp4(await blob.arrayBuffer()); if (plano && plano.size) blob = plano; } catch (e) { /* queda el original */ }
    if (onProgreso) onProgreso(1);
    if (!posterBlob) posterBlob = await posterDe(lienzo);
    return { blob, mime: "video/mp4", ancho: w, alto: h, duracion: Math.min(info.duracion, V.MAX_SEG + V.TOLERANCIA), conSonido,
      poster: posterBlob };
  }

  /* MP4 «fragmentado» (lo que graba el navegador, sin duración total) → MP4 común: índice completo al principio
     (moov + mdat), con duración. No recomprime: solo reordena las mismas muestras. Ante cualquier duda devuelve null
     y se usa el archivo original (que igual se reproduce). */
  function aplanarMp4(buf) {
    try {
      const d = new DataView(buf), u8 = new Uint8Array(buf), N = buf.byteLength;
      const tipo = o => String.fromCharCode(u8[o + 4], u8[o + 5], u8[o + 6], u8[o + 7]);
      const cajas = (ini, fin) => { const r = []; let o = ini;
        while (o + 8 <= fin) { let sz = d.getUint32(o), h = 8; if (sz === 1) { sz = Number(d.getBigUint64(o + 8)); h = 16; } else if (sz === 0) sz = fin - o;
          if (sz < h || o + sz > fin) throw new Error("caja"); r.push({ t: tipo(o), o, sz, h, c: o + h, f: o + sz }); o += sz; }
        return r; };
      const hijo = (b, t) => cajas(b.c, b.f).find(x => x.t === t);
      const top = cajas(0, N), moov = top.find(b => b.t === "moov");
      if (!moov || !top.some(b => b.t === "moof")) return null;          // ya es un MP4 común
      const trex = {}; const mvex = hijo(moov, "mvex");
      if (mvex) for (const b of cajas(mvex.c, mvex.f)) if (b.t === "trex") { const p = b.c + 4; trex[d.getUint32(p)] = { dur: d.getUint32(p + 8), size: d.getUint32(p + 12), flags: d.getUint32(p + 16) }; }
      const pistas = {};
      for (const tk of cajas(moov.c, moov.f).filter(b => b.t === "trak")) {
        const tkhd = hijo(tk, "tkhd"), v = u8[tkhd.c], id = d.getUint32(tkhd.c + 4 + (v ? 16 : 8));
        const mdia = hijo(tk, "mdia"), mdhd = hijo(mdia, "mdhd"), hdlr = hijo(mdia, "hdlr");
        const ts = d.getUint32(mdhd.c + 4 + (u8[mdhd.c] ? 16 : 8));
        pistas[id] = { id, tk, ts, video: String.fromCharCode(...u8.slice(hdlr.c + 8, hdlr.c + 12)) === "vide", muestras: [] };
      }
      for (const mf of top.filter(b => b.t === "moof")) {
        let finAnterior = null;
        for (const tf of cajas(mf.c, mf.f).filter(b => b.t === "traf")) {
          const tfhd = hijo(tf, "tfhd"), fl = d.getUint32(tfhd.c) & 0xffffff; let p = tfhd.c + 4;
          const id = d.getUint32(p); p += 4; const pista = pistas[id]; if (!pista) throw new Error("pista");
          let base = null; if (fl & 1) { base = Number(d.getBigUint64(p)); p += 8; }
          if (fl & 2) p += 4;
          const t = trex[id] || { dur: 0, size: 0, flags: 0 };
          let dDur = t.dur, dSize = t.size, dFlags = t.flags;
          if (fl & 8) { dDur = d.getUint32(p); p += 4; } if (fl & 0x10) { dSize = d.getUint32(p); p += 4; } if (fl & 0x20) { dFlags = d.getUint32(p); p += 4; }
          if (base === null) base = (fl & 0x20000) || finAnterior === null ? mf.o : finAnterior;
          for (const tr of cajas(tf.c, tf.f).filter(b => b.t === "trun")) {
            const v = u8[tr.c], tfl = d.getUint32(tr.c) & 0xffffff; let q = tr.c + 4;
            const n = d.getUint32(q); q += 4; let pos = base;
            if (tfl & 1) { pos = base + d.getInt32(q); q += 4; }
            let primera = null; if (tfl & 4) { primera = d.getUint32(q); q += 4; }
            for (let i = 0; i < n; i++) {
              const dur = tfl & 0x100 ? d.getUint32((q += 4) - 4) : dDur;
              const size = tfl & 0x200 ? d.getUint32((q += 4) - 4) : dSize;
              let flags = tfl & 0x400 ? d.getUint32((q += 4) - 4) : dFlags; if (i === 0 && primera !== null) flags = primera;
              const cto = tfl & 0x800 ? (v ? d.getInt32((q += 4) - 4) : d.getUint32((q += 4) - 4)) : 0;
              if (pos + size > N) throw new Error("datos");
              pista.muestras.push({ pos, size, dur, sync: !(flags & 0x10000), cto });
              pos += size;
            }
            finAnterior = pos;
          }
        }
      }
      const lista = Object.values(pistas).filter(p => p.muestras.length);
      if (!lista.length) return null;
      // --- escribir ---
      const partes = []; const caja = (t, ...cont) => { const len = 8 + cont.reduce((a, c) => a + c.length, 0), b = new Uint8Array(len), dv = new DataView(b.buffer);
        dv.setUint32(0, len); for (let i = 0; i < 4; i++) b[4 + i] = t.charCodeAt(i); let o = 8; for (const c of cont) { b.set(c, o); o += c.length; } return b; };
      const num = (...vals) => { const b = new Uint8Array(vals.length * 4), dv = new DataView(b.buffer); vals.forEach((v, i) => dv.setUint32(i * 4, v >>> 0)); return b; };
      const copia = b => u8.slice(b.o, b.f);
      const mvhdO = hijo(moov, "mvhd"), mvTS = d.getUint32(mvhdO.c + 4 + (u8[mvhdO.c] ? 16 : 8));
      let durMovie = 0;
      const nuevasPistas = lista.map(p => {
        const sumaDur = p.muestras.reduce((a, m) => a + m.dur, 0), durMv = Math.round(sumaDur / p.ts * mvTS); durMovie = Math.max(durMovie, durMv);
        const stts = []; for (const m of p.muestras) { const u = stts[stts.length - 1]; if (u && u[1] === m.dur) u[0]++; else stts.push([1, m.dur]); }
        const ctts = []; const hayCto = p.muestras.some(m => m.cto);
        if (hayCto) for (const m of p.muestras) { const u = ctts[ctts.length - 1]; if (u && u[1] === m.cto) u[0]++; else ctts.push([1, m.cto]); }
        const syncs = p.muestras.map((m, i) => m.sync ? i + 1 : 0).filter(Boolean);
        p.durMv = durMv; p.sumaDur = sumaDur;
        p.tablas = { stts, ctts: hayCto ? ctts : null, stss: p.video && syncs.length < p.muestras.length ? syncs : null };
        return p;
      });
      const parchar = (bytes, desde, v, dur) => { const b = bytes.slice(), dv = new DataView(b.buffer); if (v) dv.setBigUint64(desde, BigInt(dur)); else dv.setUint32(desde, dur); return b; };
      const armarMoov = offsets => {
        const traks = nuevasPistas.map((p, k) => {
          const hijos = cajas(p.tk.c, p.tk.f).filter(b => b.t !== "edts").map(b => {
            if (b.t === "tkhd") { const v = u8[b.c]; return parchar(copia(b), 8 + 4 + (v ? 24 : 16), v, p.durMv); }
            if (b.t !== "mdia") return copia(b);
            return caja("mdia", ...cajas(b.c, b.f).map(x => {
              if (x.t === "mdhd") { const v = u8[x.c]; return parchar(copia(x), 8 + 4 + (v ? 20 : 12), v, p.sumaDur); }
              if (x.t !== "minf") return copia(x);
              return caja("minf", ...cajas(x.c, x.f).map(y => {
                if (y.t !== "stbl") return copia(y);
                const stsd = copia(hijo(y, "stsd")), T = p.tablas, n = p.muestras.length;
                const b = [stsd, caja("stts", num(0, T.stts.length, ...T.stts.flat()))];
                if (T.ctts) b.push(caja("ctts", num(0, T.ctts.length, ...T.ctts.flat())));
                if (T.stss) b.push(caja("stss", num(0, T.stss.length, ...T.stss)));
                b.push(caja("stsc", num(0, 1, 1, n, 1)), caja("stsz", num(0, 0, n, ...p.muestras.map(m => m.size))), caja("stco", num(0, 1, offsets[k])));
                return caja("stbl", ...b);
              }));
            }));
          });
          return caja("trak", ...hijos);
        });
        const mv = parchar(copia(mvhdO), 8 + 4 + (u8[mvhdO.c] ? 20 : 12), u8[mvhdO.c], durMovie);   // mvhd: duración en 24 (v0) / 32 (v1)
        const otros = cajas(moov.c, moov.f).filter(b => !["mvhd", "trak", "mvex"].includes(b.t)).map(copia);
        return caja("moov", mv, ...traks, ...otros);
      };
      const ftyp = caja("ftyp", new Uint8Array([105, 115, 111, 109]), num(512), new Uint8Array([105, 115, 111, 109, 105, 115, 111, 50, 97, 118, 99, 49, 109, 112, 52, 49]));
      const tamDatos = nuevasPistas.map(p => p.muestras.reduce((a, m) => a + m.size, 0)), total = tamDatos.reduce((a, b) => a + b, 0);
      let moovB = armarMoov(nuevasPistas.map(() => 0));
      const ini = ftyp.length + moovB.length + 8; let acc = ini;
      const offsets = tamDatos.map(t => { const o = acc; acc += t; return o; });
      moovB = armarMoov(offsets);
      const mdat = new Uint8Array(8 + total), mdv = new DataView(mdat.buffer); mdv.setUint32(0, 8 + total); mdat.set([109, 100, 97, 116], 4);
      let o = 8; for (const p of nuevasPistas) for (const m of p.muestras) { mdat.set(u8.subarray(m.pos, m.pos + m.size), o); o += m.size; }
      partes.push(ftyp, moovB, mdat);
      return new Blob(partes, { type: "video/mp4" });
    } catch (e) { console.warn("[ELDOSTORE] No se pudo reordenar el MP4; se usa tal cual:", e && e.message); return null; }
  }

  function posterDe(lienzo) {
    return new Promise(ok => lienzo.toBlob(b => {
      if (b && b.type === "image/webp") return ok({ blob: b, mime: "image/webp", ext: "webp" });
      lienzo.toBlob(j => ok(j ? { blob: j, mime: "image/jpeg", ext: "jpg" } : null), "image/jpeg", V.POSTER_CALIDAD);
    }, "image/webp", V.POSTER_CALIDAD));
  }

  /* 3) Sección «Video del producto»: misma pieza para el panel y el portal.
        op: { contenedor, productoId|null, leer(), subir(nombre, blob, mime) → url, guardar(url, poster, dur, peso) → {borrar[]},
              eliminar() → {borrar[]}, borrarArchivos(nombres[]), carpeta, clases: {btn, prim, peligro}, aviso(texto) } */
  function seccionVideo(op) {
    const c = op.contenedor; if (!c) return;
    const cls = Object.assign({ btn: "btn", prim: "btn btn-primary", peligro: "btn btn-danger" }, op.clases || {});
    let actual = null, elegido = null, ocupado = false, mensaje = "", error = "";
    const estadoTxt = e => ({ pendiente: "⏳ Pendiente de aprobación: todavía no se ve en la tienda.", aprobado: "✓ Aprobado: se ve en la tienda.", rechazado: "✕ Rechazado" })[e] || "";
    function dibujar(prog) {
      const pie = `<p class="vid-nota">Opcional · un video por producto · hasta ${V.MAX_SEG} segundos · MP4 o MOV del celular. Se achica solo antes de subirlo (queda en 1 a 2 MB aprox.). Las fotos no cambian.</p>`;
      let cuerpo;
      if (!op.productoId) cuerpo = `<p class="vid-nota">Guardá el producto primero; después podés agregarle un video.</p>`;
      else if (prog != null) cuerpo = `<div class="vid-prog" role="status"><span>${prog < 1 ? "Preparando el video… dejá esta pantalla abierta" : "Subiendo…"}</span>
          <div class="vid-barra"><i style="width:${Math.round(prog * 100)}%"></i></div><b>${Math.round(prog * 100)} %</b></div>`;
      else if (elegido) cuerpo = `<div class="vid-caja"><video class="vid-ver" src="${elegido.url}" controls playsinline muted preload="metadata"></video>
          <p class="vid-dato">Elegiste un video de <b>${seg(elegido.duracion)}</b> · ${mb(elegido.peso)} · ${elegido.ancho}×${elegido.alto}</p>
          <div class="vid-acc"><button type="button" class="${cls.prim}" data-vid="subir" ${ocupado ? "disabled" : ""}>Achicar y subir</button>
          <button type="button" class="${cls.btn}" data-vid="cancelar">Cancelar</button></div></div>`;
      else if (actual) cuerpo = `<div class="vid-caja"><video class="vid-ver" src="${esc(actual.url)}" poster="${esc(actual.poster)}" controls playsinline preload="none"></video>
          <p class="vid-dato">${seg(Number(actual.duracion))} · ${mb(Number(actual.peso))}${actual.estado ? `<br><span class="vid-est vid-${esc(actual.estado)}">${estadoTxt(actual.estado)}${actual.estado === "rechazado" && actual.motivo ? ": " + esc(actual.motivo) : ""}</span>` : ""}</p>
          <div class="vid-acc"><label class="${cls.btn} vid-elegir">Reemplazar video<input type="file" accept="video/mp4,video/quicktime,video/*" data-vid="archivo" hidden></label>
          <button type="button" class="${cls.peligro}" data-vid="eliminar">Eliminar video</button></div></div>`;
      else cuerpo = `<div class="vid-acc"><label class="${cls.btn} vid-elegir">+ Agregar video<input type="file" accept="video/mp4,video/quicktime,video/*" data-vid="archivo" hidden></label></div>`;
      c.innerHTML = `<div class="vid-sec">${cuerpo}${error ? `<p class="vid-err" role="alert">${esc(error)}</p>` : ""}${mensaje ? `<p class="vid-ok" role="status">${esc(mensaje)}</p>` : ""}${pie}</div>`;
    }
    const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
    async function cargar() {
      if (!op.productoId) return dibujar();
      c.innerHTML = '<p class="vid-nota">Cargando video…</p>';
      try { actual = await op.leer(); error = ""; } catch (e) { actual = null; error = "No se pudo leer el video: " + (e.message || e); }
      dibujar();
    }
    function soltarElegido() { if (elegido) { elegido.cerrar(); elegido = null; } }
    c.addEventListener("change", async e => {
      const inp = e.target.closest('[data-vid="archivo"]'); if (!inp || !inp.files || !inp.files[0]) return;
      error = ""; mensaje = ""; soltarElegido();
      if (!puedePreparar()) { error = "Este navegador no puede preparar videos. Actualizá Chrome o Safari e intentá de nuevo."; return dibujar(); }
      c.innerHTML = '<p class="vid-nota">Leyendo el video…</p>';
      try { elegido = await leerVideo(inp.files[0]); } catch (x) { error = x.message || String(x); }
      dibujar();
    });
    c.addEventListener("click", e => {
      const b = e.target.closest("[data-vid]"); if (!b || ocupado) return;
      const a = b.dataset.vid;
      if (a === "cancelar") { soltarElegido(); error = ""; dibujar(); }
      if (a === "subir" && elegido) subir();          // sin esperas antes: el toque habilita el sonido
      if (a === "eliminar") eliminar();
    });
    async function subir() {
      ocupado = true; error = ""; mensaje = "";
      const info = elegido;
      let r;
      const prep = prepararVideo(info, p => dibujar(p * 0.9));
      try { r = await prep; } catch (e) { ocupado = false; error = e.message || String(e); return dibujar(); }
      dibujar(0.95);
      const azar = () => Math.random().toString(36).slice(2, 10).padEnd(6, "0");
      const base = `${op.carpeta}/${Date.now()}-${azar()}`;
      const subidos = [];
      try {
        const url = await op.subir(base + ".mp4", r.blob, "video/mp4"); subidos.push(base + ".mp4");
        if (!r.poster) throw new Error("No se pudo crear la imagen del video.");
        const poster = await op.subir(base + "." + r.poster.ext, r.poster.blob, r.poster.mime); subidos.push(base + "." + r.poster.ext);
        const res = await op.guardar(url, poster, Math.round(r.duracion * 10) / 10, r.blob.size);
        const viejos = (res && res.borrar) || [];
        if (viejos.length) { try { await op.borrarArchivos(viejos); } catch (x) { console.warn("No se pudo borrar el video anterior:", x); } }
        soltarElegido();
        mensaje = `Listo: el video quedó en ${mb(r.blob.size)} (antes ${mb(info.peso)})${r.conSonido ? "" : ", sin sonido"}.` +
          (res && res.estado === "pendiente" ? " Queda pendiente hasta que ELDOSTORE lo apruebe." : "");
        ocupado = false;
        await cargar();
      } catch (e) {
        // Si algo falló después de subir, se borra lo recién subido (no quedan archivos sueltos)
        if (subidos.length) { try { await op.borrarArchivos(subidos); } catch (x) {} }
        ocupado = false; error = "No se pudo guardar el video: " + (e.message || e); dibujar();
      }
    }
    async function eliminar() {
      if (!actual) return;
      if (!confirm("¿Eliminar el video de este producto? Las fotos no se tocan.")) return;
      ocupado = true; error = ""; mensaje = "";
      try {
        const res = await op.eliminar();
        const viejos = (res && res.borrar) || [];
        if (viejos.length) { try { await op.borrarArchivos(viejos); } catch (x) { console.warn("No se pudo borrar el archivo:", x); } }
        mensaje = "Video eliminado."; actual = null; ocupado = false; dibujar();
      } catch (e) { ocupado = false; error = "No se pudo eliminar el video: " + (e.message || e); dibujar(); }
    }
    if (!document.getElementById("vid-estilos")) {
      const st = document.createElement("style"); st.id = "vid-estilos";
      st.textContent = `.vid-sec{display:grid;gap:8px}.vid-caja{display:grid;gap:8px}
.vid-ver{width:100%;max-width:360px;max-height:320px;border-radius:12px;background:#000}
.vid-acc{display:flex;flex-wrap:wrap;gap:8px}.vid-sec .vid-acc .vid-elegir{cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:0;margin:0}
.vid-nota{margin:0;font-size:12.5px;opacity:.75}.vid-dato{margin:0;font-size:13.5px}
.vid-err{margin:0;color:#e5484d;font-weight:600;font-size:13.5px}.vid-ok{margin:0;color:#2f9e5b;font-weight:600;font-size:13.5px}
.vid-est{font-weight:700}.vid-pendiente{color:#c98a12}.vid-aprobado{color:#2f9e5b}.vid-rechazado{color:#e5484d}
.vid-prog{display:grid;grid-template-columns:1fr auto;gap:6px 10px;align-items:center;font-size:13.5px}
.vid-prog span{grid-column:1/-1}.vid-barra{height:8px;border-radius:99px;background:rgba(127,127,127,.25);overflow:hidden}
.vid-barra i{display:block;height:100%;background:#f4c84f;transition:width .3s}`;
      document.head.appendChild(st);
    }
    cargar();
    return { recargar: cargar };
  }

  window.EldoVideo = { V, leerVideo, prepararVideo, puedePreparar, seccionVideo, mb, formato: tipoGrabacion, _aplanar: aplanarMp4 };
})();
