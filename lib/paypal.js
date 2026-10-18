// Utilidades compartidas por las funciones de servidor (Cloudflare Pages Functions).
// Variables de entorno necesarias (Cloudflare > tu proyecto > Settings > Variables and Secrets):
//   PAYPAL_CLIENT_ID      Client ID de tu app de PayPal
//   PAYPAL_CLIENT_SECRET  Secret de tu app de PayPal (márcalo como "Secret")
//   PAYPAL_ENV            "sandbox" para pruebas o "live" para cobrar de verdad
//   LICENSE_SECRET        Una frase larga y aleatoria; firma los códigos Premium (márcalo como "Secret")
//   PRICE                 Precio con punto decimal, p. ej. "2.00"

export const apiBase = env => (env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
export const priceOf = env => env.PRICE || "2.00";

export function json(data, status = 200){
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function accessToken(env){
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new Error("Faltan las claves de PayPal en las variables de entorno");
  const auth = btoa(env.PAYPAL_CLIENT_ID + ":" + env.PAYPAL_CLIENT_SECRET);
  const r = await fetch(apiBase(env) + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  if (!r.ok) throw new Error("No se pudo autenticar con PayPal");
  return (await r.json()).access_token;
}

const enc = new TextEncoder();
function b64url(bytes){
  let s = ""; bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmac(secret, msg){
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
function same(a, b){
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Código Premium: TC1.<datos>.<firma>
export async function makeLicense(secret, orderId){
  if (!secret) throw new Error("Falta LICENSE_SECRET");
  const payload = b64url(enc.encode(JSON.stringify({ o: orderId, t: Date.now() })));
  return "TC1." + payload + "." + b64url(await hmac(secret, payload));
}
export async function checkLicense(secret, license){
  if (!secret) return false;
  const p = String(license || "").trim().split(".");
  if (p.length !== 3 || p[0] !== "TC1" || !p[1] || !p[2]) return false;
  return same(b64url(await hmac(secret, p[1])), p[2]);
}
