// Base de datos D1. Las tablas se crean solas la primera vez (no hay que ejecutar nada a mano).
import { fail } from "./http.js";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     email TEXT NOT NULL UNIQUE,
     pass TEXT NOT NULL,
     recov TEXT,
     oposicion TEXT,
     premium INTEGER NOT NULL DEFAULT 0,
     premium_at INTEGER,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS progress (
     user_id INTEGER PRIMARY KEY,
     data TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS tests (
     id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL,
     title TEXT NOT NULL,
     cat TEXT,
     n INTEGER NOT NULL,
     gen TEXT,
     created_at INTEGER NOT NULL,
     data TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS tests_user ON tests(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS usage (
     user_id INTEGER NOT NULL,
     day TEXT NOT NULL,
     ai INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, day)
   )`,
  `CREATE TABLE IF NOT EXISTS attempts (
     k TEXT PRIMARY KEY,
     n INTEGER NOT NULL,
     reset_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS payments (
     order_id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL,
     amount TEXT,
     status TEXT,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS consents (
     order_id TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL,
     texto TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS daily (
     fecha TEXT NOT NULL,
     aciertos INTEGER NOT NULL,
     n INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (fecha, aciertos)
   )`,
  `CREATE TABLE IF NOT EXISTS daily_seen (
     fecha TEXT NOT NULL,
     k TEXT NOT NULL,
     PRIMARY KEY (fecha, k)
   )`
];

let ready = null;

export async function db(env){
  if (!env.DB) fail(503, "La base de datos todavía no está conectada. Revisa el paso «Base de datos» de la guía.", { code: "NO_DB" });
  if (!ready){
    ready = env.DB.batch(SCHEMA.map(s => env.DB.prepare(s))).catch(e => { ready = null; throw e; });
  }
  await ready;
  return env.DB;
}

// Limitador sencillo: como mucho `max` intentos por clave en `windowSec` segundos.
export async function hit(DB, key, max, windowSec){
  const t = Date.now();
  const row = await DB.prepare("SELECT n, reset_at FROM attempts WHERE k = ?").bind(key).first();
  if (!row || row.reset_at < t){
    await DB.prepare("INSERT OR REPLACE INTO attempts (k, n, reset_at) VALUES (?, 1, ?)").bind(key, t + windowSec * 1000).run();
    return true;
  }
  if (row.n >= max) return false;
  await DB.prepare("UPDATE attempts SET n = n + 1 WHERE k = ?").bind(key).run();
  return true;
}
export async function clearHits(DB, key){ await DB.prepare("DELETE FROM attempts WHERE k = ?").bind(key).run(); }
