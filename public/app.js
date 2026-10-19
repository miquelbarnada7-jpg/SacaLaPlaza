(function(){
"use strict";

/* ============================================================
   UTILIDADES
   ============================================================ */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const LET = ["A","B","C","D"];
const pad = n => String(n).padStart(2,"0");
const todayKey = (d = new Date()) => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const fmtDate = k => { const [y,m,d] = k.split("-"); return d+"/"+m+"/"+y; };
const fmtNum = n => n.toFixed(2).replace(".", ",");
const fmtDay = ts => { const d = new Date(ts); return pad(d.getDate()) + "/" + pad(d.getMonth()+1) + "/" + d.getFullYear(); };
const pct = (c,n) => n ? Math.round(c/n*100) : 0;
function rng(seed){ let h = 2166136261; for (const ch of seed){ h ^= ch.charCodeAt(0); h = Math.imul(h,16777619); } return function(){ h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ t>>>15, t|1); t ^= t + Math.imul(t ^ t>>>7, t|61); return ((t ^ t>>>14)>>>0)/4294967296; }; }
function shuffle(arr, r = Math.random){ const a = arr.slice(); for (let i=a.length-1;i>0;i--){ const j = Math.floor(r()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; } return a; }

// Claves de progreso que se sincronizan con la cuenta.
const SYNC_KEYS = ["qs","mk","hist","days","best","withCE"];
const isSyncKey = k => SYNC_KEYS.indexOf(k) >= 0 || k.indexOf("daily:") === 0;
let syncMuted = false;
const store = {
  get(k,d){ try { const v = localStorage.getItem("tc2:"+k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k,v){ try { localStorage.setItem("tc2:"+k, JSON.stringify(v)); } catch(e){} if (!syncMuted && isSyncKey(k)) scheduleSync(); },
  del(k){ try { localStorage.removeItem("tc2:"+k); } catch(e){} },
  keys(prefix){ const out = []; try { for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if (k && k.indexOf("tc2:"+prefix) === 0) out.push(k.slice(4)); } } catch(e){} return out; }
};
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(()=>t.classList.remove("show"), 3000); }
function copyText(text, outSel){
  const out = outSel ? $(outSel) : null;
  const fallback = () => { if (!out) return; out.innerHTML = '<textarea class="copy-box" rows="3" readonly aria-label="Texto para copiar">'+esc(text)+'</textarea><p class="hint">Selecciona el texto y cópialo.</p>'; const ta = out.querySelector("textarea"); ta.focus(); ta.select(); };
  try { navigator.clipboard.writeText(text).then(()=>{ toast("Copiado"); if (out) out.innerHTML = ""; }, fallback); } catch(e){ fallback(); }
}
const PRICE = CONFIG.price + " €";
const SITE = CONFIG.siteUrl || (CONFIG.demo ? "" : location.origin);
const BRAND = CONFIG.siteName || "SacaLaPlaza";

/* ============================================================
   DATOS DERIVADOS
   ============================================================ */
const catById = Object.fromEntries(CATS.map(c => [c.id, c]));
const catBySlug = Object.fromEntries(CATS.map(c => [c.slug, c]));
const FRIENDLY = { "CE":"Artículos de la Constitución", "LGT":"Ley General Tributaria", "LBRL":"Régimen local (LBRL)", "LOPJ":"Poder Judicial (LOPJ)", "LOGP":"Ley General Penitenciaria", "TREBEP":"Empleados públicos (TREBEP)", "LO 2/1986":"Fuerzas y Cuerpos de Seguridad", "LO 4/2015":"Seguridad Ciudadana", "LO 9/2015":"Personal de la Policía Nacional", "Ley 41/2002":"Autonomía del paciente", "Ley 39/2015":"Ley 39/2015", "Ley 40/2015":"Ley 40/2015" };
function ceTitle(ref){
  const m = /Art\. (\d+)/.exec(ref); if (!m) return "Estructura y origen";
  const n = +m[1];
  if (n<=9) return "Título Preliminar"; if (n<=55) return "Derechos y deberes"; if (n<=65) return "La Corona";
  if (n<=96) return "Cortes Generales"; if (n<=116) return "Gobierno"; if (n<=127) return "Poder Judicial";
  if (n<=136) return "Economía y Hacienda"; if (n<=158) return "Organización territorial"; if (n<=165) return "Tribunal Constitucional";
  return "Reforma constitucional";
}
function groupOf(cat, ref){
  if (cat === "ce") return ceTitle(ref);
  const head = ref.split(",")[0].trim();
  return FRIENDLY[head] || head;
}
const Q = [], QBY = {};
CATS.forEach(c => {
  QBY[c.id] = [];
  (RAW[c.id] || []).forEach((r,i) => { const q = { id:c.id+"-"+i, c:c.id, r:r[0], q:r[1], o:r[2], e:r[3] }; q.g = groupOf(c.id, r[0]); Q.push(q); QBY[c.id].push(q); });
});
const QID = Object.fromEntries(Q.map(q => [q.id, q]));
const TOTAL = Q.length;
const NCATS = CATS.length - 1;
const penText = p => p === 0 ? "sin penalización" : p === 1/2 ? "1/2" : p === 1/4 ? "1/4" : "1/3";

/* ============================================================
   SERVIDOR (API)
   ============================================================ */
async function api(path, opts = {}){
  const method = opts.method || "GET";
  if (CONFIG.demo && window.SLP_MOCK) return window.SLP_MOCK(path, method, opts.data);
  let r;
  try {
    r = await fetch(CONFIG.api + path, {
      method, credentials: "same-origin", keepalive: !!opts.keepalive,
      headers: opts.data !== undefined ? { "Content-Type": "application/json" } : {},
      body: opts.data !== undefined ? JSON.stringify(opts.data) : undefined
    });
  } catch(e){ const err = new Error("No hay conexión con el servidor. Revisa tu internet."); err.code = "OFFLINE"; throw err; }
  let d = {};
  try { d = await r.json(); } catch(e){}
  if (!r.ok){
    const err = new Error(d.error || (r.status === 404 ? "El servidor no está disponible." : "Error " + r.status));
    err.status = r.status; err.code = d.code; err.data = d; throw err;
  }
  return d;
}

/* ============================================================
   CUENTA
   ============================================================ */
let ME = store.get("me", null);
const isPremium = () => !!(ME && ME.premium);
let adsLoaded = false;

function setMe(u){
  const wasPrem = isPremium(), wasIn = !!ME;
  ME = u || null;
  if (ME) store.set("me", ME); else store.del("me");
  refreshHeader();
  if (!wasPrem && isPremium() && adsLoaded){ setTimeout(() => location.reload(), 1200); return "reload"; }
  return wasIn !== !!ME || wasPrem !== isPremium() ? "changed" : "same";
}
async function loadMe(){
  try {
    const d = await api("/cuenta/yo");
    const res = setMe(d.user);
    if (res === "reload") return;
    const progChanged = ME ? await pullProgress() : false;
    const r = currentRoute();
    if (S && !S.done) return;
    if (res === "changed" || (progChanged && r !== "cuenta" && r !== "subir")) render();
  } catch(e){ /* sin conexión: se mantiene lo guardado */ }
}
function requireLogin(next, msg){
  store.set("next", next || currentRoute());
  if (msg) store.set("nextMsg", msg);
  location.hash = "cuenta";
}
async function afterLogin(u, isNew){
  setMe(u);
  await pullProgress();
  const next = store.get("next", null); store.del("next");
  toast(isNew ? "Cuenta creada. ¡Bienvenido a " + BRAND + "!" : "Has iniciado sesión");
  if (next && next !== "cuenta") location.hash = next; else render();
}
async function logout(){
  try { await pushProgress(); } catch(e){}
  try { await api("/cuenta/salir", { method: "POST", data: {} }); } catch(e){}
  syncMuted = true;
  SYNC_KEYS.forEach(k => store.del(k)); store.keys("daily:").forEach(k => store.del(k));
  syncMuted = false;
  setMe(null);
  toast("Has cerrado sesión. Tu progreso sigue guardado en tu cuenta.");
  location.hash = "inicio"; render();
}

/* ---------- Sincronizar progreso entre dispositivos ---------- */
let syncT = null, syncBusy = false;
function collectProgress(){
  const o = {};
  SYNC_KEYS.forEach(k => { const v = store.get(k, undefined); if (v !== undefined) o[k] = v; });
  o.daily = {};
  store.keys("daily:").forEach(k => { o.daily[k.slice(6)] = store.get(k, null); });
  return o;
}
function mergeProgress(a, b){
  a = a || {}; b = b || {};
  const out = {};
  const qa = a.qs || {}, qb = b.qs || {}, qs = { ...qa };
  Object.keys(qb).forEach(id => { if (!qs[id] || (qb[id] && qb[id].n > qs[id].n)) qs[id] = qb[id]; });
  out.qs = qs;
  out.mk = Array.from(new Set((a.mk || []).concat(b.mk || [])));
  const hist = {}; (a.hist || []).concat(b.hist || []).forEach(h => { if (h && h.t) hist[h.t] = h; });
  out.hist = Object.values(hist).sort((x,y) => x.t - y.t).slice(-60);
  out.days = Array.from(new Set((a.days || []).concat(b.days || []))).sort().slice(-400);
  out.best = Math.max(a.best || 0, b.best || 0);
  out.withCE = a.withCE !== undefined ? a.withCE : b.withCE;
  out.daily = { ...(b.daily || {}), ...(a.daily || {}) };
  return out;
}
function applyProgress(p){
  syncMuted = true;
  SYNC_KEYS.forEach(k => { if (p[k] !== undefined) store.set(k, p[k]); });
  Object.keys(p.daily || {}).forEach(d => { if (p.daily[d]) store.set("daily:" + d, p.daily[d]); });
  syncMuted = false;
}
function scheduleSync(){ if (!ME) return; clearTimeout(syncT); syncT = setTimeout(() => pushProgress().catch(()=>{}), 2500); }
async function pushProgress(keepalive){
  if (!ME) return;
  clearTimeout(syncT); syncT = null;
  await api("/progreso", { method: "PUT", data: { data: collectProgress() }, keepalive: !!keepalive });
}
async function pullProgress(){
  if (!ME || syncBusy) return false;
  syncBusy = true;
  let changed = false;
  try {
    const d = await api("/progreso");
    const local = mergeProgress(collectProgress(), {});
    const merged = mergeProgress(collectProgress(), d.data || {});
    changed = JSON.stringify(local) !== JSON.stringify(merged);
    if (changed) applyProgress(merged);
    if (!d.data || JSON.stringify(mergeProgress(d.data, {})) !== JSON.stringify(merged)) await pushProgress();
    refreshHeader();
  } catch(e){} finally { syncBusy = false; }
  return changed;
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && syncT) pushProgress(true).catch(()=>{}); });

/* ============================================================
   PREMIUM CON PAYPAL
   ============================================================ */
let paypalLoading = null;
function loadPayPal(){
  if (window.paypal) return Promise.resolve();
  if (paypalLoading) return paypalLoading;
  paypalLoading = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(CONFIG.paypalClientId) + "&currency=EUR&intent=capture&components=buttons&locale=es_ES";
    s.onload = res; s.onerror = () => { paypalLoading = null; rej(); };
    document.head.appendChild(s);
  });
  return paypalLoading;
}
function buyMsg(text, kind){ const m = $("#buyMsg"); if (m){ m.className = "msg" + (kind ? " "+kind : ""); m.innerHTML = text; m.hidden = false; } }
function premiumActivated(u){
  const r = setMe(u);
  toast("Pago completado. Tu cuenta ya es Premium para siempre. Puedes descargar el justificante en esta página o en Mi cuenta.");
  if (r !== "reload") render();
}
function renderPayPal(){
  const box = $("#paypalBox"); if (!box) return;
  box.innerHTML = '<p class="hint">Cargando PayPal…</p>';
  loadPayPal().then(() => {
    box.innerHTML = "";
    window.paypal.Buttons({
      style: { layout:"vertical", shape:"rect", label:"pay", height:44 },
      onClick: (data, actions) => {
        if (!$("#consent") || !$("#consent").checked){ buyMsg("Marca la casilla de aceptación para continuar.", "err"); return actions.reject(); }
        return actions.resolve();
      },
      createOrder: () => api("/paypal/crear", { method:"POST", data:{ acepto: !!($("#consent") && $("#consent").checked) } }).then(d => d.id).catch(e => { buyMsg(esc(e.message), "err"); throw e; }),
      onApprove: data => api("/paypal/capturar", { method:"POST", data:{ orderID: data.orderID } }).then(d => premiumActivated(d.user))
        .catch(e => buyMsg(esc(e.message) + " Si PayPal te ha cobrado, escríbenos" + (CONFIG.contactEmail ? " a <b>"+esc(CONFIG.contactEmail)+"</b>" : "") + " con el justificante y lo solucionamos.", "err")),
      onError: () => buyMsg("No se ha podido completar el pago. Inténtalo de nuevo.", "err")
    }).render("#paypalBox");
  }).catch(() => { box.innerHTML = '<p class="msg err">No se ha podido cargar PayPal. Revisa tu conexión o desactiva el bloqueador de anuncios para esta página.</p>'; });
}

/* ============================================================
   ANUNCIOS
   ============================================================ */
