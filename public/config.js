/* ============================================================
   SACALAPLAZA · CONFIGURACIÓN
   Es el único archivo que necesitas tocar en la web.
   ============================================================ */
const CONFIG = {
  siteName: "SacaLaPlaza",
  siteUrl: "",                 // Déjalo vacío: la web usa sola su dirección (sirve con .pages.dev y con un dominio propio)
  contactEmail: "miquel.barnada7@gmail.com",            // Email de contacto que se muestra en la web

  // --- Premium ---
  price: "4,99",               // Precio que se muestra (IVA incluido). Cámbialo también en PRICE de Cloudflare (con punto: 4.99).
  paypalClientId: "BAAikZnjRz3B1f4pUW5xaKxHCv39DYjw4q1Hba6YSuJE8ZeLDyldKu80qrrz2sTtctl53-2oLXyl1SZDXQ",          // Client ID de tu app de PayPal. Vacío = pagos desactivados.
  api: "/api",                 // Ruta del servidor (no la cambies)
  manualPayment: "",           // Opcional: instrucciones de Bizum o transferencia. Vacío = no se muestra.
  demo: false,                  // Déjalo en false en la web publicada.

  // --- Anuncios (Google AdSense) ---
  adsenseClient: "ca-pub-9103945932574158",           // Tu ID de editor, p. ej. "ca-pub-1234567890123456". Vacío = sin anuncios. El archivo ads.txt se rellena solo.
  adSlots: {"top": "", "middle": "", "bottom": ""}, // IDs de bloques de anuncio. Vacíos = usa anuncios automáticos.

  // --- Rutas ---
  pathRoutes: true,           // true en la web publicada: cada oposición tiene su propia URL (/oposiciones/justicia/)

  // --- Librerías para leer PDF, Word y documentos escaneados ---
  libs: {
    pdf: "/vendor/pdf/pdf.min.mjs",
    pdfWorker: "/vendor/pdf/pdf.worker.min.mjs",
    jszip: "/vendor/jszip.min.js",
    tesseract: "/vendor/tess/tesseract.min.js",
    tesseractWorker: "/vendor/tess/worker.min.js",
    tesseractCore: "/vendor/tess/core",
    tesseractLang: "/vendor/tess/lang"
  },

  // --- Datos legales (obligatorios en España, Ley 34/2002 LSSI) ---
  legal: {
    titular: "Miquel Barnada I Noguer",
    nif: "42361903C",
    domicilio: "Carrer Joan Maragall, 4, 17458 Fornells de la Selva (Girona)",
    email: "miquel.barnada7@gmail.com"
  }
};
