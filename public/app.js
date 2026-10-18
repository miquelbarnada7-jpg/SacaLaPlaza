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
const pct = (c,n) => n ? Math.round(c/n*100) : 0;
function rng(seed){ let h = 2166136261; for (const ch of seed){ h ^= ch.charCodeAt(0); h = Math.imul(h,16777619); } return function(){ h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ t>>>15, t|1); t ^= t + Math.imul(t ^ t>>>7, t|61); return ((t ^ t>>>14)>>>0)/4294967296; }; }
function shuffle(arr, r = Math.random){ const a = arr.slice(); for (let i=a.length-1;i>0;i--){ const j = Math.floor(r()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; } return a; }
const store = {
  get(k,d){ try { const v = localStorage.getItem("tc2:"+k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k,v){ try { localStorage.setItem("tc2:"+k, JSON.stringify(v)); } catch(e){} },
  del(k){ try { localStorage.removeItem("tc2:"+k); } catch(e){} }
};
function toast(msg){ const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(()=>t.classList.remove("show"), 2600); }
function copyText(text, outSel){
  const out = outSel ? $(outSel) : null;
  const fallback = () => { if (!out) return; out.innerHTML = '<textarea class="copy-box" rows="3" readonly aria-label="Texto para copiar">'+esc(text)+'</textarea><p class="hint">Selecciona el texto y cópialo.</p>'; const ta = out.querySelector("textarea"); ta.focus(); ta.select(); };
  try { navigator.clipboard.writeText(text).then(()=>{ toast("Copiado"); if (out) out.innerHTML = ""; }, fallback); } catch(e){ fallback(); }
}
const PRICE = CONFIG.price + " €";

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

/* ============================================================
   PREMIUM
   ============================================================ */
function license(){ return store.get("lic", null); }
function isPremium(){
  const l = license(); if (!l) return false;
  if (l.indexOf("DEMO-") === 0) return !!CONFIG.demo;
  return l.indexOf("TC1.") === 0;
}
function activate(code, fromPayment){
  store.set("lic", code);
  toast(fromPayment ? "Pago completado. Premium activado para siempre." : "Premium activado");
  if (adsLoaded){ setTimeout(()=>location.reload(), 1200); return; }
  refreshHeader(); render();
}
async function verifyRemote(code){
  const r = await fetch(CONFIG.api + "/license/verify", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ license: code }) });
  if (!r.ok) throw new Error("verify");
  const d = await r.json(); return !!d.valid;
}
function backgroundVerify(){
  const l = license();
  if (!l || l.indexOf("TC1.") !== 0 || !CONFIG.paypalClientId) return;
  verifyRemote(l).then(valid => { if (!valid){ store.del("lic"); refreshHeader(); render(); toast("Tu código Premium no es válido"); } }).catch(()=>{});
}
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
      createOrder: () => fetch(CONFIG.api + "/paypal/create-order", { method:"POST" }).then(r => r.json()).then(d => { if (!d.id) throw new Error(d.error || "pedido"); return d.id; }),
      onApprove: data => fetch(CONFIG.api + "/paypal/capture-order", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ orderID: data.orderID }) })
        .then(r => r.json()).then(d => { if (!d.license) throw new Error(d.error || "captura"); activate(d.license, true); }),
      onError: () => buyMsg("No se ha podido completar el pago. Si PayPal te ha cobrado y no ves tu código, escríbenos" + (CONFIG.contactEmail ? " a <b>"+esc(CONFIG.contactEmail)+"</b>" : "") + " con el justificante y te lo enviamos.", "err")
    }).render("#paypalBox");
  }).catch(() => { box.innerHTML = '<p class="msg err">No se ha podido cargar PayPal. Revisa tu conexión o desactiva el bloqueador de anuncios para esta página.</p>'; });
}

/* ============================================================
   ANUNCIOS
   ============================================================ */
let adsLoaded = false;
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
  const best = Math.max(store.get("best", 0), cur); store.set("best", best);
  return { cur, best };
}
const withCEpref = () => store.get("withCE", true);

/* ============================================================
   RUTAS
   ============================================================ */