function adHTML(slot){
  if (isPremium()) return "";
  if (!CONFIG.adsenseClient) return '<div class="wrap"><aside class="ad" aria-label="Espacio publicitario"><div><span>Publicidad</span><br>Espacio para un anuncio de Google AdSense · desaparece con Premium</div></aside></div>';
  const id = CONFIG.adSlots && CONFIG.adSlots[slot];
  if (!id) return "";
  return '<div class="wrap ad-wrap"><span class="label">Publicidad</span><ins class="adsbygoogle" style="display:block" data-ad-client="'+esc(CONFIG.adsenseClient)+'" data-ad-slot="'+esc(id)+'" data-ad-format="auto" data-full-width-responsive="true"></ins></div>';
}
function initAds(){
  if (isPremium() || !CONFIG.adsenseClient) return;
  if (!adsLoaded){
    adsLoaded = true;
    const s = document.createElement("script");
    s.async = true; s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(CONFIG.adsenseClient);
    document.head.appendChild(s);
  }
  $$("ins.adsbygoogle:not([data-pushed])").forEach(el => { el.setAttribute("data-pushed","1"); try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch(e){} });
}

/* ============================================================
   PROGRESO
   ============================================================ */
const getQS = () => store.get("qs", {});
function record(q, ok){
  const s = getQS(); const r = s[q.id] || { n:0, c:0, st:0, w:0 };
  r.n++; if (ok){ r.c++; r.st++; } else { r.st = 0; r.w = 1; }
  s[q.id] = r; store.set("qs", s);
}
const marked = () => store.get("mk", []);
const isMarked = id => marked().indexOf(id) >= 0;
function toggleMark(id){ const m = marked(); const i = m.indexOf(id); if (i >= 0) m.splice(i,1); else m.push(id); store.set("mk", m); return i < 0; }
function poolFor(c, withCE){ return c.id === "ce" ? QBY.ce.slice() : QBY[c.id].concat(withCE && c.ce ? QBY.ce : []); }
function failedFor(c){ const s = getQS(); const ids = new Set(poolFor(c, true).map(q=>q.id)); return Object.keys(s).filter(id => ids.has(id) && s[id].w && s[id].st < 2).map(id => QID[id]); }
function markedFor(c){ const ids = new Set(poolFor(c, true).map(q=>q.id)); return marked().filter(id => ids.has(id)).map(id => QID[id]); }
function totals(){ const s = getQS(); let n=0, c=0; Object.values(s).forEach(v => { n += v.n; c += v.c; }); return { n, c }; }
function streakInfo(){
  const set = new Set(store.get("days", [])); let cur = 0; const d = new Date();
  if (!set.has(todayKey(d))) d.setDate(d.getDate()-1);
  while (set.has(todayKey(d))){ cur++; d.setDate(d.getDate()-1); }
  const best = Math.max(store.get("best", 0), cur);
  if (best !== store.get("best", 0)) store.set("best", best);
  return { cur, best };
}
const withCEpref = () => store.get("withCE", true);

/* ============================================================
   RUTAS
   ============================================================ */
