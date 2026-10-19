// API de SacaLaPlaza: cuentas, progreso, tests de apuntes, IA, Premium y test del día.
// Todas las rutas /api/* pasan por aquí.
import { json, fail, HttpError, readJson, clientIp, checkOrigin, dayKey } from "../../lib/http.js";
import { db, hit, clearHits } from "../../lib/db.js";
import { hashPassword, checkPassword, newRecoveryCode, hashRecovery, sha256, randomToken, secretOf } from "../../lib/cripto.js";
import { createSession, clearCookie, currentUser, requireUser, publicUser, endSession } from "../../lib/auth.js";
import { createOrder, captureOrder, priceOf } from "../../lib/paypal.js";
import { generate } from "../../lib/ia.js";

// Texto que el comprador acepta antes de pagar (debe coincidir con la casilla de la página de Premium).
const CONSENT_TEXT = "Acepto las condiciones de compra y que Premium se active al momento, por lo que pierdo el derecho de desistimiento (art. 103.m de la Ley General para la Defensa de los Consumidores y Usuarios).";

const OPOS = {
  ce: "Constitución Española (tema común)", age: "Administración General del Estado (Auxiliar, Administrativo y Gestión)",
  jus: "Justicia (Auxilio, Tramitación y Gestión Procesal)", hac: "Agentes de la Hacienda Pública",
  iipp: "Ayudantes de Instituciones Penitenciarias", pn: "Policía Nacional (Escala Básica)", gc: "Guardia Civil (Cabos y Guardias)",
  pl: "Policía Local", bom: "Bomberos", san: "Sanidad (TCAE, Celador y Enfermería)", edu: "Educación (Maestros y Secundaria)"
};
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const lim = (env, name, def) => { const n = parseInt(env[name] || "", 10); return isFinite(n) && n >= 0 ? n : def; };
const limits = (env, u) => u.premium
  ? { ia: lim(env, "AI_LIMIT_PREMIUM", 300), tests: 300, maxPreguntas: 50 }
  : { ia: lim(env, "AI_LIMIT_FREE", 20), tests: 10, maxPreguntas: 10 };

function validPassword(p){
  if (typeof p !== "string" || p.length < 8) fail(400, "La contraseña debe tener al menos 8 caracteres.");
  if (p.length > 200) fail(400, "La contraseña es demasiado larga.");
}
async function ipKey(request, env){ return (await sha256(secretOf(env) + "|ip|" + clientIp(request))).slice(0, 22); }

async function cupo(DB, env, u){
  const row = await DB.prepare("SELECT ai FROM usage WHERE user_id = ? AND day = ?").bind(u.id, dayKey()).first();
  const L = limits(env, u);
  return { usado: row ? row.ai : 0, limite: L.ia, maxPreguntas: L.maxPreguntas, maxTests: L.tests, ia: !!(env.AI && env.AI.run) };
}

async function dist(DB, fecha){
  const { results } = await DB.prepare("SELECT aciertos, n FROM daily WHERE fecha = ?").bind(fecha).all();
  const d = new Array(11).fill(0);
  let total = 0;
  for (const r of results || []){ if (r.aciertos >= 0 && r.aciertos <= 10){ d[r.aciertos] = r.n; total += r.n; } }
  return { fecha, total, dist: d };
}

