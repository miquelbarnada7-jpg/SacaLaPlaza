/* ============================================================
   TEMA COMÚN · CONFIGURACIÓN
   Es lo único que necesitas tocar para publicar la web.
   ============================================================ */
const CONFIG = {
  siteName: "Tema Común",
  siteUrl: "",                 // Tu dominio, p. ej. "https://temacomun.es" (sin barra final)
  contactEmail: "",            // Email de contacto que se muestra en la web

  // --- Premium ---
  price: "2",                  // Precio que se muestra (IVA incluido). Cámbialo también en PRICE de Cloudflare.
  paypalClientId: "",          // Client ID de tu app de PayPal. Vacío = pagos desactivados.
  api: "/api",                 // Ruta de las funciones de servidor (no la cambies)
  manualPayment: "",           // Opcional: instrucciones de Bizum o transferencia. Vacío = no se muestra.
  demo: false,                 // Déjalo en false en la web publicada.

  // --- Anuncios (Google AdSense) ---
  adsenseClient: "",           // Tu ID de editor, p. ej. "ca-pub-1234567890123456". Vacío = sin anuncios.
  adSlots: { top: "", middle: "", bottom: "" }, // IDs de bloques de anuncio. Vacíos = usa anuncios automáticos.

  // --- Rutas ---
  pathRoutes: true,            // true en la web publicada: cada oposición tiene su propia URL (/oposiciones/justicia/)

  // --- Datos legales (obligatorios en España, Ley 34/2002 LSSI) ---
  legal: {
    titular: "[Tu nombre y apellidos]",
    nif: "[Tu NIF]",
    domicilio: "[Tu domicilio]",
    email: "[Tu email de contacto]"
  }
};