const PAGES = { inicio: "/", calculadora: "/calculadora-nota/", subir: "/sube-tus-apuntes/" };
function href(route){
  if (CONFIG.pathRoutes){
    if (PAGES[route]) return PAGES[route];
    if (route.indexOf("op-") === 0){ const c = catById[route.slice(3)]; return c ? "/oposiciones/" + c.slug + "/" : "/"; }
    if (route === "oposiciones" || route === "calendario") return "/#" + route;
  }
  return "#" + route;
}
function currentRoute(){ const h = location.hash.replace(/^#/, ""); return h || window.TC_INITIAL_ROUTE || "inicio"; }

/* ============================================================
   CABECERA, TEMA Y AVISO
   ============================================================ */
const NAV = [["inicio","Inicio"],["oposiciones","Oposiciones"],["subir","Sube tus apuntes"],["calculadora","Calculadora"],["calendario","Calendario"],["progreso","Mi progreso"]];
function renderNav(route){
  $("#nav").innerHTML = NAV.map(([r,t]) => '<a href="'+href(r)+'"'+(route===r || (r==="oposiciones" && route.indexOf("op-")===0) ? ' aria-current="page"' : "")+'>'+t+(r === "subir" ? ' <span class="new">Nuevo</span>' : "")+'</a>').join("");
  $(".brand").setAttribute("href", href("inicio"));
}
function refreshHeader(){
  $("#streakVal").textContent = streakInfo().cur;
  const pl = $("#premLink");
  if (isPremium()){ pl.textContent = "Premium ✓"; pl.classList.add("on"); } else { pl.textContent = "Premium " + PRICE; pl.classList.remove("on"); }
  const al = $("#acctLink");
  if (ME){ al.innerHTML = '<span class="avatar" aria-hidden="true">'+esc(ME.email.charAt(0).toUpperCase())+'</span><span class="acct-txt">Mi cuenta</span>'; al.setAttribute("aria-label", "Mi cuenta (" + ME.email + ")"); }
  else { al.innerHTML = '<span class="acct-txt">Entrar</span>'; al.setAttribute("aria-label", "Entrar o crear cuenta"); }
}
const THEMES = ["auto","light","dark"], THEME_LABEL = { auto:"auto", light:"claro", dark:"oscuro" };
function applyTheme(t){ if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t); $("#themeBtn").textContent = "Tema: " + THEME_LABEL[t]; }
$("#themeBtn").addEventListener("click", () => { const cur = store.get("theme","auto"); const nx = THEMES[(THEMES.indexOf(cur)+1) % 3]; store.set("theme", nx); applyTheme(nx); });
function renderNotice(){
  const today = new Date(todayKey()+"T00:00:00");
  const ev = EVENTS.map(e => ({ ...e, days: Math.round((new Date(e.d+"T00:00:00") - today)/86400000) })).filter(e => e.days >= 0 && e.days <= 60).sort((a,b) => a.days-b.days)[0];
  if (!ev){ $("#notice").innerHTML = ""; return; }
  $("#notice").innerHTML = '<div class="notice"><div class="wrap"><span class="days">'+(ev.days === 0 ? "Es hoy" : ev.days === 1 ? "Mañana" : "Faltan "+ev.days+" días")+'</span><span>'+esc(ev.t)+' · '+fmtDate(ev.d)+'</span><a href="'+href("op-"+ev.cat)+'">Repasar ahora</a></div></div>';
}
function renderFooter(){
  $("#footCats").innerHTML = CATS.map(c => '<li><a href="'+href("op-"+c.id)+'">'+esc(c.short)+'</a></li>').join("");
  $("#footContact").innerHTML = CONFIG.contactEmail ? 'Contacto: <span class="mono">'+esc(CONFIG.contactEmail)+'</span>' : "";
}

/* ============================================================
   HOJA DE EXAMEN (motor de tests)
   ============================================================ */
let S = null, timer = null, cdTimer = null;
const body = () => $("#sBody");
function sheetHTML(title, meta){ return '<section class="sheet" id="sheet" aria-live="polite"><div class="sheet-head"><span class="title" id="sTitle">'+esc(title)+'</span><span class="meta" id="sMeta">'+esc(meta||"")+'</span></div><div class="progress"><i id="sProg"></i></div><div class="sheet-body" id="sBody"></div></section>'; }
function setProg(f){ const p = $("#sProg"); if (p) p.style.width = Math.round(f*100) + "%"; }
function stopTimer(){ clearInterval(timer); timer = null; clearInterval(cdTimer); cdTimer = null; }
function scrollSheet(){ const sh = $("#sheet"); if (!sh) return; const r = sh.getBoundingClientRect(); if (r.top < 0 || r.top > window.innerHeight*0.6) sh.scrollIntoView({ behavior:"smooth", block:"start" }); }

function prepare(qs, nOpts, rnd){
  return qs.map(q => {
    let o = q.o.slice();
    if (nOpts === 3 && o.length > 3) o = [o[0]].concat(shuffle(o.slice(1), rnd).slice(0,2));
    const sh = shuffle(o, rnd);
    return { ...q, opts: sh, ans: sh.indexOf(q.o[0]) };
  });
}
function startQuiz(o){
  stopTimer();
  if (!o.qs.length){ toast("No hay preguntas para este modo todavía"); return; }
  const rnd = o.seed ? rng(o.seed + "|o") : Math.random;
  S = { pen: 1/3, nOpts: 4, ...o, qs: prepare(o.qs, o.nOpts || 4, rnd), i: 0, picks: new Array(o.qs.length).fill(null), locked: false, done: false };
  $("#sTitle").textContent = o.title;
  if (o.timeLimit){ S.end = Date.now() + o.timeLimit*1000; tick(); timer = setInterval(tick, 1000); }
  renderQ(); scrollSheet();
}
function tick(){
  if (!S) return;
  const left = Math.max(0, Math.round((S.end - Date.now())/1000));
  const m = $("#sMeta"); if (!m) return;
  m.textContent = "⏱ " + pad(Math.floor(left/60)) + ":" + pad(left%60); m.classList.toggle("warn", left <= 60);
  if (left <= 0) finish(true);
}
const qLabel = q => q.user ? (q.g || "Tus apuntes") : (catById[q.c] ? catById[q.c].short : "");
function renderQ(){
  const q = S.qs[S.i]; S.locked = false;
  setProg(S.i / S.qs.length);
  if (!S.timeLimit) $("#sMeta").textContent = (S.i+1) + " / " + S.qs.length;
  const pick = S.picks[S.i], mk = isMarked(q.id), last = S.i === S.qs.length-1;
  let h = '<div class="qnum"><div class="left"><span class="label">Pregunta '+(S.i+1)+' de '+S.qs.length+'</span><span class="label">· '+esc(qLabel(q))+'</span></div>'+(q.user ? "" : '<button class="mark-btn" data-act="mark" aria-pressed="'+mk+'" title="Marcar para repasar (tecla M)">'+(mk ? "★ Marcada" : "☆ Marcar")+'</button>')+'</div>';
  h += '<h3 class="qtext">'+esc(q.q)+'</h3><ul class="opts">' + q.opts.map((t,k) => '<li><button class="opt'+(pick===k ? " sel" : "")+'" data-act="pick" data-k="'+k+'"><span class="l">'+LET[k]+'</span><span>'+esc(t)+'</span></button></li>').join("") + '</ul><div id="fb"></div>';
  if (S.feedback){
    h += '<div class="actions"><span class="hint" id="hintTxt">Elige una respuesta · teclas <span class="kbd">1</span>–<span class="kbd">'+q.opts.length+'</span></span><button class="btn" data-act="next" id="nextBtn" hidden>'+(last ? "Ver resultado" : "Siguiente")+'</button></div>';
  } else {
    h += '<div class="actions"><div class="grp"><button class="btn ghost small" data-act="prev"'+(S.i===0 ? " disabled" : "")+'>Anterior</button><button class="btn ghost small" data-act="blank">Dejar en blanco</button></div><div class="grp"><button class="btn ghost small" data-act="ask">Entregar</button><button class="btn" data-act="next" id="nextBtn">'+(last ? "Revisar y entregar" : "Siguiente")+'</button></div></div><div id="confirmBox"></div>';
    h += '<div class="navgrid" aria-label="Ir a una pregunta">' + S.qs.map((_,j) => '<button data-act="goto" data-i="'+j+'" class="'+(S.picks[j] !== null ? "done" : "")+(j === S.i ? " cur" : "")+'" aria-label="Pregunta '+(j+1)+'">'+(j+1)+'</button>').join("") + '</div>';
  }
  body().innerHTML = h;
}
function pick(k){
  if (!S || S.locked || S.done) return;
  const q = S.qs[S.i]; if (k >= q.opts.length) return;
  S.picks[S.i] = k;
  if (!S.feedback){
    $$(".opt").forEach(b => b.classList.toggle("sel", +b.dataset.k === k));
    const nb = $$(".navgrid button")[S.i]; if (nb) nb.classList.add("done");
    return;
  }
  S.locked = true; const ok = k === q.ans; if (!q.user) record(q, ok);
  $$(".opt").forEach(b => { const kk = +b.dataset.k; b.disabled = true; if (kk === q.ans) b.classList.add("ok"); else if (kk === k) b.classList.add("bad"); });
  $("#fb").innerHTML = '<div class="explain'+(ok ? "" : " wrong")+'"><b>'+(ok ? "Correcto." : "Incorrecto. La respuesta es la "+LET[q.ans]+".")+'</b>'+(q.r ? '<span class="art">'+esc(q.r)+'</span> ' : "")+esc(q.e || "")+'</div>' + (q.user ? "" : '<p style="margin-top:10px"><button class="link-btn" data-act="report">¿Ves un error en esta pregunta?</button></p><div id="repBox"></div>');
  $("#hintTxt").innerHTML = (ok ? "Bien visto" : (q.user ? "Repásala en tus apuntes" : "Márcala con ☆ para repasarla")) + ' · <span class="kbd">Intro</span> para seguir';
  const nb = $("#nextBtn"); nb.hidden = false; nb.focus({ preventScroll: true });
}
function next(){
  if (!S || S.done) return;
  if (S.feedback && !S.locked) return;
  if (S.i < S.qs.length-1){ S.i++; renderQ(); scrollSheet(); }
  else if (S.feedback) finish(false);
  else ask();
}
function ask(){
  const blanks = S.picks.filter(p => p === null).length;
  $("#confirmBox").innerHTML = '<div class="confirm"><span>¿Entregar el examen?'+(blanks ? ' Te quedan <b>'+blanks+'</b> sin responder (no restan).' : ' Has respondido todas.')+'</span><div class="grp"><button class="btn ghost small" data-act="askNo">Seguir</button><button class="btn small" data-act="submit">Entregar</button></div></div>';
}
function finish(timeout){
  if (!S || S.done) return;
  stopTimer(); S.done = true; setProg(1);
  const res = S.qs.map((q,i) => S.picks[i] === null ? 0 : (S.picks[i] === q.ans ? 1 : -1));
  const ok = res.filter(x => x === 1).length, bad = res.filter(x => x === -1).length, bl = res.filter(x => x === 0).length;
  if (!S.feedback) S.qs.forEach((q,i) => { if (res[i] !== 0 && !q.user) record(q, res[i] === 1); });
  const net = Math.max(0, ok - bad*S.pen), nota = net / S.qs.length * 10;
  const sq = res.map(x => x === 1 ? "🟩" : x === -1 ? "🟥" : "⬜").join("");
  let firstDaily = false;
  if (S.mode === "daily" && !S.replay){
    const key = todayKey();
    if (!store.get("daily:"+key, null)){
      firstDaily = true;
      store.set("daily:"+key, { score: ok, sq });
      const days = store.get("days", []); if (days.indexOf(key) < 0){ days.push(key); store.set("days", days.slice(-400)); }
    }
  }
  if (S.mode !== "daily"){
    const h = store.get("hist", []); h.push({ t: Date.now(), cat: S.cat || null, mode: S.mode, n: S.qs.length, ok, bad, bl, nota: +nota.toFixed(2), user: !!S.userTest }); store.set("hist", h.slice(-60));
  }
  refreshHeader();
  const byG = {};
  S.qs.forEach((q,i) => { const g = q.g || "—"; byG[g] = byG[g] || { n:0, ok:0 }; byG[g].n++; if (res[i] === 1) byG[g].ok++; });
  const groups = Object.entries(byG).filter(([,v]) => v.n >= 2).sort((a,b) => a[1].ok/a[1].n - b[1].ok/b[1].n).slice(0,5);
  const fails = S.qs.map((q,i) => ({ q, r: res[i] })).filter(x => x.r !== 1);
  S.failQs = fails.map(f => QID[f.q.id] || f.q);
  $("#sMeta").textContent = timeout ? "Tiempo agotado" : "Resultado"; $("#sMeta").classList.remove("warn");
  const prem = isPremium();
  const penTxt = S.pen === 0 ? "Sin penalización por errores." : "Cada error resta " + penText(S.pen) + " de acierto; las preguntas en blanco no restan.";
  let h = '<div class="score"><span class="big mono">'+ok+'<span class="of">/'+S.qs.length+'</span></span><span><span class="label">Nota con penalización</span><br><strong class="mono" style="font-size:1.35rem">'+fmtNum(nota)+'</strong> sobre 10</span></div>';
  if (S.mode === "daily" || S.qs.length <= 30) h += '<p class="squares" aria-label="Resumen de aciertos y fallos">'+sq+'</p>';
  if (S.mode === "daily") h += '<div id="rankBox"></div>';
  h += '<div class="grid4"><div><span class="label">Aciertos</span><span class="v">'+ok+'</span></div><div><span class="label">Fallos</span><span class="v">'+bad+'</span></div><div><span class="label">En blanco</span><span class="v">'+bl+'</span></div><div><span class="label">Netas</span><span class="v">'+fmtNum(net)+'</span></div></div>';
  h += '<p class="hint">'+penTxt+(timeout ? " Se acabó el tiempo y se ha entregado automáticamente." : "")+'</p>';
  h += '<div class="actions" style="justify-content:flex-start"><div class="grp">';
  if (S.mode === "daily") h += '<button class="btn" data-act="share">Copiar resultado para compartir</button><a class="btn ghost" href="'+href("oposiciones")+'">Practicar mi oposición</a>';
  else if (S.userTest){
    h += '<button class="btn" data-act="userAgain">Repetir este test</button>';
    if (fails.length) h += '<button class="btn ghost" data-act="retryFails">Repasar estos '+fails.length+' fallos</button>';
    h += '<button class="btn ghost" data-act="userBack">Volver a mis tests</button>';
  } else {
    h += '<button class="btn" data-act="again">Repetir con otras preguntas</button>';
    if (fails.length) h += prem ? '<button class="btn ghost" data-act="retryFails">Repasar estos '+fails.length+' fallos</button>' : '<a class="btn ghost" href="'+href("premium")+'">Repasar fallos <span class="lock">Premium</span></a>';
    if (S.cat) h += '<button class="btn ghost" data-act="menu">Volver al menú</button>';
  }
  h += '</div></div><div id="shareOut"></div>';
  if (S.mode === "daily") h += '<p class="hint" style="margin-top:12px">Nuevo test del día en <span class="mono" id="cd">--:--:--</span></p>';
  if (groups.length > 1){
    h += '<div style="margin-top:22px"><p class="label">Por bloque</p><div class="bars">' + groups.map(([g,v]) => { const p = pct(v.ok, v.n); return '<div class="bar-row"><span>'+esc(g)+'</span><span class="mono" style="text-align:right">'+v.ok+'/'+v.n+'</span><span class="track"><i class="'+(p<50 ? "low" : p<75 ? "mid" : "hi")+'" style="width:'+p+'%"></i></span></div>'; }).join("") + '</div></div>';
  }
  if (fails.length) h += '<div class="review"><p class="label">Repasa '+(fails.length === 1 ? "esta pregunta" : "estas "+fails.length+" preguntas")+'</p>' + fails.map(f => '<div class="item"><strong>'+esc(f.q.q)+'</strong><span>Respuesta correcta: <b>'+esc(f.q.o[0])+'</b>'+(f.r === 0 ? ' <span class="hint">(en blanco)</span>' : "")+'</span><span>'+(f.q.r ? '<span class="art">'+esc(f.q.r)+'</span> ' : "")+esc(f.q.e || "")+'</span></div>').join("") + '</div>';
  else h += '<p style="margin-top:14px"><strong>Pleno.</strong> Ni un fallo.</p>';
  body().innerHTML = h;
  if (S.mode === "daily"){ startCountdown(); dailyRank(ok, firstDaily); }
  scrollSheet();
}
function startCountdown(){
  clearInterval(cdTimer);
  const upd = () => { const el = $("#cd"); if (!el){ clearInterval(cdTimer); return; } const n = new Date(); const t = new Date(n.getFullYear(), n.getMonth(), n.getDate()+1) - n; const s = Math.floor(t/1000); el.textContent = pad(Math.floor(s/3600)) + ":" + pad(Math.floor(s%3600/60)) + ":" + pad(s%60); };
  upd(); cdTimer = setInterval(upd, 1000);
}
function shareDaily(score, sq){
  const text = BRAND + " · Test del día " + fmtDate(todayKey()) + "\n" + score + "/10 " + sq + (SITE ? "\n¿Cuántas sacas tú? " + SITE : "\n¿Cuántas sacas tú?");
  copyText(text, "#shareOut");
}

/* ---------- Comparativa del test del día ---------- */
function clientId(){ let c = store.get("cid", null); if (!c){ c = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("cid", c); } return c; }
async function dailyRank(score, send){
  const box = $("#rankBox"); if (!box) return;
  const key = todayKey();
  try {
    let d;
    if (send && !store.get("dsent:" + key, false)){ d = await api("/dia", { method: "POST", data: { fecha: key, aciertos: score, cid: clientId() } }); store.set("dsent:" + key, true); }
    else d = await api("/dia?fecha=" + key);
    if (!$("#rankBox") || !d || !d.total) return;
    const below = d.dist.slice(0, score).reduce((a,b) => a + b, 0);
    const avg = d.dist.reduce((a, n, i) => a + n*i, 0) / d.total;
    const p = Math.round(below / d.total * 100);
    let html = '<div class="rank"><div class="rank-bars" aria-hidden="true">' + d.dist.map((n,i) => '<i class="'+(i === score ? "me" : "")+'" style="height:'+Math.max(4, Math.round(n / Math.max.apply(null, d.dist) * 100))+'%" title="'+i+'/10: '+n+'"></i>').join("") + '</div><div>';
    if (d.total >= 10) html += '<strong>Has superado al '+p+' % de los '+d.total.toLocaleString("es-ES")+' opositores</strong> que han hecho hoy el test. Media: <span class="mono">'+avg.toFixed(1).replace(".", ",")+'</span>/10.';
    else html += '<strong>Eres de los primeros en hacer el test de hoy.</strong> Vuelve más tarde para ver cómo quedas frente al resto.';
    box.innerHTML = html + '</div></div>';
  } catch(e){ /* sin servidor: no se muestra */ }
}

/* ---------- Test del día ---------- */
function dailyQs(key){
  const r = rng("tc-dia-" + key);
  const ce = shuffle(QBY.ce, r).slice(0,4);
  const others = shuffle(Q.filter(q => q.c !== "ce"), r).slice(0,6);
  return shuffle(ce.concat(others), r);
}
function startDaily(){
  const key = todayKey(), done = store.get("daily:"+key, null), qs = dailyQs(key);
  $("#sTitle").textContent = "Test del día · " + fmtDate(key);
  if (done){
    stopTimer(); S = null; setProg(1); $("#sMeta").textContent = "Hecho";
    body().innerHTML = '<p class="label">Ya has hecho el test de hoy</p><div class="score" style="margin:8px 0"><span class="big mono">'+done.score+'<span class="of">/10</span></span></div><p class="squares">'+done.sq+'</p><div id="rankBox"></div><p class="hint" style="margin-top:10px">Nuevo test en <span class="mono" id="cd">--:--:--</span>. Puedes repetirlo sin que cambie tu resultado.</p><div class="actions" style="justify-content:flex-start"><div class="grp"><button class="btn" data-act="shareDone">Copiar resultado</button><button class="btn ghost" data-act="dailyRedo">Repetir</button><a class="btn ghost" href="'+href("oposiciones")+'">Elegir oposición</a></div></div><div id="shareOut"></div>';
    startCountdown(); dailyRank(done.score, true); return;
  }
  startQuiz({ mode:"daily", title:"Test del día · " + fmtDate(key), qs, feedback:true, seed:key });
}

/* ---------- Menú de una oposición ---------- */
let CUR = null;
function modeBtn(act, k, title, desc, tag, locked){
  return '<button class="mode'+(locked ? " locked" : "")+'" data-act="'+(locked ? "toPremium" : act)+'"><span class="k">'+k+'</span><span><strong>'+title+'</strong><small>'+desc+'</small></span><span class="tag">'+(locked ? '<span class="lock">Premium</span>' : tag)+'</span></button>';
}
const OTROS = "Otros temas";
const SMALL = {};
CATS.forEach(c => { const m = {}; QBY[c.id].forEach(q => { m[q.g] = (m[q.g] || 0) + 1; }); SMALL[c.id] = new Set(Object.keys(m).filter(g => c.id !== "ce" && m[g] < 2)); });
const gOf = q => SMALL[q.c] && SMALL[q.c].has(q.g) ? OTROS : q.g;
function catGroups(c){
  const m = {}; QBY[c.id].forEach(q => { const g = gOf(q); m[g] = (m[g] || 0) + 1; });
  return Object.entries(m).sort((a,b) => (a[0] === OTROS) - (b[0] === OTROS)).map(([name,n]) => ({ name, n }));
}
function catMenu(){
  const c = CUR; stopTimer(); S = null;
  $("#sTitle").textContent = "Practicar · " + c.short;
  $("#sMeta").textContent = poolFor(c, true).length + " preguntas"; $("#sMeta").classList.remove("warn"); setProg(0);
  const prem = isPremium(), nf = failedFor(c).length, nm = markedFor(c).length;
  const minSim = Math.min(20, poolFor(c, withCEpref()).length);
  let h = '<div class="menu">';
  h += modeBtn("quick", "10", "Test rápido", "10 preguntas con corrección y explicación al momento", "Gratis");
  h += modeBtn("sim", "SIM", "Simulacro corto", minSim + " preguntas · " + minSim + " minutos · " + esc(c.penLabel), "Gratis");
  h += modeBtn("custom", "PRO", "Simulacro a medida", "Elige preguntas, tiempo, bloques y penalización", "Premium", !prem);
  h += modeBtn("failed", "FALL", "Repaso de fallos", nf ? nf + " preguntas pendientes de dominar" : "Las que falles se guardarán aquí", nf ? nf : "—", !prem);
  h += modeBtn("marked", "★", "Preguntas marcadas", nm ? nm + " marcadas" : "Marca preguntas con ☆ mientras practicas", nm ? nm : "—", !prem);
  h += '<a class="mode" href="'+href("subir")+'"><span class="k">PDF</span><span><strong>Test con tus apuntes</strong><small>Sube un PDF o Word y crea un test de '+c.opts+' opciones como el de '+esc(c.short)+'</small></span><span class="tag">Cuenta gratis</span></a>';
  h += '</div>';
  if (c.ce) h += '<div class="opts-row"><label><input type="checkbox" id="withCE" '+(withCEpref() ? "checked" : "")+'> Incluir preguntas de la Constitución ('+QBY.ce.length+')</label></div>';
  const gs = catGroups(c);
  h += '<div style="margin-top:20px" class="stack"><span class="label">Practicar por bloques</span><div class="groups">' + gs.map(g => '<button class="chip" data-act="group" data-g="'+esc(g.name)+'">'+esc(g.name)+' <span class="mono">'+g.n+'</span></button>').join("") + (c.ce ? '<button class="chip" data-act="groupCE">Constitución completa <span class="mono">'+QBY.ce.length+'</span></button>' : "") + '<button class="chip" data-act="groupAll">Todo mezclado <span class="mono">'+poolFor(c, withCEpref()).length+'</span></button></div></div>';
  body().innerHTML = h;
}
function mixFor(c, n, withCE){
  if (c.id === "ce" || !withCE || !c.ce) return shuffle(QBY[c.id]).slice(0, n);
  const own = Math.min(QBY[c.id].length, Math.round(n*0.7));
  return shuffle(shuffle(QBY[c.id]).slice(0, own).concat(shuffle(QBY.ce).slice(0, n-own)));
}
function baseOpts(c){ return { cat: c.id, pen: c.pen, nOpts: c.opts }; }
function startQuick(){ const c = CUR; startQuiz({ ...baseOpts(c), mode:"quick", title:"Test rápido · " + c.short, qs: mixFor(c, 10, withCEpref()), feedback:true }); }
function startSim(){ const c = CUR; const n = Math.min(20, poolFor(c, withCEpref()).length); startQuiz({ ...baseOpts(c), mode:"sim", title:"Simulacro · " + c.short, qs: mixFor(c, n, withCEpref()), feedback:false, timeLimit: n*60 }); }
function startGroup(name){ const c = CUR; startQuiz({ ...baseOpts(c), mode:"group", title: name, qs: shuffle(QBY[c.id].filter(q => gOf(q) === name)), feedback:true }); }
function startCustomForm(){
  const c = CUR; const gs = catGroups(c);
  $("#sTitle").textContent = "Simulacro a medida · " + c.short; $("#sMeta").textContent = "Premium";
  body().innerHTML = '<form id="customForm" class="stack" novalidate>'+
    '<div class="form-grid"><label class="field"><span class="label">Número de preguntas</span><select id="cfN"><option value="10">10</option><option value="20">20</option><option value="30" selected>30</option><option value="50">50</option><option value="100">100</option><option value="0">Todas las disponibles</option></select></label>'+
    '<label class="field"><span class="label">Tiempo</span><select id="cfT"><option value="0">Sin límite</option><option value="1" selected>1 minuto por pregunta</option><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">60 minutos</option><option value="90">90 minutos</option></select></label>'+
    '<label class="field"><span class="label">Penalización por error</span><select id="cfP"><option value="'+c.pen+'" selected>La de esta oposición</option><option value="0.5">1/2</option><option value="0.3333333333">1/3</option><option value="0.25">1/4</option><option value="0">Sin penalización</option></select></label>'+
    '<label class="field"><span class="label">Corrección</span><select id="cfF"><option value="0" selected>Al final, como en el examen</option><option value="1">Al momento, con explicación</option></select></label></div>'+
    '<div class="stack"><span class="label">Bloques</span><div class="groups" id="cfG">' + gs.map(g => '<button type="button" class="chip" data-act="toggleChip" aria-pressed="true" data-g="'+esc(g.name)+'">'+esc(g.name)+'</button>').join("") + (c.ce ? '<button type="button" class="chip" data-act="toggleChip" aria-pressed="'+withCEpref()+'" data-g="__CE__">Constitución</button>' : "") + '</div></div>'+
    '<label class="opts-row" style="margin-top:0"><input type="checkbox" id="cfNew"> Priorizar preguntas que nunca he respondido</label>'+
    '<div class="actions"><button type="button" class="btn ghost" data-act="menu">Volver</button><button type="submit" class="btn">Empezar simulacro</button></div><p class="msg err" id="cfMsg" hidden></p></form>';
  $("#customForm").addEventListener("submit", e => {
    e.preventDefault();
    const sel = $$("#cfG .chip[aria-pressed='true']").map(b => b.dataset.g);
    let pool = QBY[c.id].filter(q => sel.indexOf(gOf(q)) >= 0);
    if (sel.indexOf("__CE__") >= 0 && c.id !== "ce") pool = pool.concat(QBY.ce);
    if (!pool.length){ const m = $("#cfMsg"); m.textContent = "Elige al menos un bloque."; m.hidden = false; return; }
    const s = getQS(); pool = shuffle(pool);
    if ($("#cfNew").checked) pool.sort((a,b) => (s[a.id] ? 1 : 0) - (s[b.id] ? 1 : 0));
    const nSel = +$("#cfN").value; const n = nSel === 0 ? pool.length : Math.min(nSel, pool.length);
    const tSel = +$("#cfT").value; const time = tSel === 0 ? 0 : tSel === 1 ? n*60 : tSel*60;
    startQuiz({ ...baseOpts(c), mode:"custom", title:"Simulacro a medida · " + c.short, qs: shuffle(pool.slice(0, n)), feedback: $("#cfF").value === "1", timeLimit: time, pen: +$("#cfP").value });
  });
}

/* ============================================================
   VISTAS
   ============================================================ */
const view = () => $("#view");
function catCard(c){
  const n = c.id === "ce" ? QBY.ce.length : QBY[c.id].length + (c.ce ? QBY.ce.length : 0);
  return '<a class="cat" href="'+href("op-"+c.id)+'"><div class="cat-top"><span class="mono-box">'+c.mono+'</span><h3>'+esc(c.name)+'</h3></div><p class="cuerpos">'+esc(c.cuerpos)+'</p><div class="cat-foot"><span><span class="label">'+(c.id === "ce" ? "Preguntas" : "Plazas")+'</span><span class="n">'+esc(c.id === "ce" ? String(QBY.ce.length) : c.plazas)+'</span></span><span style="text-align:right"><span class="pill '+(c.id === "iipp" ? "soon" : c.estado)+'">'+esc(c.estadoLabel)+'</span><br><span class="hint">'+n+' preguntas</span></span></div></a>';
}
function calTable(){
  return '<div class="table-wrap"><table><thead><tr><th>Oposición</th><th>Plazas</th><th>Situación</th><th>Cuándo</th><th></th></tr></thead><tbody>' +
    CAL.map(r => '<tr><td><strong>'+esc(r.n)+'</strong></td><td class="num">'+esc(r.p)+'</td><td><span class="pill '+r.st+'">'+esc(r.s)+'</span></td><td>'+esc(r.w)+'</td><td>'+(r.cat ? '<a href="'+href("op-"+r.cat)+'">Practicar</a>' : '<span class="hint">Próximamente</span>')+'</td></tr>').join("") +
    '</tbody></table></div><p class="src">Plazas de acceso libre salvo que se indique otra cosa. Las previsiones se basan en la cadencia de convocatorias anteriores; las fechas oficiales las fija el BOE o el boletín autonómico.</p>';
}
function premiumBand(){
  if (isPremium()) return "";
  return '<section class="band"><div class="wrap"><div><p class="label">'+BRAND+' Premium</p><h2>Estudia sin anuncios por '+PRICE+'. <span class="hl">Una sola vez.</span></h2><ul class="ticks"><li>Sin anuncios en toda la web, en todos tus dispositivos</li><li>Tests de tus apuntes de hasta 50 preguntas y 300 preguntas con IA al día</li><li>Simulacros a medida y repaso inteligente de tus fallos</li><li>Estadísticas por bloque e historial de notas</li></ul></div><div class="price-card"><span class="price">'+PRICE+' <small>pago único</small></span><p class="hint">Sin suscripción. Se activa en tu cuenta y te sirve en cualquier móvil u ordenador.</p><a class="btn gold" href="'+href("premium")+'">Ver Premium</a></div></div></section>';
}
function uploadBand(){
  return '<section class="wrap section"><div class="upband"><div class="stack"><p class="label">Nuevo · Sube tus apuntes</p><h2>Tu temario, convertido en un test <span class="hl">en un minuto</span></h2><p class="cat-lead">Sube tus apuntes en PDF o Word. Leemos el documento entero (también si está escaneado), detectamos los temas y te preparamos preguntas con el número de opciones y la penalización de tu oposición.</p><div class="grp" style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn" href="'+href("subir")+'">Subir mis apuntes</a>'+(ME ? "" : '<a class="btn ghost" href="#cuenta" data-act="toRegister">Crear cuenta gratis</a>')+'</div></div>'+
    '<ol class="steps3"><li><span class="mono">1</span><b>Sube un PDF o DOCX</b><small>Hasta 40 MB. Si está escaneado, lo leemos con OCR.</small></li><li><span class="mono">2</span><b>Elige temas y preguntas</b><small>Detectamos los temas para que elijas qué estudiar.</small></li><li><span class="mono">3</span><b>Practica y guárdalo</b><small>El test queda en tu cuenta, en cualquier dispositivo.</small></li></ol></div></section>';
}
function viewHome(route){
  const t = totals();
  view().innerHTML =
    '<div class="wrap hero"><section><p class="label">Gratis · '+TOTAL+' preguntas · '+NCATS+' oposiciones</p><h1>Prepara tu oposición con <span class="hl">diez preguntas al día</span></h1><p class="lead">Tests de Constitución, Administración, Justicia, Hacienda, Prisiones, Policía, Guardia Civil, Bomberos, Sanidad y Docentes. Cada respuesta trae el artículo exacto y una explicación. Y si quieres, sube tus apuntes y te hacemos un test.</p>'+
    '<div class="facts"><div><span class="label">Preguntas</span><span class="v">'+TOTAL+'</span></div><div><span class="label">Oposiciones</span><span class="v">'+NCATS+'</span></div><div><span class="label">Tu acierto</span><span class="v">'+(t.n ? pct(t.c,t.n)+" %" : "—")+'</span></div></div>'+
    '<div class="quick" aria-label="Ir a una oposición">' + CATS.map(c => '<a class="chip" href="'+href("op-"+c.id)+'">'+esc(c.short)+'</a>').join("") + '</div></section>'+
    sheetHTML("Test del día", "") + '</div>' +
    adHTML("top") +
    uploadBand() +
    '<section class="wrap section" id="oposiciones"><div class="section-head"><div><h2>Elige tu oposición</h2><p>Cada sección tiene sus requisitos, cómo es el examen, el temario y tests con la penalización real de esa oposición.</p></div></div><div class="cats">' + CATS.map(catCard).join("") + '</div></section>' +
    '<section class="wrap section" id="calendario"><div class="section-head"><div><p class="label">Revisado el 19 de octubre de 2026</p><h2>Calendario de convocatorias</h2><p>Lo que está aprobado y lo que todavía es previsión para los próximos meses.</p></div></div>' + calTable() + '</section>' +
    adHTML("middle") + premiumBand();
  startDaily();
  if (route === "oposiciones" || route === "calendario"){ const el = document.getElementById(route); if (el) setTimeout(() => el.scrollIntoView({ block:"start" }), 0); }
}
function viewCat(id){
  const c = catById[id] || catBySlug[id];
  if (!c){ viewHome("inicio"); return; }
  CUR = c;
  const kf = c.id === "ce"
    ? '<div><span class="label">Preguntas</span><span class="v big">'+QBY.ce.length+'</span></div><div><span class="label">Artículos</span><span class="v big">169</span></div><div><span class="label">Títulos</span><span class="v big">11</span></div><div><span class="label">Aparece en</span><span class="v">Casi todos los temarios generales</span></div>'
    : '<div><span class="label">Plazas</span><span class="v big">'+esc(c.plazas)+'</span><span class="hint">'+esc(c.plazasNote)+'</span></div><div><span class="label">Situación</span><span class="v"><span class="pill '+(c.id === "iipp" ? "soon" : c.estado)+'">'+esc(c.estadoLabel)+'</span></span><span class="hint">'+esc(c.cuando)+'</span></div><div><span class="label">Titulación</span><span class="v" style="font-weight:500;font-size:.92rem">'+esc(c.titulo)+'</span></div><div><span class="label">Examen</span><span class="v">'+esc(c.examenCorto)+'</span><span class="hint">Penalización: '+esc(c.penLabel)+'</span></div>';
  view().innerHTML = '<div class="wrap"><nav class="crumbs" aria-label="Ruta"><a href="'+href("inicio")+'">Inicio</a> / <a href="'+href("oposiciones")+'">Oposiciones</a> / '+esc(c.short)+'</nav>'+
    '<div class="cat-head"><span class="mono-box">'+c.mono+'</span><h1>'+esc(c.name)+'</h1></div><p class="cat-lead">'+esc(c.lead)+'</p>'+
    '<div class="kf">'+kf+'</div>'+
    '<div class="cat-grid"><div class="info">'+
      '<section><h2>Cómo es el examen</h2><p>'+esc(c.examen)+'</p></section>'+
      '<section><h2>Temario</h2><ul>'+c.temario.map(t => '<li>'+esc(t)+'</li>').join("")+'</ul></section>'+
      (c.sueldo ? '<section><h2>Sueldo orientativo</h2><p>'+esc(c.sueldo)+'</p></section>' : "")+
      '<section><h2>Consejo</h2><p class="tip">'+esc(c.tip)+'</p></section>'+
      '<section><h2>Calcula tu nota</h2><p>¿Cuántas netas necesitas? Usa la <a href="'+href("calculadora")+'" data-act="calcFor" data-c="'+c.id+'">calculadora de nota</a> con la penalización de '+esc(c.short)+'.</p></section>'+
      '<section class="src"><h2>Fuentes</h2><ul>'+c.fuentes.map(f => '<li><a href="'+esc(f.u)+'" target="_blank" rel="noopener">'+esc(f.t)+'</a></li>').join("")+'</ul></section>'+
    '</div>' + sheetHTML("Practicar · " + c.short, "") + '</div></div>' +
    adHTML("middle") +
    '<section class="wrap section"><div class="section-head"><h2>Otras oposiciones</h2></div><div class="quick">' + CATS.filter(x => x.id !== c.id).map(x => '<a class="chip" href="'+href("op-"+x.id)+'">'+esc(x.short)+'</a>').join("") + '</div></section>';
  document.title = c.seoTitle;
  catMenu();
}

/* ---------- Premium ---------- */
function viewPremium(){
  const prem = isPremium();
  const rows = [["Test del día, racha y comparativa", 1, 1], ["Práctica por oposición y por bloques con explicación", 1, 1], ["Simulacro corto con penalización real", 1, 1], ["Tests con tus apuntes (cuenta gratis)", "10 preguntas", "50 preguntas"], ["Preguntas creadas con IA al día", "20", "300"], ["Tests de apuntes guardados", "10", "300"], ["Sin anuncios", 0, 1], ["Simulacros a medida de hasta 100 preguntas", 0, 1], ["Repaso inteligente de fallos y marcadas", 0, 1], ["Estadísticas por bloque e historial de notas", 0, 1]];
  const cell = v => v === 1 ? '<td class="yes">✓</td>' : v === 0 ? '<td class="no">—</td>' : '<td class="mono" style="font-size:.85rem">'+esc(v)+'</td>';
  let buy;
  if (prem){
    buy = '<div class="buy"><p class="msg ok"><b>Tu cuenta es Premium.</b> Gracias por apoyar '+BRAND+'.</p><p>Inicia sesión con <b>'+esc(ME.email)+'</b> en cualquier móvil u ordenador y tendrás Premium allí también.</p>'+(ME.premiumDesde ? '<p class="hint">Premium desde el '+fmtDay(ME.premiumDesde)+'.</p>' : "")+'<div class="grp" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" data-act="receipt">Descargar justificante</button><a class="btn ghost" href="#cuenta">Ver mi cuenta</a></div></div>';
  } else if (!ME){
    buy = '<div class="buy"><span class="price">'+PRICE+' <small>pago único · IVA incluido</small></span><p class="hint">Sin suscripción. No se renueva nunca.</p><p class="msg"><b>Primero, crea tu cuenta gratis.</b> Premium se guarda en tu cuenta, así lo tienes en todos tus dispositivos y no lo pierdes nunca.</p><div class="grp" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="toRegister" data-next="premium">Crear cuenta gratis</button><button class="btn ghost" data-act="toLogin" data-next="premium">Ya tengo cuenta</button></div></div>';
  } else {
    buy = '<div class="buy"><span class="price">'+PRICE+' <small>pago único · IVA incluido</small></span><p class="hint">Sin suscripción. No se renueva nunca. Se activará en la cuenta <b>'+esc(ME.email)+'</b>.</p>'+
      '<label class="check"><input type="checkbox" id="consent"><span>Acepto las <a href="'+href("condiciones")+'">condiciones de compra</a> y que Premium se active al momento, por lo que pierdo el derecho de desistimiento (art. 103.m de la Ley General para la Defensa de los Consumidores y Usuarios).</span></label>';
    if (CONFIG.paypalClientId && !CONFIG.demo) buy += '<div id="paypalBox"></div><p class="hint">Puedes pagar con tu cuenta de PayPal o con tarjeta, sin crear cuenta en PayPal.</p>';
    else if (CONFIG.demo) buy += '<p class="msg">Vista previa: el pago con PayPal se conecta en la web publicada. Aquí puedes probar Premium gratis.</p><button class="btn gold" data-act="demoPay">Activar Premium de prueba</button>';
    else buy += '<p class="msg">Los pagos estarán disponibles muy pronto.</p>';
    if (CONFIG.manualPayment) buy += '<div class="msg"><b>¿Prefieres otro método?</b><br>'+esc(CONFIG.manualPayment)+' Indica el email de tu cuenta: <b>'+esc(ME.email)+'</b>.</div>';
    buy += '<p class="msg" id="buyMsg" hidden></p></div>';
  }
  view().innerHTML = '<div class="wrap prem-hero"><section class="stack"><p class="label">'+BRAND+' Premium</p><h1>Todo '+BRAND+', sin anuncios, por <span class="hl">'+PRICE+' para siempre</span></h1><p class="cat-lead">Las preguntas, explicaciones y el test del día seguirán siendo gratis. Premium quita los anuncios, amplía los tests con tus apuntes y añade herramientas para estudiar mejor.</p>'+
    '<div style="overflow-x:auto"><table class="compare"><thead><tr><th>Función</th><th>Gratis</th><th>Premium</th></tr></thead><tbody>'+rows.map(r => '<tr><td>'+r[0]+'</td>'+cell(r[1])+cell(r[2])+'</tr>').join("")+'</tbody></table></div></section>'+
    '<aside class="stack">'+buy+'</aside></div>'+
    '<section class="wrap section"><div class="section-head"><h2>Preguntas frecuentes</h2></div><div class="faq">'+
      '<details><summary>¿Es una suscripción?</summary><p>No. Pagas '+PRICE+' una vez y tu cuenta queda en Premium para siempre. No hay renovaciones ni cobros futuros.</p></details>'+
      '<details><summary>¿Por qué necesito una cuenta?</summary><p>Porque Premium se guarda en tu cuenta, no en el navegador. Así lo tienes en el móvil, en el ordenador y en cualquier dispositivo donde inicies sesión, y no lo pierdes si borras el navegador.</p></details>'+
      '<details><summary>¿Cómo pago?</summary><p>Con PayPal o con tarjeta de débito o crédito a través de PayPal, sin necesidad de crear una cuenta en PayPal. Nosotros nunca vemos los datos de tu tarjeta.</p></details>'+
      '<details><summary>¿Qué pasa con mis estadísticas?</summary><p>Con la sesión iniciada, tu progreso se guarda en tu cuenta y se sincroniza entre tus dispositivos.</p></details>'+
      '<details><summary>¿Las preguntas seguirán siendo gratis?</summary><p>Sí. Todo el contenido de estudio es gratis. Premium quita los anuncios y añade herramientas de repaso, simulacros y tests más largos con tus apuntes.</p></details>'+
    '</div></section>';
  document.title = "Premium · " + BRAND;
  if (ME && !prem && CONFIG.paypalClientId && !CONFIG.demo) renderPayPal();
}

/* ---------- Mi progreso ---------- */
function histChart(hist){
  const H = hist.slice(-20); const W = 600, Hh = 190, padL = 30, padB = 22, padT = 10;
  const bw = (W - padL - 10) / 20;
  const y = v => padT + (Hh - padT - padB) * (1 - v/10);
  let s = '<svg viewBox="0 0 '+W+' '+Hh+'" role="img" aria-label="Notas de tus últimos tests">';
  [0,5,10].forEach(v => { s += '<line x1="'+padL+'" x2="'+(W-6)+'" y1="'+y(v)+'" y2="'+y(v)+'" style="stroke:var(--line);stroke-width:1'+(v === 5 ? ';stroke-dasharray:4 4' : "")+'"/><text x="'+(padL-8)+'" y="'+(y(v)+4)+'" text-anchor="end" style="fill:var(--muted);font:11px var(--f-mono)">'+v+'</text>'; });
  H.forEach((h,i) => { const x = padL + i*bw + bw*0.18, w = bw*0.64; const yy = y(h.nota); s += '<rect x="'+x.toFixed(1)+'" y="'+yy.toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+Math.max(1, y(0)-yy).toFixed(1)+'" rx="2" style="fill:'+(h.nota >= 5 ? "var(--ok)" : "var(--bad)")+'"><title>'+fmtNum(h.nota)+' · '+esc(h.user ? "Tus apuntes" : (catById[h.cat] || {}).short || "Test")+'</title></rect>'; });
  if (H.length) s += '<text x="'+(padL + (H.length-0.5)*bw)+'" y="'+(Hh-6)+'" text-anchor="middle" style="fill:var(--muted);font:11px var(--f-mono)">último</text>';
  return s + '</svg>';
}
function barRows(items){
  return '<div class="bars">' + items.map(it => { const p = pct(it.c, it.n); return '<div class="bar-row"><span>'+esc(it.name)+'</span><span class="mono" style="text-align:right">'+p+' %</span><span class="track"><i class="'+(p<50 ? "low" : p<75 ? "mid" : "hi")+'" style="width:'+p+'%"></i></span></div>'; }).join("") + '</div>';
}
function viewProgress(){
  const s = getQS(), t = totals(), st = streakInfo(), hist = store.get("hist", []), prem = isPremium();
  const byCat = CATS.map(c => { let n=0, cc=0; QBY[c.id].forEach(q => { if (s[q.id]){ n += s[q.id].n; cc += s[q.id].c; } }); return { name: c.short, n, c: cc }; }).filter(x => x.n > 0);
  const byG = {}; Q.forEach(q => { const r = s[q.id]; if (!r) return; const k = catById[q.c].short + " · " + q.g; byG[k] = byG[k] || { name:k, n:0, c:0 }; byG[k].n += r.n; byG[k].c += r.c; });
  const weak = Object.values(byG).filter(x => x.n >= 3).sort((a,b) => a.c/a.n - b.c/b.n).slice(0,6);
  const nFail = Object.keys(s).filter(id => QID[id] && s[id].w && s[id].st < 2).length;
  const veil = !prem ? '<div class="veil"><div class="stack" style="justify-items:center"><span class="lock">Premium</span><p>Historial de notas y bloques flojos</p><a class="btn small gold" href="'+href("premium")+'">Desbloquear por '+PRICE+'</a></div></div>' : "";
  const where = ME ? 'Sincronizado con tu cuenta · ' + esc(ME.email) : 'Guardado solo en este navegador · <a href="#cuenta" data-act="toRegister" data-next="progreso">crea una cuenta</a> para tenerlo en todos tus dispositivos';
  view().innerHTML = '<div class="wrap section"><div class="section-head"><div><p class="label">'+where+'</p><h2>Mi progreso</h2></div></div><div class="prog-grid">'+
    '<div class="panel"><h3>Resumen</h3><div class="grid4" style="margin:0"><div><span class="label">Respondidas</span><span class="v">'+t.n+'</span></div><div><span class="label">Acierto</span><span class="v">'+(t.n ? pct(t.c,t.n)+" %" : "—")+'</span></div><div><span class="label">Racha</span><span class="v">'+st.cur+'</span></div><div><span class="label">Mejor racha</span><span class="v">'+st.best+'</span></div></div><p class="hint">'+hist.length+(hist.length === 1 ? ' test completado' : ' tests completados')+' · '+nFail+' en repaso · '+marked().length+(marked().length === 1 ? ' marcada' : ' marcadas')+'</p></div>'+
    '<div class="panel"><h3>Acierto por oposición</h3>'+(byCat.length ? barRows(byCat) : '<p class="hint">Aún no has respondido preguntas. Empieza por el <a href="'+href("inicio")+'">test del día</a>.</p>')+'</div>'+
    '<div class="panel'+(prem ? "" : " locked-panel")+'"><h3>Historial de notas</h3><div class="chart">'+(hist.length ? histChart(hist) : '<p class="hint">Haz un simulacro para ver aquí tu evolución.</p>')+'</div>'+veil+'</div>'+
    '<div class="panel'+(prem ? "" : " locked-panel")+'"><h3>Tus bloques más flojos</h3>'+(weak.length ? barRows(weak) : '<p class="hint">Responde al menos 3 preguntas de un bloque para verlo aquí.</p>')+veil+'</div>'+
    '</div><div class="actions" style="justify-content:flex-start;margin-top:22px"><button class="btn ghost small" data-act="resetAsk">Borrar mi progreso</button></div><div id="resetBox"></div></div>';
  document.title = "Mi progreso · " + BRAND;
}

/* ---------- Cuenta: entrar, crear, recuperar y perfil ---------- */
let authTab = "login";
function opoOptions(sel){ return '<option value="">Todavía no lo sé</option>' + CATS.map(c => '<option value="'+c.id+'"'+(sel === c.id ? " selected" : "")+'>'+esc(c.name)+'</option>').join(""); }
function recoveryBox(code, title){
  return '<div class="recov"><p class="label">'+(title || "Tu código de recuperación")+'</p><div class="code big-code" id="recCode">'+esc(code)+'</div><p>Guárdalo en un sitio seguro (una nota del móvil, una foto…). <b>Es la única forma de recuperar tu cuenta si olvidas la contraseña</b>, porque no enviamos emails.</p><div class="grp" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" data-act="copyRec">Copiar código</button><button class="btn small ghost" data-act="recDone">Ya lo he guardado</button></div><div id="recOut"></div></div>';
}
function viewCuenta(){
  document.title = (ME ? "Mi cuenta" : "Entrar") + " · " + BRAND;
  const nextMsg = store.get("nextMsg", null); store.del("nextMsg");
  const pendingRec = window.__slpRec;
  if (ME){
    const c = ME.oposicion && catById[ME.oposicion];
    view().innerHTML = '<div class="wrap section acct-page"><div class="section-head"><div><p class="label">Mi cuenta</p><h2>'+esc(ME.email)+'</h2></div><span class="pill '+(ME.premium ? "conf" : "prev")+'">'+(ME.premium ? "Premium" : "Cuenta gratis")+'</span></div>'+
      (pendingRec ? recoveryBox(pendingRec, "Tu nuevo código de recuperación") : "")+
      '<div class="prog-grid">'+
        '<div class="panel"><h3>Mi oposición</h3><p class="hint">La usamos para adaptar los tests de tus apuntes (número de opciones y penalización).</p><label class="field"><span class="label">Oposición</span><select id="pfOpo">'+opoOptions(ME.oposicion)+'</select></label>'+(c ? '<p class="hint">'+esc(c.short)+': '+c.opts+' opciones por pregunta · penalización '+esc(c.penLabel)+'.</p>' : "")+'<div><button class="btn small" data-act="saveOpo">Guardar</button></div></div>'+
        '<div class="panel"><h3>Premium</h3>'+(ME.premium ? '<p class="msg ok"><b>Activo para siempre.</b> Sin anuncios y con todas las herramientas.</p><div><button class="btn small ghost" data-act="receipt">Descargar justificante de compra</button></div>' : '<p>Quita los anuncios y amplía los tests con tus apuntes por '+PRICE+', una sola vez.</p><div><a class="btn gold small" href="'+href("premium")+'">Hacerme Premium</a></div>')+'</div>'+
        '<div class="panel"><h3>Seguridad</h3><form id="pwForm" class="stack" novalidate><label class="field"><span class="label">Contraseña actual</span><input type="password" id="pwOld" autocomplete="current-password"></label><label class="field"><span class="label">Nueva contraseña</span><input type="password" id="pwNew" autocomplete="new-password" minlength="8" placeholder="Mínimo 8 caracteres"></label><div class="grp" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" type="submit">Cambiar contraseña</button><button class="btn small ghost" type="button" data-act="newRec">Nuevo código de recuperación</button></div><p class="msg" id="pwMsg" hidden></p></form></div>'+
        '<div class="panel"><h3>Sesión y datos</h3><div class="grp" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small ghost" data-act="logout">Cerrar sesión</button><button class="btn small ghost" data-act="logoutAll">Cerrar sesión en los demás dispositivos</button><button class="btn small ghost" data-act="exportData">Descargar mis datos</button></div><details class="danger"><summary>Borrar mi cuenta</summary><p class="hint">Se borrarán tu cuenta, tu progreso y tus tests. '+(ME.premium ? "<b>También perderás Premium.</b> " : "")+'No se puede deshacer.</p><form id="delForm" class="stack" novalidate><label class="field"><span class="label">Escribe tu contraseña para confirmar</span><input type="password" id="delPw" autocomplete="current-password"></label><div><button class="btn small danger-btn" type="submit">Borrar mi cuenta para siempre</button></div><p class="msg" id="delMsg" hidden></p></form></details></div>'+
      '</div></div>';
    $("#pwForm").addEventListener("submit", async e => {
      e.preventDefault(); const m = $("#pwMsg");
      const say = (t,k) => { m.textContent = t; m.className = "msg " + (k||""); m.hidden = false; };
      if ($("#pwNew").value.length < 8){ say("La nueva contraseña debe tener al menos 8 caracteres.", "err"); return; }
      try { await api("/cuenta/clave", { method:"POST", data:{ actual: $("#pwOld").value, nueva: $("#pwNew").value } }); say("Contraseña cambiada. Hemos cerrado la sesión en tus otros dispositivos.", "ok"); $("#pwOld").value = $("#pwNew").value = ""; }
      catch(err){ say(err.message, "err"); }
    });
    $("#delForm").addEventListener("submit", async e => {
      e.preventDefault(); const m = $("#delMsg");
      try { await api("/cuenta/borrar", { method:"POST", data:{ password: $("#delPw").value } }); syncMuted = true; SYNC_KEYS.forEach(k => store.del(k)); store.keys("daily:").forEach(k => store.del(k)); syncMuted = false; setMe(null); toast("Tu cuenta se ha borrado."); location.hash = "inicio"; render(); }
      catch(err){ m.textContent = err.message; m.className = "msg err"; m.hidden = false; }
    });
    return;
  }
  const tabs = [["login","Entrar"],["register","Crear cuenta"],["recover","Recuperar contraseña"]];
  let form = "";
  if (authTab === "login") form = '<form id="authForm" class="stack" novalidate><label class="field"><span class="label">Email</span><input type="email" id="auEmail" autocomplete="email" required></label><label class="field"><span class="label">Contraseña</span><input type="password" id="auPw" autocomplete="current-password" required></label><button class="btn" type="submit">Entrar</button><p class="hint">¿No tienes cuenta? <a href="#cuenta" data-act="tab" data-t="register">Créala gratis</a> · <a href="#cuenta" data-act="tab" data-t="recover">He olvidado mi contraseña</a></p></form>';
  else if (authTab === "register") form = '<form id="authForm" class="stack" novalidate><label class="field"><span class="label">Email</span><input type="email" id="auEmail" autocomplete="email" required></label><label class="field"><span class="label">Contraseña</span><input type="password" id="auPw" autocomplete="new-password" minlength="8" placeholder="Mínimo 8 caracteres" required></label><label class="field"><span class="label">¿Qué oposición preparas?</span><select id="auOpo">'+opoOptions(store.get("opo", ""))+'</select></label><label class="check"><input type="checkbox" id="auOk"><span>Tengo al menos 14 años y acepto la <a href="'+href("privacidad")+'">política de privacidad</a> y las <a href="'+href("condiciones")+'">condiciones</a>.</span></label><button class="btn" type="submit">Crear cuenta gratis</button><p class="hint">¿Ya tienes cuenta? <a href="#cuenta" data-act="tab" data-t="login">Entra</a></p></form>';
  else form = '<form id="authForm" class="stack" novalidate><p class="hint">Usa el código de recuperación que guardaste al crear tu cuenta.</p><label class="field"><span class="label">Email</span><input type="email" id="auEmail" autocomplete="email" required></label><label class="field"><span class="label">Código de recuperación</span><input type="text" id="auCode" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX" required></label><label class="field"><span class="label">Nueva contraseña</span><input type="password" id="auPw" autocomplete="new-password" minlength="8" placeholder="Mínimo 8 caracteres" required></label><button class="btn" type="submit">Cambiar contraseña y entrar</button><p class="hint">¿No tienes el código? Escríbenos'+(CONFIG.contactEmail ? ' a <b>'+esc(CONFIG.contactEmail)+'</b>' : "")+' desde el email de tu cuenta.</p></form>';
  view().innerHTML = '<div class="wrap section auth-wrap"><div class="auth-side stack"><p class="label">Tu cuenta de '+BRAND+'</p><h1>'+(authTab === "register" ? "Crea tu cuenta gratis" : authTab === "recover" ? "Recupera tu cuenta" : "Entra en tu cuenta")+'</h1><ul class="ticks"><li>Sube tus apuntes y conviértelos en tests</li><li>Tu progreso, racha y fallos en todos tus dispositivos</li><li>Premium para siempre ligado a tu cuenta</li></ul></div>'+
    '<div class="auth-card">'+(nextMsg ? '<p class="msg">'+esc(nextMsg)+'</p>' : "")+'<div class="tabs" role="tablist">'+tabs.map(([k,t]) => '<button role="tab" class="tab" aria-selected="'+(authTab===k)+'" data-act="tab" data-t="'+k+'">'+t+'</button>').join("")+'</div>'+form+'<p class="msg" id="auMsg" hidden></p></div></div>';
  $("#authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const m = $("#auMsg"), btn = e.target.querySelector("button[type=submit]");
    const say = (t,k) => { m.textContent = t; m.className = "msg " + (k||""); m.hidden = false; };
    const email = $("#auEmail").value.trim(), pw = $("#auPw").value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ say("Escribe un email válido.", "err"); return; }
    if (authTab !== "login" && pw.length < 8){ say("La contraseña debe tener al menos 8 caracteres.", "err"); return; }
    if (authTab === "register" && !$("#auOk").checked){ say("Marca la casilla de aceptación para crear la cuenta.", "err"); return; }
    btn.disabled = true; const label = btn.textContent; btn.textContent = "Un momento…";
    try {
      if (authTab === "login"){ const d = await api("/cuenta/entrar", { method:"POST", data:{ email, password: pw } }); await afterLogin(d.user, false); }
      else if (authTab === "register"){
        const d = await api("/cuenta/registro", { method:"POST", data:{ email, password: pw, oposicion: $("#auOpo").value || null, acepto: true } });
        setMe(d.user);
        showRecovery(d.recovery, () => afterLogin(d.user, true));
      } else {
        const d = await api("/cuenta/recuperar", { method:"POST", data:{ email, codigo: $("#auCode").value, password: pw } });
        setMe(d.user);
        showRecovery(d.recovery, () => afterLogin(d.user, false), "Contraseña cambiada. Este es tu nuevo código de recuperación (el anterior ya no vale):");
      }
    } catch(err){ say(err.message, "err"); btn.disabled = false; btn.textContent = label; }
  });
}
function showRecovery(code, then, intro){
  view().innerHTML = '<div class="wrap section" style="max-width:640px"><div class="auth-card stack"><h2>'+(intro ? "Listo" : "¡Cuenta creada!")+'</h2><p>'+esc(intro || "Antes de seguir, guarda tu código de recuperación:")+'</p>'+recoveryBox(code)+'</div></div>';
  window.__slpRecThen = then;
}

