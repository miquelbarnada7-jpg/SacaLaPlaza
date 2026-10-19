// GET /robots.txt → permite rastrear la web y apunta al mapa del sitio con la dirección real.
export function onRequestGet({ request }){
  const origin = new URL(request.url).origin;
  return new Response("User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: " + origin + "/sitemap.xml\n", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
