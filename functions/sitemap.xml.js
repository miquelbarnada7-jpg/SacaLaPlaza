// GET /sitemap.xml → mapa del sitio con la dirección real de la web (.pages.dev o tu dominio).
const PATHS = ["/","/sube-tus-apuntes/","/privacidad/","/cookies/","/aviso-legal/","/condiciones/","/calculadora-nota/","/oposiciones/constitucion/","/oposiciones/administracion-estado/","/oposiciones/justicia/","/oposiciones/hacienda/","/oposiciones/prisiones/","/oposiciones/policia-nacional/","/oposiciones/guardia-civil/","/oposiciones/policia-local/","/oposiciones/bomberos/","/oposiciones/sanidad/","/oposiciones/educacion/"];
const LASTMOD = "2026-10-19";

export function onRequestGet({ request }){
  const origin = new URL(request.url).origin;
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    PATHS.map(p => "  <url><loc>" + origin + p + "</loc><lastmod>" + LASTMOD + "</lastmod></url>").join("\n") + "\n</urlset>\n";
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