/* ---------- Calculadora de nota ---------- */
let calcCat = null;
function viewCalc(){
  document.title = "Calculadora de nota de oposiciones con penalización · " + BRAND;
  const c = catById[calcCat || (ME && ME.oposicion) || "age"] || catById.age;
  view().innerHTML = '<div class="wrap section"><nav class="crumbs" aria-label="Ruta" style="padding-top:0"><a href="'+href("inicio")+'">Inicio</a> / Calculadora de nota</nav><div class="calc-grid">'+
    '<section class="stack"><p class="label">Herramienta gratis</p><h1 style="font-size:clamp(1.9rem,4vw,2.7rem)">Calculadora de nota del examen tipo test</h1><p class="cat-lead">Pon tus aciertos y fallos y te decimos tu nota con la penalización real de tu oposición, cuántas netas tienes y cuántas te faltan para el aprobado.</p>'+
      '<form id="calcForm" class="panel stack" novalidate><label class="field"><span class="label">Oposición</span><select id="ccCat">'+CATS.filter(x => x.id !== "ce").map(x => '<option value="'+x.id+'"'+(x.id === c.id ? " selected" : "")+'>'+esc(x.name)+'</option>').join("")+'<option value="otra">Otra (elijo la penalización)</option></select></label>'+
      '<div class="form-grid"><label class="field"><span class="label">Preguntas del examen</span><input type="number" id="ccN" min="1" max="500" value="100" inputmode="numeric"></label><label class="field"><span class="label">Penalización por fallo</span><select id="ccP"><option value="0.5">1/2 (3 opciones)</option><option value="0.3333333333">1/3 (4 opciones)</option><option value="0.25">1/4 (5 opciones)</option><option value="0">Sin penalización</option></select></label>'+
      '<label class="field"><span class="label">Aciertos</span><input type="number" id="ccA" min="0" value="70" inputmode="numeric"></label><label class="field"><span class="label">Fallos</span><input type="number" id="ccF" min="0" value="20" inputmode="numeric"></label></div>'+
      '<label class="field"><span class="label">Nota máxima del ejercicio</span><input type="number" id="ccMax" min="1" max="1000" value="10" inputmode="decimal"></label></form></section>'+
    '<section class="panel calc-out" id="calcOut" aria-live="polite"></section></div></div>';
  const setPen = () => { const cc = catById[$("#ccCat").value]; if (cc){ $("#ccP").value = String(cc.pen === 1/3 ? "0.3333333333" : cc.pen); } };
  setPen();
  $("#calcForm").addEventListener("input", e => { if (e.target.id === "ccCat"){ setPen(); calcCat = e.target.value; } calcUpdate(); });
  $("#calcForm").addEventListener("change", e => { if (e.target.id === "ccCat"){ setPen(); calcCat = e.target.value; } calcUpdate(); });
  calcUpdate();
}
function calcUpdate(){
  const N = Math.max(1, Math.min(500, parseInt($("#ccN").value, 10) || 0));
  let A = Math.max(0, parseInt($("#ccA").value, 10) || 0), F = Math.max(0, parseInt($("#ccF").value, 10) || 0);
  const P = parseFloat($("#ccP").value) || 0, MX = Math.max(1, parseFloat(String($("#ccMax").value).replace(",", ".")) || 10);
  const over = A + F > N;
  if (over){ F = Math.max(0, N - A); A = Math.min(A, N); }
  const B = N - A - F, net = Math.max(0, A - F * P), nota = net / N * MX, half = N / 2;
  const fmt = v => (Math.round(v*100)/100).toLocaleString("es-ES");
  const rows = [0, 5, 10, 15, 20, 30].filter(f => f < N).map(f => { const need = Math.ceil(half + f * P - 1e-9); return need + f <= N ? '<tr><td class="mono">'+f+'</td><td class="mono">'+need+'</td></tr>' : ""; }).join("");
  const lose = P ? 'Cada fallo te quita <b>'+fmt(P)+'</b> aciertos. Una pregunta en blanco no suma ni resta: <b>responde solo si puedes descartar al menos '+(P === 0.5 ? "una opción" : P >= 0.33 ? "una o dos opciones" : "dos opciones")+'</b>.' : "Sin penalización: conviene responder todas las preguntas.";
  $("#calcOut").innerHTML = (over ? '<p class="msg err">Aciertos y fallos suman más que las preguntas del examen; lo hemos ajustado.</p>' : "")+
    '<p class="label">Tu resultado</p><div class="score"><span class="big mono">'+fmt(nota)+'<span class="of"> / '+fmt(MX)+'</span></span></div>'+
    '<div class="grid4"><div><span class="label">Aciertos</span><span class="v">'+A+'</span></div><div><span class="label">Fallos</span><span class="v">'+F+'</span></div><div><span class="label">En blanco</span><span class="v">'+B+'</span></div><div><span class="label">Netas</span><span class="v">'+fmt(net)+'</span></div></div>'+
    '<p>'+(net >= half ? '<b>Estarías aprobado</b> si el corte fuera la mitad de la puntuación.' : 'Te faltan <b>'+fmt(half - net)+' netas</b> para llegar a la mitad de la puntuación.')+' Recuerda que en muchas oposiciones la nota de corte depende del número de plazas y de aspirantes.</p>'+
    '<p class="hint">'+lose+'</p>'+
    '<div class="table-wrap" style="margin-top:6px"><table style="min-width:0"><thead><tr><th>Si fallas…</th><th>Aciertos para la mitad</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<p class="hint">Fórmula: netas = aciertos − fallos × '+fmt(P)+'; nota = netas ÷ preguntas × nota máxima.</p>';
}

