// Contraseñas, tokens de sesión y códigos de recuperación.
// Las contraseñas se guardan con PBKDF2-SHA256, sal aleatoria y una "pimienta" secreta
// (AUTH_SECRET, o LICENSE_SECRET si ya la tenías), que nunca se guarda en la base de datos.

const enc = new TextEncoder();

export function b64url(bytes){
  let s = "";
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(str){
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function randomBytes(n){ const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
export const randomToken = (n = 32) => b64url(randomBytes(n));

export async function sha256(text){
  const d = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return b64url(new Uint8Array(d));
}
async function hmacBytes(secret, msg){
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
export function safeEqual(a, b){
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function secretOf(env){
  const s = env.AUTH_SECRET || env.LICENSE_SECRET;
  if (!s || s.length < 16) throw new Error("Falta la variable secreta AUTH_SECRET (o LICENSE_SECRET) en Cloudflare.");
  return s;
}

async function derive(password, salt, iterations, pepper){
  const peppered = await hmacBytes(pepper, password);
  const key = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return b64url(new Uint8Array(bits));
}

export async function hashPassword(env, password){
  const iterations = Math.min(100000, Math.max(5000, parseInt(env.PBKDF2_ITER || "10000", 10) || 10000));
  const salt = randomBytes(16);
  return "p2$" + iterations + "$" + b64url(salt) + "$" + await derive(password, salt, iterations, secretOf(env));
}

export async function checkPassword(env, password, stored){
  const p = String(stored || "").split("$");
  if (p.length !== 4 || p[0] !== "p2") return false;
  const h = await derive(password, fromB64url(p[2]), parseInt(p[1], 10), secretOf(env));
  return safeEqual(h, p[3]);
}

// Código de recuperación: 16 caracteres sin letras confusas (sin 0/O, 1/I/L).
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newRecoveryCode(){
  const b = randomBytes(16);
  let s = "";
  for (let i = 0; i < 16; i++){ s += ALPHA[b[i] % ALPHA.length]; if (i % 4 === 3 && i < 15) s += "-"; }
  return s;
}
export const normRecovery = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export async function hashRecovery(env, code){ return sha256(secretOf(env) + "|rec|" + normRecovery(code)); }