function href(route){
  if (CONFIG.pathRoutes){
    if (route === "inicio") return "/";
    if (route.indexOf("op-") === 0){ const c = catById[route.slice(3)]; return c ? "/oposiciones/" + c.slug + "/" : "/"; }
    if (route === "oposiciones" || route === "calendario") return "/#" + route;
  }
  return "#" + route;
}
function currentRoute(){ const h = location.hash.replace(/^#/, ""); return h || window.TC_INITIAL_ROUTE || "inicio"; }

/* ============================================================
   CABECERA, TEMA Y AVISO
   ============================================================ */
const NAV = [["inicio","Inicio"],["oposiciones","Oposiciones"],["calendario","Calendario"],["progreso","Mi progreso"]];
function renderNav(route){
  $("#nav").innerHTML = NAV.map(([r,t]) => '<a href="'+href(r)+'"'+(route===r || (r==="oposiciones" && route.indexOf("op-")===0) ? ' aria-current="page"' : "")+'>'+t+'</a>').join("");
  $(".brand").setAttribute("href", href("inicio"));
}
function refreshHeader(){
  $("#streakVal").textContent = streakInfo().cur;
  const pl = $("#premLink");
  if (isPremium()){ pl.textContent = "Premium ✓"; pl.classList.add("on"); } else { pl.textContent = "Premium " + PRICE; pl.classList.remove("on"); }
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
  const m = $("#sMeta"); m.textContent = "⏱ " + pad(Math.floor(left/60)) + ":" + pad(left%60); m.classList.toggle("warn", left <= 60);
  if (left <= 0) finish(true);
}
function renderQ(){
  const q = S.qs[S.i]; S.locked = false;
  setProg(S.i / S.qs.length);
  if (!S.timeLimit) $("#sMeta").textContent = (S.i+1) + " / " + S.qs.length;
  const pick = S.picks[S.i], mk = isMarked(q.id), last = S.i === S.qs.length-1;
  let h = '<div class="qnum"><div class="left"><span class="label">Pregunta '+(S.i+1)+' de '+S.qs.length+'</span><span class="label">· '+esc(catById[q.c].short)+'</span></div><button class="mark-btn" data-act="mark" aria-pressed="'+mk+'" title="Marcar para repasar (tecla M)">'+(mk ? "★ Marcada" : "☆ Marcar")+'</button></div>';
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
  S.locked = true; const ok = k === q.ans; record(q, ok);
  $$(".opt").forEach(b => { const kk = +b.dataset.k; b.disabled = true; if (kk === q.ans) b.classList.add("ok"); else if (kk === k) b.classList.add("bad"); });
  $("#fb").innerHTML = '<div class="explain'+(ok ? "" : " wrong")+'"><b>'+(ok ? "Correcto." : "Incorrecto. La respuesta es la "+LET[q.ans]+".")+'</b><span class="art">'+esc(q.r)+'</span> '+esc(q.e)+'</div><p style="margin-top:10px"><button class="link-btn" data-act="report">¿Ves un error en esta pregunta?</button></p><div id="repBox"></div>';
  $("#hintTxt").innerHTML = (ok ? "Bien visto" : "Márcala con ☆ para repasarla") + ' · <span class="kbd">Intro</span> para seguir';
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
  if (!S.feedback) S.qs.forEach((q,i) => { if (res[i] !== 0) record(q, res[i] === 1); });
  const net = Math.max(0, ok - bad*S.pen), nota = net / S.qs.length * 10;
  const sq = res.map(x => x === 1 ? "🟩" : x === -1 ? "🟥" : "⬜").join("");
  if (S.mode === "daily" && !S.replay){
    const key = todayKey();
    if (!store.get("daily:"+key, null)){
      store.set("daily:"+key, { score: ok, sq });
      const days = store.get("days", []); if (days.indexOf(key) < 0){ days.push(key); store.set("days", days.slice(-400)); }
    }
  }
  if (S.mode !== "daily"){
    const h = store.get("hist", []); h.push({ t: Date.now(), cat: S.cat || null, mode: S.mode, n: S.qs.length, ok, bad, bl, nota: +nota.toFixed(2) }); store.set("hist", h.slice(-60));
  }
  refreshHeader();
  const byG = {};
  S.qs.forEach((q,i) => { const g = q.g; byG[g] = byG[g] || { n:0, ok:0 }; byG[g].n++; if (res[i] === 1) byG[g].ok++; });
  const groups = Object.entries(byG).filter(([,v]) => v.n >= 2).sort((a,b) => a[1].ok/a[1].n - b[1].ok/b[1].n).slice(0,5);
  const fails = S.qs.map((q,i) => ({ q, r: res[i] })).filter(x => x.r !== 1);
  S.failIds = fails.map(f => f.q.id);
  $("#sMeta").textContent = timeout ? "Tiempo agotado" : "Resultado"; $("#sMeta").classList.remove("warn");
  const prem = isPremium();
  const penTxt = S.pen === 0 ? "Sin penalización por errores." : "Cada error resta " + (S.pen === 1/2 ? "1/2" : S.pen === 1/4 ? "1/4" : "1/3") + " de acierto; las preguntas en blanco no restan.";
  let h = '<div class="score"><span class="big mono">'+ok+'<span class="of">/'+S.qs.length+'</span></span><span><span class="label">Nota con penalización</span><br><strong class="mono" style="font-size:1.35rem">'+fmtNum(nota)+'</strong> sobre 10</span></div>';
  if (S.mode === "daily" || S.qs.length <= 30) h += '<p class="squares" aria-label="Resumen de aciertos y fallos">'+sq+'</p>';
  h += '<div class="grid4"><div><span class="label">Aciertos</span><span class="v">'+ok+'</span></div><div><span class="label">Fallos</span><span class="v">'+bad+'</span></div><div><span class="label">En blanco</span><span class="v">'+bl+'</span></div><div><span class="label">Netas</span><span class="v">'+fmtNum(net)+'</span></div></div>';
  h += '<p class="hint">'+penTxt+(timeout ? " Se acabó el tiempo y se ha entregado automáticamente." : "")+'</p>';
  h += '<div class="actions" style="justify-content:flex-start"><div class="grp">';
  if (S.mode === "daily") h += '<button class="btn" data-act="share">Copiar resultado para compartir</button><a class="btn ghost" href="'+href("oposiciones")+'">Practicar mi oposición</a>';
  else {
    h += '<button class="btn" data-act="again">Repetir con otras preguntas</button>';
    if (fails.length) h += prem ? '<button class="btn ghost" data-act="retryFails">Repasar estos '+fails.length+' fallos</button>' : '<a class="btn ghost" href="'+href("premium")+'">Repasar fallos <span class="lock">Premium</span></a>';
    if (S.cat) h += '<button class="btn ghost" data-act="menu">Volver al menú</button>';
  }
  h += '</div></div><div id="shareOut"></div>';
  if (S.mode === "daily") h += '<p class="hint" style="margin-top:12px">Nuevo test del día en <span class="mono" id="cd">--:--:--</span></p>';
  if (groups.length > 1){
    h += '<div style="margin-top:22px"><p class="label">Por bloque</p><div class="bars">' + groups.map(([g,v]) => { const p = pct(v.ok, v.n); return '<div class="bar-row"><span>'+esc(g)+'</span><span class="mono" style="text-align:right">'+v.ok+'/'+v.n+'</span><span class="track"><i class="'+(p<50 ? "low" : p<75 ? "mid" : "hi")+'" style="width:'+p+'%"></i></span></div>'; }).join("") + '</div></div>';
  }
  if (fails.length) h += '<div class="review"><p class="label">Repasa '+(fails.length === 1 ? "esta pregunta" : "estas "+fails.length+" preguntas")+'</p>' + fails.map(f => '<div class="item"><strong>'+esc(f.q.q)+'</strong><span>Respuesta correcta: <b>'+esc(f.q.o[0])+'</b>'+(f.r === 0 ? ' <span class="hint">(en blanco)</span>' : "")+'</span><span><span class="art">'+esc(f.q.r)+'</span> '+esc(f.q.e)+'</span></div>').join("") + '</div>';
  else h += '<p style="margin-top:14px"><strong>Pleno.</strong> Ni un fallo.</p>';
  body().innerHTML = h;
  if (S.mode === "daily") startCountdown();
  scrollSheet();
}
function startCountdown(){
  clearInterval(cdTimer);
  const upd = () => { const el = $("#cd"); if (!el){ clearInterval(cdTimer); return; } const n = new Date(); const t = new Date(n.getFullYear(), n.getMonth(), n.getDate()+1) - n; const s = Math.floor(t/1000); el.textContent = pad(Math.floor(s/3600)) + ":" + pad(Math.floor(s%3600/60)) + ":" + pad(s%60); };
  upd(); cdTimer = setInterval(upd, 1000);
}
function shareDaily(score, sq){
  const text = "Tema Común · Test del día " + fmtDate(todayKey()) + "\n" + score + "/10 " + sq + (CONFIG.siteUrl ? "\n" + CONFIG.siteUrl : "\n¿Cuántas sacas tú?");
  copyText(text, "#shareOut");
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
    body().innerHTML = '<p class="label">Ya has hecho el test de hoy</p><div class="score" style="margin:8px 0"><span class="big mono">'+done.score+'<span class="of">/10</span></span></div><p class="squares">'+done.sq+'</p><p class="hint" style="margin-top:10px">Nuevo test en <span class="mono" id="cd">--:--:--</span>. Puedes repetirlo sin que cambie tu resultado.</p><div class="actions" style="justify-content:flex-start"><div class="grp"><button class="btn" data-act="shareDone">Copiar resultado</button><button class="btn ghost" data-act="dailyRedo">Repetir</button><a class="btn ghost" href="'+href("oposiciones")+'">Elegir oposición</a></div></div><div id="shareOut"></div>';
    startCountdown(); return;
  }
  startQuiz({ mode:"daily", title:"Test del día · " + fmtDate(key), qs, feedback:true, seed:key });
}

/* ---------- Menú de una oposición ---------- */
let CUR = null; // categoría abierta
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
  return '<section class="band"><div class="wrap"><div><p class="label">Tema Común Premium</p><h2>Estudia sin anuncios por '+PRICE+'. <span class="hl">Una sola vez.</span></h2><ul class="ticks"><li>Sin anuncios en toda la web</li><li>Simulacros a medida de hasta 100 preguntas</li><li>Repaso inteligente de tus fallos y preguntas marcadas</li><li>Estadísticas por bloque e historial de notas</li></ul></div><div class="price-card"><span class="price">'+PRICE+' <small>pago único</small></span><p class="hint">Sin suscripción ni renovaciones. Pagas una vez y es tuyo para siempre.</p><a class="btn gold" href="'+href("premium")+'">Ver Premium</a></div></div></section>';
}
function viewHome(route){
  const t = totals();
  view().innerHTML =
    '<div class="wrap hero"><section><p class="label">Gratis · sin registro · '+TOTAL+' preguntas</p><h1>Prepara tu oposición con <span class="hl">diez preguntas al día</span></h1><p class="lead">Tests de Constitución, Administración, Justicia, Hacienda, Prisiones, Policía, Guardia Civil, Bomberos, Sanidad y Docentes. Cada respuesta trae el artículo exacto y una explicación.</p>'+
    '<div class="facts"><div><span class="label">Preguntas</span><span class="v">'+TOTAL+'</span></div><div><span class="label">Oposiciones</span><span class="v">'+NCATS+'</span></div><div><span class="label">Tu acierto</span><span class="v">'+(t.n ? pct(t.c,t.n)+" %" : "—")+'</span></div></div>'+
    '<div class="quick" aria-label="Ir a una oposición">' + CATS.map(c => '<a class="chip" href="'+href("op-"+c.id)+'">'+esc(c.short)+'</a>').join("") + '</div></section>'+
    sheetHTML("Test del día", "") + '</div>' +
    adHTML("top") +
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
      '<section class="src"><h2>Fuentes</h2><ul>'+c.fuentes.map(f => '<li><a href="'+esc(f.u)+'" target="_blank" rel="noopener">'+esc(f.t)+'</a></li>').join("")+'</ul></section>'+
    '</div>' + sheetHTML("Practicar · " + c.short, "") + '</div></div>' +
    adHTML("middle") +
    '<section class="wrap section"><div class="section-head"><h2>Otras oposiciones</h2></div><div class="quick">' + CATS.filter(x => x.id !== c.id).map(x => '<a class="chip" href="'+href("op-"+x.id)+'">'+esc(x.short)+'</a>').join("") + '</div></section>';
  document.title = c.seoTitle;
  catMenu();
}
function viewPremium(){
  const prem = isPremium(), lic = license();
  const rows = [["Test del día y racha", 1, 1], ["Práctica por oposición y por bloques con explicación", 1, 1], ["Simulacro corto con penalización real", 1, 1], ["Sin anuncios", 0, 1], ["Simulacros a medida de hasta 100 preguntas", 0, 1], ["Repaso inteligente de fallos", 0, 1], ["Practicar tus preguntas marcadas", 0, 1], ["Estadísticas por bloque e historial de notas", 0, 1]];
  let buy;
  if (prem){
    buy = '<div class="buy"><p class="msg ok"><b>Ya tienes Premium.</b> Gracias por apoyar Tema Común.</p><div class="stack"><span class="label">Tu código de activación</span><div class="code" id="myCode">'+esc(lic)+'</div><div class="grp" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" data-act="copyCode">Copiar código</button></div><p class="hint">Guárdalo. Con él activas Premium en otro móvil u ordenador, o si borras los datos del navegador.</p><div id="codeOut"></div></div></div>';
  } else {
    buy = '<div class="buy"><span class="price">'+PRICE+' <small>pago único · IVA incluido</small></span><p class="hint">Sin suscripción. No se renueva nunca.</p>'+
      '<label class="check"><input type="checkbox" id="consent"><span>Acepto las <a href="'+href("condiciones")+'">condiciones de compra</a> y que Premium se active al momento, por lo que pierdo el derecho de desistimiento (art. 103.m de la Ley de Consumidores).</span></label>';
    if (CONFIG.paypalClientId) buy += '<div id="paypalBox"></div><p class="hint">Puedes pagar con tu cuenta de PayPal o con tarjeta, sin crear cuenta.</p>';
    else if (CONFIG.demo) buy += '<p class="msg">Vista previa: el pago con PayPal se conecta al publicar la web. Aquí puedes probar Premium gratis.</p><button class="btn gold" data-act="demo">Activar Premium de prueba</button>';
    else buy += '<p class="msg">Los pagos estarán disponibles muy pronto.</p>';
    if (CONFIG.manualPayment) buy += '<div class="msg"><b>¿Prefieres otro método?</b><br>'+esc(CONFIG.manualPayment)+'</div>';
    buy += '<p class="msg" id="buyMsg" hidden></p></div>';
  }
  view().innerHTML = '<div class="wrap prem-hero"><section class="stack"><p class="label">Tema Común Premium</p><h1>Todo Tema Común, sin anuncios, por <span class="hl">'+PRICE+' para siempre</span></h1><p class="cat-lead">Las preguntas, explicaciones y el test del día seguirán siendo gratis. Premium quita los anuncios y añade herramientas para estudiar mejor.</p>'+
    '<div style="overflow-x:auto"><table class="compare"><thead><tr><th>Función</th><th>Gratis</th><th>Premium</th></tr></thead><tbody>'+rows.map(r => '<tr><td>'+r[0]+'</td><td class="'+(r[1] ? "yes" : "no")+'">'+(r[1] ? "✓" : "—")+'</td><td class="yes">✓</td></tr>').join("")+'</tbody></table></div></section>'+
    '<aside class="stack">'+buy+
      (prem ? "" : '<form class="buy" id="restoreForm" novalidate><span class="label">¿Ya lo compraste?</span><label class="field"><span class="hint">Introduce tu código de activación</span><input type="text" id="restoreCode" autocomplete="off" spellcheck="false" placeholder="TC1.…"></label><button class="btn ghost" type="submit">Activar con mi código</button><p class="msg" id="restoreMsg" hidden></p></form>')+
    '</aside></div>'+
    '<section class="wrap section"><div class="section-head"><h2>Preguntas frecuentes</h2></div><div class="faq">'+
      '<details><summary>¿Es una suscripción?</summary><p>No. Pagas '+PRICE+' una vez y Premium es tuyo para siempre. No hay renovaciones ni cobros futuros.</p></details>'+
      '<details><summary>¿Cómo pago?</summary><p>Con PayPal o con tarjeta de débito o crédito a través de PayPal, sin necesidad de crear una cuenta. Nosotros nunca vemos los datos de tu tarjeta.</p></details>'+
      '<details><summary>¿Y si cambio de móvil o borro el navegador?</summary><p>Al pagar recibes un código de activación. Introdúcelo en esta página en cualquier dispositivo y Premium se activa al instante. Guárdalo en un lugar seguro.</p></details>'+
      '<details><summary>¿Qué pasa con mis estadísticas?</summary><p>Tu progreso se guarda en tu navegador, no en nuestros servidores. Si cambias de dispositivo, el progreso empieza de cero, pero Premium sigue activo con tu código.</p></details>'+
      '<details><summary>¿Las preguntas seguirán siendo gratis?</summary><p>Sí. Todo el contenido de estudio es gratis. Premium quita los anuncios y añade herramientas de repaso y simulacros.</p></details>'+
    '</div></section>';
  document.title = "Premium · Tema Común";
  if (!prem && CONFIG.paypalClientId) renderPayPal();
  const rf = $("#restoreForm");
  if (rf) rf.addEventListener("submit", async e => {
    e.preventDefault();
    const code = $("#restoreCode").value.trim(), m = $("#restoreMsg");
    const say = (t, k) => { m.textContent = t; m.className = "msg " + (k || ""); m.hidden = false; };
    if (!code){ say("Escribe tu código.", "err"); return; }
    if (code.indexOf("DEMO-") === 0){ if (CONFIG.demo){ activate(code); } else say("Ese código es de prueba y no sirve en la web publicada.", "err"); return; }
    if (code.indexOf("TC1.") !== 0){ say("El código no tiene el formato correcto. Empieza por TC1.", "err"); return; }
    if (!CONFIG.paypalClientId){ say("La activación con código estará disponible cuando se publique la web.", "err"); return; }
    say("Comprobando…");
    try { const ok = await verifyRemote(code); if (ok) activate(code); else say("Ese código no es válido. Revisa que lo hayas copiado entero.", "err"); }
    catch(err){ say("No hemos podido comprobar el código. Inténtalo de nuevo en unos minutos.", "err"); }
  });
}
function histChart(hist){
  const H = hist.slice(-20); const W = 600, Hh = 190, padL = 30, padB = 22, padT = 10;
  const bw = (W - padL - 10) / 20;
  const y = v => padT + (Hh - padT - padB) * (1 - v/10);
  let s = '<svg viewBox="0 0 '+W+' '+Hh+'" role="img" aria-label="Notas de tus últimos simulacros">';
  [0,5,10].forEach(v => { s += '<line x1="'+padL+'" x2="'+(W-6)+'" y1="'+y(v)+'" y2="'+y(v)+'" style="stroke:var(--line);stroke-width:1'+(v === 5 ? ';stroke-dasharray:4 4' : "")+'"/><text x="'+(padL-8)+'" y="'+(y(v)+4)+'" text-anchor="end" style="fill:var(--muted);font:11px var(--f-mono)">'+v+'</text>'; });
  H.forEach((h,i) => { const x = padL + i*bw + bw*0.18, w = bw*0.64; const yy = y(h.nota); s += '<rect x="'+x.toFixed(1)+'" y="'+yy.toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+Math.max(1, y(0)-yy).toFixed(1)+'" rx="2" style="fill:'+(h.nota >= 5 ? "var(--ok)" : "var(--bad)")+'"><title>'+fmtNum(h.nota)+' · '+esc((catById[h.cat] || {}).short || "Test")+'</title></rect>'; });
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
  view().innerHTML = '<div class="wrap section"><div class="section-head"><div><p class="label">Guardado en este navegador</p><h2>Mi progreso</h2></div></div><div class="prog-grid">'+
    '<div class="panel"><h3>Resumen</h3><div class="grid4" style="margin:0"><div><span class="label">Respondidas</span><span class="v">'+t.n+'</span></div><div><span class="label">Acierto</span><span class="v">'+(t.n ? pct(t.c,t.n)+" %" : "—")+'</span></div><div><span class="label">Racha</span><span class="v">'+st.cur+'</span></div><div><span class="label">Mejor racha</span><span class="v">'+st.best+'</span></div></div><p class="hint">'+hist.length+(hist.length === 1 ? ' test completado' : ' tests completados')+' · '+nFail+' en repaso · '+marked().length+(marked().length === 1 ? ' marcada' : ' marcadas')+'</p></div>'+
    '<div class="panel"><h3>Acierto por oposición</h3>'+(byCat.length ? barRows(byCat) : '<p class="hint">Aún no has respondido preguntas. Empieza por el <a href="'+href("inicio")+'">test del día</a>.</p>')+'</div>'+
    '<div class="panel'+(prem ? "" : " locked-panel")+'"><h3>Historial de notas</h3><div class="chart">'+(hist.length ? histChart(hist) : '<p class="hint">Haz un simulacro para ver aquí tu evolución.</p>')+'</div>'+veil+'</div>'+
    '<div class="panel'+(prem ? "" : " locked-panel")+'"><h3>Tus bloques más flojos</h3>'+(weak.length ? barRows(weak) : '<p class="hint">Responde al menos 3 preguntas de un bloque para verlo aquí.</p>')+veil+'</div>'+
    '</div><div class="actions" style="justify-content:flex-start;margin-top:22px"><button class="btn ghost small" data-act="resetAsk">Borrar mi progreso</button></div><div id="resetBox"></div></div>';
  document.title = "Mi progreso · Tema Común";
}