/* ---------- Sube tus apuntes ---------- */
function viewSubir(){
  document.title = "Sube tus apuntes y crea un test · " + BRAND;
  view().innerHTML = '<div class="wrap section" id="subirRoot"><p class="hint">Cargando…</p></div>';
  const go = () => { if ($("#subirRoot")) window.SLP_ESC.render($("#subirRoot")); };
  const load = () => {
    const s = document.createElement("script"); s.src = "/escaner.js?v=" + (window.SLP_VERSION || "1");
    s.onload = go; s.onerror = () => { $("#subirRoot").innerHTML = '<p class="msg err">No se ha podido cargar el lector de documentos. Recarga la página.</p>'; };
    document.head.appendChild(s);
  };
  if (window.SLP_ESC) go();
  else if (CONFIG.demo) setTimeout(() => window.SLP_ESC ? go() : load(), 0);
  else load();
}

/* ---------- Páginas legales ---------- */
// Tabla que en el móvil se convierte en tarjetas (cada celda lleva su encabezado en data-l).
function legalTable(head, rows){
  return '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + head.map(h => '<th>' + h + '</th>').join("") + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map((c, i) => '<td data-l="' + head[i] + '">' + c + '</td>').join("") + '</tr>').join("") + '</tbody></table></div>';
}
function legalPages(){
  const L = CONFIG.legal, site = SITE || "este sitio web", mail = L.email;
  return {
    "aviso-legal": ["Aviso legal",
      '<p>En cumplimiento del artículo 10 de la Ley 34/2002, de servicios de la sociedad de la información y de comercio electrónico (LSSI), estos son los datos del titular de '+esc(site)+':</p><ul><li>Titular: '+esc(L.titular)+'</li><li>NIF: '+esc(L.nif)+'</li><li>Domicilio: '+esc(L.domicilio)+'</li><li>Email: '+esc(mail)+'</li></ul>'+
      '<h2>Objeto</h2><p>'+BRAND+' ofrece tests de práctica para preparar oposiciones y una herramienta para crear tests a partir de los apuntes de cada usuario. Es un proyecto independiente: no tiene relación con ninguna Administración pública, academia ni tribunal de selección.</p>'+
      '<h2>Exactitud de los contenidos</h2><p>Las preguntas se elaboran a partir de los textos legales vigentes y se revisan periódicamente con el BOE, pero pueden contener errores o quedar desactualizadas por reformas posteriores. Las preguntas creadas a partir de tus apuntes se generan de forma automática (en parte con inteligencia artificial) y aparecen identificadas como tales: compruébalas siempre con tu material. Los datos sobre convocatorias son orientativos; la información oficial es la publicada en el BOE y en los boletines autonómicos. Si encuentras un error, escríbenos a '+esc(mail)+'.</p>'+
      '<h2>Uso de la web</h2><p>Debes usar la web de buena fe y para tu estudio personal. No está permitido copiar de forma masiva el banco de preguntas, automatizar peticiones, intentar acceder a cuentas ajenas ni alterar el funcionamiento de la web. Solo debes subir documentos que tengas derecho a usar para estudiar; no se publican ni se comparten con nadie.</p>'+
      '<h2>Propiedad intelectual</h2><p>Los textos, preguntas, explicaciones, el diseño y el código de la web pertenecen a su titular. Las disposiciones legales y los actos oficiales citados no están protegidos por la propiedad intelectual (art. 13 de la Ley de Propiedad Intelectual).</p>'+
      '<h2>Enlaces</h2><p>Los enlaces a otras webs (BOE, boletines o fuentes de información) se ofrecen como referencia. No somos responsables de su contenido.</p>'+
      '<h2>Legislación aplicable</h2><p>Este aviso se rige por la legislación española.</p>'],
    "privacidad": ["Política de privacidad",
      '<p>Te explicamos de forma clara qué datos tratamos, para qué y cuáles son tus derechos, según el Reglamento General de Protección de Datos (RGPD) y la Ley Orgánica 3/2018 (LOPDGDD).</p>'+
      '<h2>Responsable</h2><p>'+esc(L.titular)+', NIF '+esc(L.nif)+', '+esc(L.domicilio)+'. Contacto para cualquier cuestión de privacidad: '+esc(mail)+'.</p>'+
      '<h2>Qué datos tratamos, para qué y con qué base legal</h2>'+
      legalTable(['Finalidad', 'Datos', 'Base legal', 'Conservación'], [
        ['Tu cuenta y el acceso desde cualquier dispositivo', 'Email, contraseña (guardada cifrada, nunca en claro), código de recuperación (cifrado), oposición que preparas', 'Ejecución del contrato (art. 6.1.b RGPD)', 'Mientras tengas la cuenta'],
        ['Guardar y sincronizar tu progreso', 'Respuestas, rachas, fallos, preguntas marcadas e historial', 'Ejecución del contrato', 'Mientras tengas la cuenta. Sin cuenta, solo en tu navegador'],
        ['Crear tests con tus apuntes', 'Las preguntas resultantes. Tu documento se lee en tu navegador y <b>no se envía ni se guarda en nuestros servidores</b>. Si eliges la IA, se envían fragmentos de texto que no se guardan', 'Ejecución del contrato', 'Hasta que borres el test o la cuenta'],
        ['Compra de Premium', 'Identificador del pedido, importe, fecha, cuenta y tu aceptación de las condiciones de compra', 'Ejecución del contrato y obligaciones legales contables y fiscales (art. 6.1.c)', 'El plazo legal (hasta 6 años, art. 30 del Código de Comercio), aunque borres la cuenta'],
        ['Comparativa del test del día', 'Puntuación anónima y un identificador aleatorio de tu navegador', 'Interés legítimo (art. 6.1.f) en ofrecer estadísticas', 'Agregado y anónimo'],
        ['Seguridad y prevención de abusos', 'Huella cifrada de tu dirección IP y de tu cuenta en los intentos de acceso y en el uso de la IA', 'Interés legítimo en proteger el servicio', 'Minutos u horas; los contadores diarios, unos días'],
        ['Publicidad (si no tienes Premium)', 'Cookies e identificadores de Google y sus socios', 'Tu consentimiento (art. 6.1.a), que puedes retirar en cualquier momento', 'Ver la <a href="'+href("cookies")+'">política de cookies</a>']
      ])+
      '<p>Para crear una cuenta solo son obligatorios el email y la contraseña; sin ellos no podemos darte acceso. No tomamos decisiones automatizadas que te afecten ni elaboramos perfiles: la IA solo redacta preguntas de estudio a partir del texto que tú eliges. Para crear una cuenta debes tener al menos 14 años (art. 7 LOPDGDD).</p>'+
      '<h2>Quién más trata tus datos</h2><ul>'+
        '<li><b>Cloudflare</b> aloja la web y la base de datos (guardada en servidores de la Unión Europea) y ejecuta la IA (Workers AI). Actúa como encargado del tratamiento y no usa los textos que envías a la IA para entrenar modelos.</li>'+
        '<li><b>PayPal</b> procesa los pagos como responsable independiente de tus datos de pago. Nosotros no vemos ni guardamos los datos de tu tarjeta.</li>'+
        '<li><b>Google</b> muestra los anuncios a quienes no tienen Premium, según tu elección en el aviso de cookies.</li></ul>'+
      '<p>No vendemos tus datos ni los cedemos a nadie más, salvo obligación legal.</p>'+
      '<h2>Transferencias internacionales</h2><p>Cloudflare, PayPal y Google pertenecen a grupos con sede en Estados Unidos y pueden tratar algunos datos fuera del Espacio Económico Europeo. Lo hacen al amparo del Marco de Privacidad de Datos UE-EE. UU. y de las cláusulas contractuales tipo aprobadas por la Comisión Europea.</p>'+
      '<h2>Seguridad</h2><p>Toda la web funciona con conexión cifrada (HTTPS). Las contraseñas y los códigos de recuperación se guardan cifrados con PBKDF2, y la sesión usa una cookie que no puede leer ningún script de la página.</p>'+
      '<h2>Tus derechos</h2><p>Desde «Mi cuenta» puedes descargar todos tus datos y borrar tu cuenta en cualquier momento. También puedes ejercer los derechos de acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad, y retirar tu consentimiento, escribiendo a '+esc(mail)+'. Si crees que no hemos tratado bien tus datos, puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).</p>'],
    "cookies": ["Política de cookies",
      '<p>Una cookie es un pequeño archivo que una web guarda en tu navegador. Aquí te explicamos cuáles usa '+BRAND+', para qué y cómo puedes decidir sobre ellas. Última revisión: 19 de octubre de 2026.</p>'+
      '<h2>Cookies y almacenamiento técnicos (no necesitan tu consentimiento)</h2><p>Son imprescindibles para que la web funcione o para darte un servicio que has pedido (art. 22.2 de la LSSI).</p>'+
      legalTable(['Nombre', 'Titular', 'Para qué sirve', 'Duración'], [
        ['<span class="mono">slp_s</span>', ''+BRAND+'', 'Mantener tu sesión iniciada si tienes cuenta', '60 días'],
        ['<span class="mono">tc2:*</span>', ''+BRAND+'', 'Almacenamiento local: tu progreso, tus fallos y preferencias como el tema claro u oscuro', 'Hasta que lo borres'],
        ['Cookies de PayPal', 'PayPal', 'Solo en la página de Premium y solo si inicias el pago: procesar el pago de forma segura', 'Las fija PayPal']
      ])+
      '<h2>Cookies publicitarias de terceros (solo con tu consentimiento)</h2><p>Si no tienes Premium, la web muestra anuncios de Google AdSense. Google y sus socios pueden usar cookies e identificadores para mostrar anuncios, limitar cuántas veces ves el mismo y medir su rendimiento, y, si lo aceptas, para personalizarlos.</p>'+
      '<p>Antes de usar estas cookies te mostramos el aviso de privacidad de Google (una herramienta de consentimiento certificada por IAB Europe), donde puedes <b>aceptar</b>, <b>rechazar</b> o <b>elegir por finalidades y por empresas</b>. Si rechazas, Google solo puede mostrar anuncios no personalizados o limitados. Cada empresa y su política aparecen en el propio aviso. Más información: <span class="mono">policies.google.com/technologies/partner-sites</span>.</p>'+
      '<p>Con Premium no se carga ningún anuncio ni ninguna cookie publicitaria. No usamos cookies de analítica.</p>'+
      '<h2>Cómo cambiar o retirar tu consentimiento</h2><p>Puedes cambiar tu elección cuando quieras desde el enlace <a href="#cookies" data-act="cookiePrefs">Configurar cookies</a>, que está siempre al pie de la página. También puedes borrar o bloquear las cookies desde la configuración de tu navegador (Chrome, Firefox, Safari o Edge); si borras el almacenamiento local, perderás el progreso que no esté guardado en una cuenta.</p>'+
      '<h2>Transferencias internacionales</h2><p>Google puede tratar datos fuera del Espacio Económico Europeo. Lo hace al amparo del Marco de Privacidad de Datos UE-EE. UU. y de cláusulas contractuales tipo de la Comisión Europea.</p>'],
    "condiciones": ["Condiciones de uso y de compra",
      '<p>Estas condiciones regulan el uso de '+esc(site)+' y la compra de '+BRAND+' Premium. Están disponibles en español, el único idioma en que se celebra el contrato. Puedes guardarlas o imprimirlas desde tu navegador.</p>'+
      '<h2>Cuenta</h2><p>La cuenta es gratuita y personal, y debes tener al menos 14 años. Eres responsable de guardar tu contraseña y tu código de recuperación. Podemos limitar el uso de las herramientas automáticas (por ejemplo, el número de preguntas con IA al día) para que el servicio siga siendo gratuito, y suspender cuentas que incumplan el apartado «Uso de la web» del aviso legal.</p>'+
      '<h2>Producto Premium</h2><p>'+BRAND+' Premium es un contenido digital: un acceso de por vida, ligado a tu cuenta, a funciones adicionales de la web: navegación sin anuncios, tests más largos con tus apuntes y más preguntas con IA al día, simulacros a medida, repaso de fallos y preguntas marcadas, y estadísticas avanzadas, mientras la web siga en funcionamiento. El contenido de estudio gratuito seguirá siendo gratuito.</p>'+
      '<h2>Precio y pago</h2><p>'+PRICE+', IVA incluido, en un único pago a través de PayPal (con tu cuenta de PayPal o con tarjeta). No es una suscripción y no hay renovaciones ni otros cargos.</p>'+
      '<h2>Cómo se compra</h2><ol><li>Crea tu cuenta o inicia sesión.</li><li>En la página Premium, lee estas condiciones y marca la casilla de aceptación.</li><li>Pulsa el botón de PayPal y completa el pago en la ventana de PayPal. Hasta que confirmes el pago allí puedes cancelar o corregir cualquier dato sin coste.</li><li>Premium se activa al momento en tu cuenta.</li></ol>'+
      '<h2>Confirmación y justificante</h2><p>PayPal te envía por email el recibo del pago. Además, puedes descargar en cualquier momento, desde «Mi cuenta» o la página Premium, un justificante con los datos de la compra y el consentimiento que diste. Guardamos el registro electrónico de la compra durante el plazo legal.</p>'+
      '<h2>Desistimiento</h2><p>Al tratarse de contenido digital que se suministra de inmediato, para comprar debes dar tu consentimiento expreso y aceptar que pierdes el derecho de desistimiento, según el artículo 103.m del Real Decreto Legislativo 1/2007 (Ley General para la Defensa de los Consumidores y Usuarios).</p>'+
      '<h2>Garantía</h2><p>Tienes los derechos de garantía legal de conformidad de los contenidos digitales (arts. 114 y siguientes de esa ley). Si Premium no funciona por un problema técnico nuestro, escríbenos a '+esc(mail)+' y lo solucionaremos o, si no es posible, te devolveremos el importe.</p>'+
      '<h2>Cambios en el servicio y en estas condiciones</h2><p>Podemos mejorar o cambiar funciones de la web. Si en el futuro cambiamos estas condiciones, la versión aplicable a tu compra será la vigente en la fecha en que compraste.</p>'+
      '<h2>Ley aplicable y reclamaciones</h2><p>Se aplica la legislación española. Si eres consumidor, puedes reclamar ante los juzgados de tu domicilio y acudir a los servicios de consumo de tu comunidad autónoma o ayuntamiento. Antes, escríbenos a '+esc(mail)+': intentaremos resolverlo en un plazo máximo de un mes.</p>'+
      '<h2>Contacto</h2><p>'+esc(L.titular)+' · NIF '+esc(L.nif)+' · '+esc(L.domicilio)+' · '+esc(mail)+'.</p>']
  };
}
function viewLegal(key){
  const p = legalPages()[key];
  view().innerHTML = '<article class="wrap legal"><nav class="crumbs" aria-label="Ruta" style="padding-top:0"><a href="'+href("inicio")+'">Inicio</a> / '+esc(p[0])+'</nav><h1>'+esc(p[0])+'</h1>'+p[1]+'<p class="hint">Última actualización: 19 de octubre de 2026.</p></article>';
  document.title = p[0] + " · " + BRAND;
}

