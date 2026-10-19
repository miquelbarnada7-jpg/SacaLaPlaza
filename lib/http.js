// Utilidades HTTP compartidas por las funciones de servidor.

export class HttpError extends Error {
  constructor(status, message, extra){ super(message); this.status = status; this.extra = extra || {}; }
}

export function fail(status, message, extra){ throw new HttpError(status, message, extra); }

export function json(data, status = 200, headers = {}){
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

// Lee el cuerpo JSON con un tamaño máximo.
export async function readJson(request, max = 200000){
  const text = await request.text();
  if (text.length > max) fail(413, "Has enviado demasiados datos de una vez.");
  if (!text) return {};
  try { return JSON.parse(text); } catch (e){ fail(400, "Los datos enviados no son válidos."); }
}

export function getCookie(request, name){
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")){
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function cookieHeader(request, name, value, maxAgeSec){
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return name + "=" + encodeURIComponent(value) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + maxAgeSec + secure;
}

export function clientIp(request){
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "local";
}

// Rechaza peticiones que cambian datos si vienen de otra web (protección CSRF).
export function checkOrigin(request){
  if (request.method === "GET" || request.method === "HEAD") return;
  const origin = request.headers.get("Origin");
  if (!origin) return;
  if (origin !== new URL(request.url).origin) fail(403, "Petición no permitida.");
}

export const now = () => Date.now();

// Día en formato AAAA-MM-DD según la hora de España (para los cupos diarios).
export function dayKey(ts = Date.now()){
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}