async function route({ request, env }){
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
  const M = request.method;
  checkOrigin(request);

  if (path === "/salud") {
    const r = { ok: true, db: !!env.DB, ia: !!(env.AI && env.AI.run), paypal: !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET), entorno: String(env.PAYPAL_ENV || "sandbox"), secreto: !!(env.AUTH_SECRET || env.LICENSE_SECRET) };
    if (env.DB){ try { await db(env); r.tablas = true; } catch (e){ r.tablas = false; r.error = String(e.message || e); } }
    return json(r);
  }

  const DB = await db(env);

  /* ---------------- Cuenta ---------------- */
  if (path === "/cuenta/yo" && M === "GET"){
    const u = await currentUser(DB, request);
    return json({ user: publicUser(u) });
  }

  if (path === "/cuenta/registro" && M === "POST"){
    const b = await readJson(request, 4000);
    const email = String(b.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) fail(400, "Escribe un email válido.");
    validPassword(b.password);
    if (b.acepto !== true) fail(400, "Tienes que aceptar la política de privacidad y las condiciones.");
    const opo = OPOS[b.oposicion] ? b.oposicion : null;
    if (!await hit(DB, "reg:" + await ipKey(request, env), 8, 3600)) fail(429, "Has creado demasiadas cuentas seguidas. Inténtalo dentro de una hora.");
    const exists = await DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (exists) fail(409, "Ya existe una cuenta con ese email. Inicia sesión o recupera tu contraseña.", { code: "EXISTS" });
    const recovery = newRecoveryCode();
    const res = await DB.prepare("INSERT INTO users (email, pass, recov, oposicion, premium, created_at) VALUES (?, ?, ?, ?, 0, ?)")
      .bind(email, await hashPassword(env, b.password), await hashRecovery(env, recovery), opo, Date.now()).run();
    const id = res.meta && res.meta.last_row_id;
    const u = await DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
    const cookie = await createSession(DB, request, u.id);
    return json({ user: publicUser(u), recovery }, 201, { "Set-Cookie": cookie });
  }

  if (path === "/cuenta/entrar" && M === "POST"){
    const b = await readJson(request, 4000);
    const email = String(b.email || "").trim().toLowerCase();
    const kEmail = "login:" + (await sha256(email)).slice(0, 22), kIp = "loginip:" + await ipKey(request, env);
    if (!await hit(DB, kIp, 40, 900) || !await hit(DB, kEmail, 8, 900)) fail(429, "Demasiados intentos. Espera 15 minutos y vuelve a probar.");
    const u = EMAIL_RE.test(email) ? await DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first() : null;
    if (!u || !await checkPassword(env, String(b.password || ""), u.pass)) fail(401, "Email o contraseña incorrectos.");
    await clearHits(DB, kEmail);
    const cookie = await createSession(DB, request, u.id);
    return json({ user: publicUser(u) }, 200, { "Set-Cookie": cookie });
  }

  if (path === "/cuenta/salir" && M === "POST"){
    await endSession(DB, request);
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie(request) });
  }

  if (path === "/cuenta/recuperar" && M === "POST"){
    const b = await readJson(request, 4000);
    const email = String(b.email || "").trim().toLowerCase();
    if (!await hit(DB, "rec:" + await ipKey(request, env), 10, 3600)) fail(429, "Demasiados intentos. Espera una hora y vuelve a probar.");
    validPassword(b.password);
    const u = EMAIL_RE.test(email) ? await DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first() : null;
    if (!u || !u.recov || u.recov !== await hashRecovery(env, b.codigo)) fail(401, "El email o el código de recuperación no son correctos.");
    const recovery = newRecoveryCode();
    await DB.batch([
      DB.prepare("UPDATE users SET pass = ?, recov = ? WHERE id = ?").bind(await hashPassword(env, b.password), await hashRecovery(env, recovery), u.id),
      DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id)
    ]);
    const cookie = await createSession(DB, request, u.id);
    return json({ user: publicUser(u), recovery }, 200, { "Set-Cookie": cookie });
  }

  // A partir de aquí, todo necesita sesión salvo el test del día.
  if (path === "/dia"){
    const fecha = M === "GET" ? String(url.searchParams.get("fecha") || "") : null;
    if (M === "GET"){
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) fail(400, "Fecha no válida.");
      return json(await dist(DB, fecha));
    }
    if (M === "POST"){
      const b = await readJson(request, 1000);
      const f = String(b.fecha || ""), a = parseInt(b.aciertos, 10);
      const hoy = Date.now(), ok = [dayKey(hoy - 86400000), dayKey(hoy), dayKey(hoy + 86400000)];
      if (ok.indexOf(f) < 0 || !(a >= 0 && a <= 10)) fail(400, "Datos no válidos.");
      const k = (await sha256(secretOf(env) + "|dia|" + f + "|" + clientIp(request) + "|" + String(b.cid || "").slice(0, 40))).slice(0, 22);
      const ins = await DB.prepare("INSERT OR IGNORE INTO daily_seen (fecha, k) VALUES (?, ?)").bind(f, k).run();
      if (ins.meta && ins.meta.changes){
        await DB.prepare("INSERT INTO daily (fecha, aciertos, n) VALUES (?, ?, 1) ON CONFLICT(fecha, aciertos) DO UPDATE SET n = n + 1").bind(f, a).run();
      }
      return json(await dist(DB, f));
    }
  }

  const u = await requireUser(DB, request);

  if (path === "/cuenta/perfil" && M === "POST"){
    const b = await readJson(request, 2000);
    const opo = OPOS[b.oposicion] ? b.oposicion : null;
    await DB.prepare("UPDATE users SET oposicion = ? WHERE id = ?").bind(opo, u.id).run();
    u.oposicion = opo;
    return json({ user: publicUser(u) });
  }

  if (path === "/cuenta/clave" && M === "POST"){
    const b = await readJson(request, 4000);
    if (!await checkPassword(env, String(b.actual || ""), u.pass)) fail(401, "La contraseña actual no es correcta.");
    validPassword(b.nueva);
    await DB.batch([
      DB.prepare("UPDATE users SET pass = ? WHERE id = ?").bind(await hashPassword(env, b.nueva), u.id),
      DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(u.id, u.sid)
    ]);
    return json({ ok: true });
  }

  if (path === "/cuenta/codigo" && M === "POST"){
    const b = await readJson(request, 4000);
    if (!await checkPassword(env, String(b.password || ""), u.pass)) fail(401, "La contraseña no es correcta.");
    const recovery = newRecoveryCode();
    await DB.prepare("UPDATE users SET recov = ? WHERE id = ?").bind(await hashRecovery(env, recovery), u.id).run();
    return json({ recovery });
  }

  if (path === "/cuenta/cerrar-sesiones" && M === "POST"){
    await DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(u.id, u.sid).run();
    return json({ ok: true });
  }

  if (path === "/cuenta/compras" && M === "GET"){
    const { results } = await DB.prepare("SELECT p.order_id, p.amount, p.created_at, c.texto AS consentimiento FROM payments p LEFT JOIN consents c ON c.order_id = p.order_id WHERE p.user_id = ? ORDER BY p.created_at").bind(u.id).all();
    return json({ compras: results || [] });
  }

  if (path === "/cuenta/datos" && M === "GET"){
    const p = await DB.prepare("SELECT data, updated_at FROM progress WHERE user_id = ?").bind(u.id).first();
    const { results } = await DB.prepare("SELECT id, title, cat, n, gen, created_at, data FROM tests WHERE user_id = ? ORDER BY created_at").bind(u.id).all();
    return json({
      cuenta: publicUser(u),
      progreso: p ? JSON.parse(p.data) : null,
      tests: (results || []).map(t => ({ ...t, data: JSON.parse(t.data) })),
      compras: ((await DB.prepare("SELECT order_id, amount, created_at FROM payments WHERE user_id = ? ORDER BY created_at").bind(u.id).all()).results) || []
    }, 200, { "Content-Disposition": 'attachment; filename="sacalaplaza-mis-datos.json"' });
  }

  if (path === "/cuenta/borrar" && M === "POST"){
    const b = await readJson(request, 4000);
    if (!await checkPassword(env, String(b.password || ""), u.pass)) fail(401, "La contraseña no es correcta.");
    await DB.batch([
      DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(u.id),
      DB.prepare("DELETE FROM progress WHERE user_id = ?").bind(u.id),
      DB.prepare("DELETE FROM tests WHERE user_id = ?").bind(u.id),
      DB.prepare("DELETE FROM usage WHERE user_id = ?").bind(u.id),
      DB.prepare("DELETE FROM users WHERE id = ?").bind(u.id)
    ]);
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie(request) });
  }

  /* ---------------- Progreso sincronizado ---------------- */
  if (path === "/progreso" && M === "GET"){
    const p = await DB.prepare("SELECT data, updated_at FROM progress WHERE user_id = ?").bind(u.id).first();
    return json({ data: p ? JSON.parse(p.data) : null, actualizado: p ? p.updated_at : null });
  }
  if (path === "/progreso" && (M === "PUT" || M === "POST")){
    const b = await readJson(request, 400000);
    if (!b.data || typeof b.data !== "object") fail(400, "Datos no válidos.");
    const t = Date.now();
    await DB.prepare("INSERT INTO progress (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
      .bind(u.id, JSON.stringify(b.data), t).run();
    return json({ ok: true, actualizado: t });
  }

  /* ---------------- Tests de apuntes ---------------- */
  if (path === "/tests" && M === "GET"){
    const { results } = await DB.prepare("SELECT id, title, cat, n, gen, created_at FROM tests WHERE user_id = ? ORDER BY created_at DESC LIMIT 300").bind(u.id).all();
    return json({ tests: results || [], cupo: await cupo(DB, env, u) });
  }
  if (path === "/tests" && M === "POST"){
    const b = await readJson(request, 300000);
    const qs = Array.isArray(b.preguntas) ? b.preguntas : [];
    const L = limits(env, u);
    if (!qs.length) fail(400, "El test no tiene preguntas.");
    if (qs.length > 60) fail(400, "Un test puede tener como mucho 60 preguntas.");
    for (const q of qs){
      if (!q || typeof q.q !== "string" || !Array.isArray(q.o) || q.o.length < 2 || q.o.length > 4) fail(400, "Hay una pregunta con un formato no válido.");
    }
    const count = await DB.prepare("SELECT COUNT(*) AS n FROM tests WHERE user_id = ?").bind(u.id).first();
    if (count.n >= L.tests) fail(403, u.premium ? "Has llegado al máximo de tests guardados. Borra alguno para guardar más." : "Con la cuenta gratis puedes guardar " + L.tests + " tests. Borra alguno o hazte Premium para guardar hasta 300.", { code: "LIMIT_TESTS" });
    const id = randomToken(9);
    const title = String(b.titulo || "Mi test").replace(/\s+/g, " ").trim().slice(0, 120) || "Mi test";
    const cat = OPOS[b.cat] ? b.cat : null;
    const gen = ["ia", "basico", "mixto"].indexOf(b.gen) >= 0 ? b.gen : "basico";
    const data = { preguntas: qs, nOpts: b.nOpts === 3 ? 3 : 4, fuente: String(b.fuente || "").slice(0, 200), secciones: Array.isArray(b.secciones) ? b.secciones.slice(0, 60).map(s => String(s).slice(0, 120)) : [] };
    await DB.prepare("INSERT INTO tests (id, user_id, title, cat, n, gen, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, u.id, title, cat, qs.length, gen, Date.now(), JSON.stringify(data)).run();
    return json({ id }, 201);
  }
  const mt = /^\/tests\/([A-Za-z0-9_-]{6,40})$/.exec(path);
  if (mt){
    const row = await DB.prepare("SELECT * FROM tests WHERE id = ? AND user_id = ?").bind(mt[1], u.id).first();
    if (!row) fail(404, "Ese test no existe o no es tuyo.");
    if (M === "GET") return json({ test: { id: row.id, title: row.title, cat: row.cat, n: row.n, gen: row.gen, created_at: row.created_at, ...JSON.parse(row.data) } });
    if (M === "DELETE"){ await DB.prepare("DELETE FROM tests WHERE id = ? AND user_id = ?").bind(row.id, u.id).run(); return json({ ok: true }); }
    if (M === "PATCH"){
      const b = await readJson(request, 2000);
      const title = String(b.titulo || "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!title) fail(400, "Escribe un nombre.");
      await DB.prepare("UPDATE tests SET title = ? WHERE id = ? AND user_id = ?").bind(title, row.id, u.id).run();
      return json({ ok: true });
    }
  }

  /* ---------------- IA ---------------- */
  if (path === "/ia/cupo" && M === "GET") return json(await cupo(DB, env, u));

  if (path === "/ia/preguntas" && M === "POST"){
    const b = await readJson(request, 60000);
    const c = await cupo(DB, env, u);
    if (!c.ia) fail(503, "La IA no está activada en el servidor.", { code: "NO_AI" });
    const quedan = c.limite - c.usado;
    if (quedan <= 0) fail(429, "Has usado tus " + c.limite + " preguntas con IA de hoy." + (u.premium ? "" : " Con Premium tienes hasta " + lim(env, "AI_LIMIT_PREMIUM", 300) + " al día.") + " Puedes seguir con el generador básico.", { code: "LIMIT_IA", cupo: c });
    const texto = String(b.texto || "").slice(0, 14000);
    if (texto.replace(/\s/g, "").length < 200) fail(400, "Este fragmento tiene muy poco texto para hacer preguntas.");
    const nOpts = b.nOpts === 3 ? 3 : 4;
    const k = Math.max(1, Math.min(8, parseInt(b.n, 10) || 5, quedan));
    if (!await hit(DB, "ia:" + u.id, 40, 60)) fail(429, "Vas demasiado rápido. Espera un minuto.");
    let r;
    try {
      r = await generate(env, { oposicion: OPOS[b.cat] || "Oposiciones en España", k, nOpts, texto });
    } catch (e){
      if (e && e.code === "AI_QUOTA") fail(503, "La IA ha llegado a su límite diario. Usa el generador básico y vuelve mañana.", { code: "AI_QUOTA" });
      if (e && e.code === "NO_AI") fail(503, "La IA no está activada en el servidor.", { code: "NO_AI" });
      fail(502, "La IA no ha podido generar preguntas ahora mismo.", { code: "AI_ERROR", detalle: String(e && e.message || e).slice(0, 200) });
    }
    await DB.prepare("INSERT INTO usage (user_id, day, ai) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET ai = ai + excluded.ai")
      .bind(u.id, dayKey(), r.questions.length).run();
    return json({ preguntas: r.questions, modelo: r.model, cupo: { ...c, usado: c.usado + r.questions.length } });
  }

  /* ---------------- Premium con PayPal ---------------- */
  if (path === "/paypal/crear" && M === "POST"){
    if (u.premium) fail(409, "Tu cuenta ya es Premium.", { code: "ALREADY" });
    const b = await readJson(request, 2000);
    if (b.acepto !== true) fail(400, "Marca la casilla de aceptación para continuar.", { code: "NO_CONSENT" });
    return json({ id: await createOrder(env, u), precio: priceOf(env) });
  }
  if (path === "/paypal/capturar" && M === "POST"){
    const b = await readJson(request, 2000);
    const orderId = String(b.orderID || "");
    if (!/^[A-Z0-9]{8,32}$/.test(orderId)) fail(400, "Pedido no válido.");
    const prev = await DB.prepare("SELECT user_id FROM payments WHERE order_id = ?").bind(orderId).first();
    if (prev && prev.user_id !== u.id) fail(403, "Este pago pertenece a otra cuenta.");
    if (!prev){
      const cap = await captureOrder(env, orderId, u);
      const t0 = Date.now();
      // Se guarda la aceptación expresa de la pérdida del desistimiento (art. 103.m LGDCU) para el justificante.
      await DB.batch([
        DB.prepare("INSERT OR IGNORE INTO payments (order_id, user_id, amount, status, created_at) VALUES (?, ?, ?, 'COMPLETED', ?)").bind(orderId, u.id, cap.amount, t0),
        DB.prepare("INSERT OR IGNORE INTO consents (order_id, user_id, texto, created_at) VALUES (?, ?, ?, ?)").bind(orderId, u.id, CONSENT_TEXT, t0)
      ]);
    }
    const t = Date.now();
    await DB.prepare("UPDATE users SET premium = 1, premium_at = COALESCE(premium_at, ?) WHERE id = ?").bind(t, u.id).run();
    const nu = await DB.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first();
    return json({ user: publicUser(nu) });
  }

  fail(404, "Ruta no encontrada.");
}

export async function onRequest(context){
  try {
    return await route(context);
  } catch (e){
    if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
    console.error("API error", e && e.stack || e);
    const msg = String(e && e.message || "");
    if (/AUTH_SECRET/.test(msg)) return json({ error: msg, code: "NO_SECRET" }, 503);
    return json({ error: "Ha habido un error en el servidor. Inténtalo de nuevo." }, 500);
  }
}