/* ---------- Páginas legales ---------- */
function legalPages(){
  const L = CONFIG.legal, site = CONFIG.siteUrl || "este sitio web", mail = L.email;
  return {
    "aviso-legal": ["Aviso legal",
      '<p>En cumplimiento del artículo 10 de la Ley 34/2002, de servicios de la sociedad de la información y de comercio electrónico (LSSI), se informa de los datos del titular de '+esc(site)+':</p><ul><li>Titular: '+esc(L.titular)+'</li><li>NIF: '+esc(L.nif)+'</li><li>Domicilio: '+esc(L.domicilio)+'</li><li>Email: '+esc(mail)+'</li></ul>'+
      '<h2>Objeto</h2><p>Tema Común ofrece tests de práctica para la preparación de oposiciones. Es un proyecto independiente y no tiene relación con ninguna Administración pública ni con los tribunales de selección.</p>'+
      '<h2>Responsabilidad</h2><p>Las preguntas se elaboran con cuidado a partir de los textos legales, pero pueden contener errores o quedar desactualizadas por reformas posteriores. Los datos sobre convocatorias son orientativos: la información oficial es la publicada en el BOE y en los boletines autonómicos. El titular no se responsabiliza de las decisiones tomadas a partir de estos contenidos.</p>'+
      '<h2>Propiedad intelectual</h2><p>Los textos, preguntas, explicaciones y el diseño de la web pertenecen a su titular. Los textos legales citados son de dominio público.</p>'+
      '<h2>Legislación aplicable</h2><p>Estas condiciones se rigen por la legislación española.</p>'],
    "privacidad": ["Política de privacidad",
      '<h2>Responsable</h2><p>'+esc(L.titular)+' ('+esc(L.nif)+'), contacto: '+esc(mail)+'.</p>'+
      '<h2>Qué datos tratamos</h2><ul><li><b>Tu progreso de estudio</b> (respuestas, rachas, preguntas marcadas y tu código Premium) se guarda solo en el almacenamiento local de tu navegador. No se envía a nuestros servidores.</li><li><b>Compra de Premium</b>: el pago lo gestiona PayPal, que actúa como responsable independiente de tus datos de pago. Nosotros solo recibimos el identificador del pedido para generar tu código de activación. No vemos ni guardamos los datos de tu tarjeta.</li><li><b>Contacto</b>: si nos escribes, usaremos tu email solo para responderte.</li><li><b>Publicidad</b>: si aceptas las cookies publicitarias, Google AdSense puede usar cookies e identificadores para mostrar y medir anuncios. Puedes consultar cómo usa Google los datos en policies.google.com/technologies/partner-sites.</li></ul>'+
      '<h2>Base legal y conservación</h2><p>Ejecución del contrato en la compra, interés legítimo para responder consultas y consentimiento para la publicidad personalizada. Conservamos los datos de contacto el tiempo necesario para atenderte y los de compra el plazo que exige la normativa fiscal.</p>'+
      '<h2>Tus derechos</h2><p>Puedes ejercer los derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a '+esc(mail)+'. También puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).</p>'],
    "cookies": ["Política de cookies",
      '<p>Esta web usa almacenamiento local del navegador para guardar tu progreso y tus preferencias (por ejemplo, el tema claro u oscuro). Es imprescindible para el funcionamiento de la web y no requiere consentimiento.</p>'+
      '<h2>Cookies de terceros</h2><p>Si no tienes Premium, la web muestra anuncios de Google AdSense. Google y sus socios pueden instalar cookies para mostrar anuncios, limitar su repetición y medir su rendimiento. Solo se usan para publicidad personalizada si das tu consentimiento en el aviso de privacidad que aparece al entrar.</p>'+
      '<h2>Cómo cambiar tu elección</h2><p>Puedes cambiar tu consentimiento en cualquier momento desde el enlace de preferencias de privacidad del aviso de cookies, o borrar las cookies desde la configuración de tu navegador. Si compras Premium, no se cargan anuncios.</p>'],
    "condiciones": ["Condiciones de compra",
      '<h2>Producto</h2><p>Tema Común Premium es un acceso de por vida a funciones adicionales de la web: navegación sin anuncios, simulacros a medida, repaso de fallos y preguntas marcadas, y estadísticas avanzadas. El contenido de estudio gratuito seguirá siendo gratuito.</p>'+
      '<h2>Precio y pago</h2><p>'+PRICE+', IVA incluido, en un único pago a través de PayPal. No es una suscripción y no hay renovaciones.</p>'+
      '<h2>Entrega</h2><p>Premium se activa al momento en el navegador donde pagas y recibes un código de activación para usarlo en otros dispositivos. Guárdalo: es la prueba de tu compra.</p>'+
      '<h2>Desistimiento</h2><p>Al tratarse de contenido digital que se suministra de inmediato, para comprar debes dar tu consentimiento expreso y aceptar que pierdes el derecho de desistimiento, según el artículo 103.m del Real Decreto Legislativo 1/2007 (Ley General para la Defensa de los Consumidores y Usuarios). Si Premium no funciona por un problema técnico nuestro, escríbenos a '+esc(mail)+' y lo solucionaremos o te devolveremos el importe.</p>'+
      '<h2>Contacto</h2><p>'+esc(L.titular)+' · '+esc(mail)+'.</p>']
  };
}
function viewLegal(key){
  const p = legalPages()[key];
  view().innerHTML = '<article class="wrap legal"><nav class="crumbs" aria-label="Ruta" style="padding-top:0"><a href="'+href("inicio")+'">Inicio</a> / '+esc(p[0])+'</nav><h1>'+esc(p[0])+'</h1>'+p[1]+'<p class="hint">Última actualización: 19 de octubre de 2026.</p></article>';
  document.title = p[0] + " · Tema Común";
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
  share: () => { const key = todayKey(); const d = store.get("daily:"+key, null); if (d) shareDaily(d.score, d.sq); },
  shareDone: () => { const d = store.get("daily:"+todayKey(), null); if (d) shareDaily(d.score, d.sq); },
  dailyRedo: () => { const key = todayKey(); startQuiz({ mode:"daily", replay:true, title:"Test del día · " + fmtDate(key) + " (repaso)", qs: dailyQs(key), feedback:true, seed:key }); },
  again: () => { if (!S || !CUR) return; if (S.mode === "quick") startQuick(); else if (S.mode === "sim") startSim(); else catMenu(); },
  retryFails: () => { const ids = S.failIds || []; startQuiz({ ...baseOpts(CUR || catById.ce), mode:"failed", title:"Repaso de fallos", qs: shuffle(ids.map(id => QID[id])), feedback:true }); },
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
  demo: () => { if (!$("#consent").checked){ buyMsg("Marca la casilla de aceptación para continuar.", "err"); return; } activate("DEMO-" + Math.random().toString(36).slice(2,10).toUpperCase()); },
  copyCode: () => copyText(license(), "#codeOut"),
  resetAsk: () => { $("#resetBox").innerHTML = '<div class="confirm"><span>Se borrarán tus respuestas, rachas, marcadas e historial de este navegador. Tu Premium se mantiene.</span><div class="grp"><button class="btn ghost small" data-act="resetNo">Cancelar</button><button class="btn small" data-act="resetYes">Borrar progreso</button></div></div>'; },
  resetNo: () => { $("#resetBox").innerHTML = ""; },
  resetYes: () => { ["qs","mk","hist","days","best"].forEach(k => store.del(k)); try { Object.keys(localStorage).filter(k => k.indexOf("tc2:daily:") === 0).forEach(k => localStorage.removeItem(k)); } catch(e){} refreshHeader(); viewProgress(); toast("Progreso borrado"); }
};
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const fn = ACT[b.dataset.act]; if (!fn) return;
  e.preventDefault(); fn(b, e);
});
document.addEventListener("change", e => { if (e.target && e.target.id === "withCE"){ store.set("withCE", e.target.checked); catMenu(); } });
document.addEventListener("keydown", e => {
  if (!S || S.done || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || "").toLowerCase(); if (tag === "input" || tag === "textarea" || tag === "select") return;
  const k = e.key.toLowerCase();
  const idx = "1234".indexOf(k) >= 0 ? "1234".indexOf(k) : "abcd".indexOf(k);
  if (idx >= 0 && k.length === 1){ e.preventDefault(); pick(idx); }
  else if (k === "enter"){ const nb = $("#nextBtn"); if (nb && !nb.hidden && document.activeElement !== nb){ e.preventDefault(); next(); } }
  else if (k === "m"){ const mb = $(".mark-btn"); if (mb) mb.click(); }
});

/* ============================================================
   ARRANQUE
   ============================================================ */
function render(){
  stopTimer(); S = null; CUR = null;
  const r = currentRoute();
  const legal = legalPages();
  if (r === "inicio" || r === "oposiciones" || r === "calendario"){ document.title = "Tema Común · Tests gratis para oposiciones"; viewHome(r); }
  else if (r.indexOf("op-") === 0) viewCat(r.slice(3));
  else if (r === "premium") viewPremium();
  else if (r === "progreso") viewProgress();
  else if (legal[r]) viewLegal(r);
  else viewHome("inicio");
  renderNav(r);
  if (r !== "oposiciones" && r !== "calendario") window.scrollTo(0, 0);
  initAds();
}
window.addEventListener("hashchange", render);
applyTheme(store.get("theme", "auto"));
refreshHeader(); renderNotice(); renderFooter(); render(); backgroundVerify();
})();
