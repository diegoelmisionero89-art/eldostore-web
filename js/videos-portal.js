/* ==========================================================================
   ELDOSTORE — Portal de vendedores: «Video del producto» (migración 019)
   Un video opcional por producto. Se achica en el navegador (js/videos.js),
   se sube a la carpeta de la tienda (productos-videos/v/<tienda>/…) y queda
   PENDIENTE hasta que ELDOSTORE lo aprueba. No cambia las fotos ni la
   aprobación del producto. Sin la migración 019 no se muestra nada.
   ========================================================================== */
(function () {
  "use strict";
  const BUCKET = "productos-videos";
  let disponible = null, videos = null;

  async function listar(sb) {
    const r = await sb.rpc("mkt_videos_vendedor");
    if (r.error) { if (/Could not find the function|does not exist|PGRST202|42883/i.test(r.error.message || "")) disponible = false; throw r.error; }
    disponible = true; videos = Array.isArray(r.data) ? r.data : []; return videos;
  }
  function carpetaDe(portal) {
    const m = String((portal && portal.limites && portal.limites.carpetaFotos) || "").match(/v\/([0-9a-f-]{36})$/);
    return m ? "v/" + m[1] : null;
  }
  async function borrar(sb, nombres) {
    const lista = (nombres || []).filter(n => /^v\/[0-9a-f-]{36}\/[0-9]{10,16}-[a-z0-9]{4,16}\.(mp4|webp|jpg)$/.test(n));
    if (!lista.length) return;
    const { error } = await sb.storage.from(BUCKET).remove(lista);
    if (error) throw new Error(error.message || "No se pudo borrar el archivo anterior.");
  }
  const rpc = async (sb, fn, args) => { const r = await sb.rpc(fn, args); if (r.error) throw new Error(r.error.message || "Error"); return r.data; };

  async function iniciar(cont, productoId, sb, portal) {
    const fs = cont && cont.closest("fieldset"); if (!cont || !window.EldoVideo) return;
    const carpeta = carpetaDe(portal);
    try { await listar(sb); } catch (e) { if (disponible === false) { if (fs) fs.remove(); return; } }
    if (!carpeta) { if (fs) fs.remove(); return; }
    if (fs) fs.hidden = false;
    EldoVideo.seccionVideo({
      contenedor: cont, productoId, carpeta,
      clases: { btn: "vp-btn sec chico", prim: "vp-btn chico", peligro: "vp-btn sec chico peligro" },
      leer: async () => { await listar(sb); return videos.find(v => v.producto_id === productoId) || null; },
      subir: async (nombre, blob, mime) => {
        const { error } = await sb.storage.from(BUCKET).upload(nombre, blob, { contentType: mime, cacheControl: "31536000", upsert: false });
        if (error) throw new Error(/exceeded|too large|413/i.test(error.message || "") ? "El archivo supera el límite de 4 MB." : (error.message || "No se pudo subir."));
        return sb.storage.from(BUCKET).getPublicUrl(nombre).data.publicUrl;
      },
      guardar: (url, poster, duracion, peso) => rpc(sb, "mkt_guardar_video", { p_producto_id: productoId, p_url: url, p_poster: poster, p_duracion: duracion, p_peso: peso }),
      eliminar: () => rpc(sb, "mkt_eliminar_video", { p_producto_id: productoId }),
      borrarArchivos: n => borrar(sb, n)
    });
  }

  // Al eliminar un producto: ANTES se anotan los archivos de su video (sin tocar nada); DESPUÉS, solo si el producto
  // se eliminó, se borran esos archivos (el registro del video se va solo con el producto). Si no se puede eliminar
  // el producto, el video queda como estaba.
  async function archivosDe(productoId, sb) {
    if (disponible === false) return [];
    try {
      const lista = await listar(sb), v = lista.find(x => x.producto_id === productoId);
      const nombre = u => String(u || "").split("/storage/v1/object/public/" + BUCKET + "/")[1] || "";
      return v ? [nombre(v.url), nombre(v.poster)].filter(Boolean) : [];
    } catch (e) { return []; }
  }
  async function borrarArchivos(sb, nombres) { try { await borrar(sb, nombres); } catch (e) { console.warn(e); } }

  window.EldoVideoPortal = { iniciar, archivosDe, borrarArchivos };
})();
