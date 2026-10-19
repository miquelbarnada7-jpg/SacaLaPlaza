// GET /ads.txt → se genera solo con el ID de editor que pongas en adsenseClient de public/config.js.
export async function onRequestGet({ request, env }){
  let body = "# Pon tu ID de AdSense en adsenseClient de public/config.js y esta linea se rellenara sola.\n";
  try {
    const cfg = await (await env.ASSETS.fetch(new URL("/config.js", request.url))).text();
    const m = cfg.match(/adsenseClient:\s*"ca-(pub-\d{10,20})"/);
    if (m) body = "google.com, " + m[1] + ", DIRECT, f08c47fec0942fa0\n";
  } catch (e){}
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
