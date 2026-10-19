// Sesiones de usuario guardadas en D1. La cookie solo lleva un token aleatorio;
// en la base de datos se guarda su huella (SHA-256), nunca el token.
import { getCookie, cookieHeader, fail } from "./http.js";
import { randomToken, sha256 } from "./cripto.js";

export const COOKIE = "slp_s";
const DAYS = 60;
const MS_DAY = 86400000;

export async function createSession(DB, request, userId){
  const token = randomToken(32);
  const t = Date.now();
  await DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), userId, t, t + DAYS * MS_DAY).run();
  return cookieHeader(request, COOKIE, token, DAYS * 86400);
}

export function clearCookie(request){ return cookieHeader(request, COOKIE, "", 0); }

export async function currentUser(DB, request){
  const token = getCookie(request, COOKIE);
  if (!token || token.length > 100) return null;
  const sid = await sha256(token);
  const row = await DB.prepare(
    "SELECT u.*, s.id AS sid, s.expires_at AS s_exp FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?"
  ).bind(sid).first();
  if (!row) return null;
  const t = Date.now();
  if (row.s_exp < t){ await DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run(); return null; }
  // Sesión deslizante: si quedan menos de 30 días, se renueva.
  if (row.s_exp - t < 30 * MS_DAY) await DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(t + DAYS * MS_DAY, sid).run();
  return row;
}

export async function requireUser(DB, request){
  const u = await currentUser(DB, request);
  if (!u) fail(401, "Tienes que iniciar sesión.", { code: "NO_SESSION" });
  return u;
}

export function publicUser(u){
  if (!u) return null;
  return { id: u.id, email: u.email, oposicion: u.oposicion || null, premium: !!u.premium, premiumDesde: u.premium_at || null, creado: u.created_at };
}

export async function endSession(DB, request){
  const token = getCookie(request, COOKIE);
  if (token) await DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
}