/* ============================================================
   ACCIONES (delegación de eventos)
   ============================================================ */
const ACT = {
  pick: b => pick(+b.dataset.k),
  next: () => next(),
  prev: () => { if (S && S.i > 0){ S.i--; renderQ(); } },
  blank: () => { S.picks[S.i] = null; if (S.i < S.qs.length-1){ S.i++; renderQ(); } else ask(); },
  goto: b => { S.i = +b.dataset.i; renderQ(); },
  ask: () => ask(),
  askNo: () => { $("#confirmBox").innerHTML = ""; },
  submit: () => finish(false),
  mark: b => { const q = S.qs[S.i]; const on = toggleMark(q.id); b.setAttribute("aria-pressed", on); b.textContent = on ? "★ Marcada" : "☆ Marcar"; toast(on ? "Pregunta marcada" : "Marca quitada"); },
  report: () => { const q = S.qs[S.i]; $("#repBox").innerHTML = '<div class="report">Referencia: <span class="mono">'+q.id+'</span>. '+(CONFIG.contactEmail ? 'Escríbenos a <b>'+esc(CONFIG.contactEmail)+'</b> con esta referencia y lo revisamos.' : 'Guárdala y envíanosla cuando habilitemos el contacto.')+' <button class="link-btn" data-act="copyRef">Copiar referencia</button></div>'; },
  copyRef: () => copyText(S.qs[S.i].id + " · " + S.qs[S.i].q),
  share: () => { const d = store.get("daily:"+todayKey(), null); if (d) shareDaily(d.score, d.sq); },
  shareDone: () => { const d = store.get("daily:"+todayKey(), null); if (d) shareDaily(d.score, d.sq); },
  dailyRedo: () => { const key = todayKey(); startQuiz({ mode:"daily", replay:true, title:"Test del día · " + fmtDate(key) + " (repaso)", qs: dailyQs(key), feedback:true, seed:key }); },
  again: () => { if (!S || !CUR) return; if (S.mode === "quick") startQuick(); else if (S.mode === "sim") startSim(); else catMenu(); },
  retryFails: () => { const qs = (S.failQs || []).filter(Boolean); const o = S; startQuiz({ cat: o.cat, pen: o.pen, nOpts: o.nOpts, userTest: o.userTest, mode:"failed", title:"Repaso de fallos", qs: shuffle(qs), feedback:true }); },
  userAgain: () => { if (window.SLP_ESC && S && S.userTest) window.SLP_ESC.again(S.userTest); },
  userBack: () => { if (window.SLP_ESC) window.SLP_ESC.render($("#subirRoot")); },
  menu: () => catMenu(),
  quick: () => startQuick(),
  sim: () => startSim(),
  custom: () => startCustomForm(),
  failed: () => { const qs = failedFor(CUR); if (!qs.length){ toast("No tienes fallos pendientes en esta oposición"); return; } startQuiz({ ...baseOpts(CUR), mode:"failed", title:"Repaso de fallos · " + CUR.short, qs: shuffle(qs), feedback:true }); },
  marked: () => { const qs = markedFor(CUR); if (!qs.length){ toast("Todavía no has marcado preguntas"); return; } startQuiz({ ...baseOpts(CUR), mode:"marked", title:"Preguntas marcadas · " + CUR.short, qs: shuffle(qs), feedback:true }); },
  group: b => startGroup(b.dataset.g),
  groupCE: () => startQuiz({ ...baseOpts(CUR), mode:"group", title:"Constitución completa", qs: shuffle(QBY.ce), feedback:true }),
  groupAll: () => startQuiz({ ...baseOpts(CUR), mode:"group", title:"Todo mezclado · " + CUR.short, qs: shuffle(poolFor(CUR, withCEpref())), feedback:true }),
  toggleChip: b => b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"),
  toPremium: () => { location.hash = "premium"; },
  cookiePrefs: () => {
    if (isPremium()){ toast("Con Premium no se cargan anuncios ni cookies publicitarias."); return; }
    if (!CONFIG.adsenseClient){ toast("Ahora mismo la web no usa cookies publicitarias."); return; }
    window.googlefc = window.googlefc || {}; window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
    window.googlefc.callbackQueue.push(() => { try { window.googlefc.showRevocationMessage(); } catch(e){ toast("No se ha podido abrir el panel. Desactiva el bloqueador de anuncios e inténtalo de nuevo."); } });
    initAds();
    setTimeout(() => { if (!window.googlefc || typeof window.googlefc.showRevocationMessage !== "function") toast("No se ha podido abrir el panel. Desactiva el bloqueador de anuncios e inténtalo de nuevo."); }, 4000);
  },
  toRegister: b => { authTab = "register"; if (b && b.dataset.next) store.set("next", b.dataset.next); if (currentRoute() === "cuenta") render(); else location.hash = "cuenta"; },
  toLogin: b => { authTab = "login"; if (b && b.dataset.next) store.set("next", b.dataset.next); if (currentRoute() === "cuenta") render(); else location.hash = "cuenta"; },
  tab: b => { authTab = b.dataset.t; viewCuenta(); },
  copyRec: () => copyText(($("#recCode") || {}).textContent || "", "#recOut"),
  recDone: () => { window.__slpRec = null; const t = window.__slpRecThen; window.__slpRecThen = null; if (t) t(); else viewCuenta(); },
  newRec: async () => {
    const pw = $("#pwOld").value, m = $("#pwMsg");
    if (!pw){ m.textContent = "Escribe tu contraseña actual en el primer campo para crear un nuevo código."; m.className = "msg err"; m.hidden = false; $("#pwOld").focus(); return; }
    try { const d = await api("/cuenta/codigo", { method:"POST", data:{ password: pw } }); window.__slpRec = d.recovery; viewCuenta(); window.scrollTo(0,0); }
    catch(e){ m.textContent = e.message; m.className = "msg err"; m.hidden = false; }
  },
  saveOpo: async () => { try { const d = await api("/cuenta/perfil", { method:"POST", data:{ oposicion: $("#pfOpo").value || null } }); setMe(d.user); toast("Oposición guardada"); viewCuenta(); } catch(e){ toast(e.message); } },
  logout: () => logout(),
  logoutAll: async () => { try { await api("/cuenta/cerrar-sesiones", { method:"POST", data:{} }); toast("Sesión cerrada en tus otros dispositivos"); } catch(e){ toast(e.message); } },
  receipt: async () => {
    try {
      const d = await api("/cuenta/compras");
      if (!d.compras || !d.compras.length){ toast("No hay pagos registrados en tu cuenta. Si te activamos Premium a mano, escríbenos y te enviamos el justificante."); return; }
      const L = CONFIG.legal, c = d.compras[d.compras.length - 1];
      const fecha = new Date(c.created_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "long", timeStyle: "short" });
      const imp = String(c.amount || "").replace(".", ",") + " €";
      const base = (parseFloat(c.amount) / 1.21).toFixed(2).replace(".", ","), iva = (parseFloat(c.amount) - parseFloat(c.amount) / 1.21).toFixed(2).replace(".", ",");
      const row = (k, v) => '<tr><th>' + esc(k) + '</th><td>' + esc(v) + '</td></tr>';
      const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Justificante de compra · ' + esc(BRAND) + '</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#142033;max-width:640px;margin:32px auto;padding:0 16px}h1{font-size:1.4rem}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{text-align:left;padding:8px;border-bottom:1px solid #ddd;vertical-align:top}th{width:38%;color:#556174;font-weight:600}.n{font-size:.85rem;color:#556174}</style></head><body>' +
        '<h1>Justificante de compra · ' + esc(BRAND) + ' Premium</h1><table>' +
        row("Vendedor", L.titular + " · NIF " + L.nif) + row("Domicilio", L.domicilio) + row("Contacto", L.email) +
        row("Cliente (cuenta)", ME.email) + row("Producto", BRAND + " Premium: acceso de por vida, ligado a la cuenta (contenido digital)") +
        row("Fecha de la compra", fecha) + row("Pedido de PayPal", c.order_id) + row("Importe total (IVA incluido)", imp) + row("Desglose orientativo", "Base " + base + " € + IVA 21 % " + iva + " €") +
        row("Forma de pago", "PayPal") + row("Entrega", "Activación inmediata en la cuenta") +
        row("Consentimiento expreso", c.consentimiento || "Aceptado en la página de compra antes del pago.") + '</table>' +
        '<p class="n">Este documento confirma la compra y el consentimiento prestado para la ejecución inmediata del contrato, con la pérdida del derecho de desistimiento (art. 103.m del Real Decreto Legislativo 1/2007). No es una factura; si necesitas factura, escribe a ' + esc(L.email) + '. Las condiciones de compra están en ' + esc(location.origin) + '/#condiciones.</p></body></html>';
      const blob = new Blob([html], { type: "text/html" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "justificante-sacalaplaza-" + c.order_id + ".html"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch(e){ toast(e.message); }
  },
  exportData: async () => {
    try {
      const d = await api("/cuenta/datos");
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "sacalaplaza-mis-datos.json"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } catch(e){ toast(e.message); }
  },
  demoPay: async () => {
    if (!$("#consent").checked){ buyMsg("Marca la casilla de aceptación para continuar.", "err"); return; }
    try { const d = await api("/paypal/demo", { method:"POST", data:{} }); premiumActivated(d.user); } catch(e){ buyMsg(esc(e.message), "err"); }
  },
  calcFor: b => { calcCat = b.dataset.c; },
  resetAsk: () => { $("#resetBox").innerHTML = '<div class="confirm"><span>Se borrarán tus respuestas, rachas, marcadas e historial'+(ME ? " de este navegador y de tu cuenta" : " de este navegador")+'. Tu Premium y tus tests de apuntes se mantienen.</span><div class="grp"><button class="btn ghost small" data-act="resetNo">Cancelar</button><button class="btn small" data-act="resetYes">Borrar progreso</button></div></div>'; },
  resetNo: () => { $("#resetBox").innerHTML = ""; },
  resetYes: () => { syncMuted = true; ["qs","mk","hist","days","best"].forEach(k => store.del(k)); store.keys("daily:").forEach(k => store.del(k)); syncMuted = false; if (ME) pushProgress().catch(()=>{}); refreshHeader(); viewProgress(); toast("Progreso borrado"); }
};
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const fn = ACT[b.dataset.act]; if (!fn) return;
  if (b.dataset.act === "calcFor"){ fn(b, e); return; }
  e.preventDefault(); fn(b, e);
});
document.addEventListener("change", e => { if (e.target && e.target.id === "withCE"){ store.set("withCE", e.target.checked); catMenu(); } });
document.addEventListener("keydown", e => {
  if (!S || S.done || e.metaKey || e.ctrlKey || e.altKey || !$("#sBody")) return;
  const tag = (e.target.tagName || "").toLowerCase(); if (tag === "input" || tag === "textarea" || tag === "select") return;
  const k = e.key.toLowerCase();
  const idx = "1234".indexOf(k) >= 0 ? "1234".indexOf(k) : "abcd".indexOf(k);
  if (idx >= 0 && k.length === 1){ e.preventDefault(); pick(idx); }
  else if (k === "enter"){ const nb = $("#nextBtn"); if (nb && !nb.hidden && document.activeElement !== nb){ e.preventDefault(); next(); } }
  else if (k === "m"){ const mb = $(".mark-btn"); if (mb) mb.click(); }
});

/* ============================================================
   PUENTE PARA EL ESCÁNER DE APUNTES
   ============================================================ */
window.SLP = {
  api, store, toast, esc, href, CATS, catById, BRAND,
  me: () => ME, isPremium, requireLogin, sheetHTML,
  startQuiz: o => startQuiz(o), stopTimer, shuffle, fmtDay, penText, LET,
  quizActive: () => !!(S && !S.done)
};

/* ============================================================
   ARRANQUE
   ============================================================ */
function render(){
  stopTimer(); S = null; CUR = null;
  const r = currentRoute();
  const legal = legalPages();
  if (r === "inicio" || r === "oposiciones" || r === "calendario"){ document.title = BRAND + " · Tests gratis para oposiciones"; viewHome(r); }
  else if (r.indexOf("op-") === 0) viewCat(r.slice(3));
  else if (r === "premium") viewPremium();
  else if (r === "progreso") viewProgress();
  else if (r === "cuenta") viewCuenta();
  else if (r === "calculadora") viewCalc();
  else if (r === "subir") viewSubir();
  else if (legal[r]) viewLegal(r);
  else viewHome("inicio");
  renderNav(r);
  if (r !== "oposiciones" && r !== "calendario") window.scrollTo(0, 0);
  initAds();
}
window.addEventListener("hashchange", render);
applyTheme(store.get("theme", "auto"));
refreshHeader(); renderNotice(); renderFooter(); render();
loadMe();
})();
