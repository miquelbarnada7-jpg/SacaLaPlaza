/* ============================================================
   SACALAPLAZA · SUBE TUS APUNTES
   Lee PDF (también escaneados, con OCR) y Word (.docx) en el navegador,
   detecta los temas y crea un test adaptado a la oposición.
   ============================================================ */
(function(){
"use strict";
const X = window.SLP;
const { api, store, toast, esc, href, CATS, catById } = X;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MAX_MB = 40, MAX_OCR_PAGES = 60;
const OPOS = CATS.filter(c => c.id !== "ce");

let ROOT = null;
let ST = { phase: "pick", doc: null, file: null, tests: null, cupo: null, cancel: false, opo: null, lastTest: null };

/* ---------------- Utilidades ---------------- */
const fmtInt = n => Number(n).toLocaleString("es-ES");
const strip = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
function rnd(seed){ let h = 2166136261 ^ seed; return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ t>>>15, t|1); t ^= t + Math.imul(t ^ t>>>7, t|61); return ((t ^ t>>>14)>>>0)/4294967296; }; }
function shuffleR(a, r){ a = a.slice(); for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const loaded = {};
function loadScript(url){
  if (loaded[url]) return loaded[url];
  loaded[url] = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = url; s.async = true; s.crossOrigin = "anonymous";
    s.onload = res; s.onerror = () => { delete loaded[url]; rej(new Error("No se ha podido descargar una librería necesaria. Revisa tu conexión.")); };
    document.head.appendChild(s);
  });
  return loaded[url];
}
let pdfjsP = null;
function loadPdf(){
  if (!pdfjsP) pdfjsP = import(CONFIG.libs.pdf).then(m => { const lib = m.default && m.default.getDocument ? m.default : m; lib.GlobalWorkerOptions.workerSrc = CONFIG.libs.pdfWorker; return lib; }).catch(e => { pdfjsP = null; throw new Error("No se ha podido cargar el lector de PDF. Revisa tu conexión."); });
  return pdfjsP;
}
async function loadZip(){ if (!window.JSZip) await loadScript(CONFIG.libs.jszip); return window.JSZip; }
async function loadOcr(){ if (!window.Tesseract) await loadScript(CONFIG.libs.tesseract); return window.Tesseract; }

/* ---------------- Lectura de PDF ---------------- */
function itemsToText(items){
  let out = "", lastY = null, lastEnd = null;
  for (const it of items){
    if (typeof it.str !== "string") continue;
    const tr = it.transform || [1,0,0,1,0,0], y = tr[5], x = tr[4];
    if (lastY !== null && Math.abs(y - lastY) > Math.max(2, (it.height || 8) * 0.5)){
      if (!out.endsWith("\n")) out += "\n";
    } else if (lastEnd !== null && it.str && !out.endsWith(" ") && !out.endsWith("\n") && !/^\s/.test(it.str) && x - lastEnd > 1.5){
      out += " ";
    }
    out += it.str;
    if (it.hasEOL) out += "\n";
    lastY = y; lastEnd = x + (it.width || 0);
  }
  return out;
}
async function readPdf(buf, prog){
  const pdfjs = await loadPdf();
  let doc, task;
  try { task = pdfjs.getDocument({ data: buf, isEvalSupported: false, useSystemFonts: true }); doc = await task.promise; }
  catch(e){
    if (e && e.name === "PasswordException") throw new Error("El PDF está protegido con contraseña. Quítale la contraseña y vuelve a subirlo.");
    throw new Error("No hemos podido abrir el PDF. Puede que esté dañado.");
  }
  const pages = [], N = doc.numPages;
  for (let p = 1; p <= N; p++){
    if (ST.cancel) throw new Error("CANCEL");
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push({ n: p, text: itemsToText(tc.items) });
    page.cleanup();
    if (p % 3 === 0 || p === N) prog(p / N * (0.95), "Leyendo página " + p + " de " + N);
  }
  const poor = pages.filter(pg => pg.text.replace(/\s/g, "").length < 40);
  let ocrInfo = null;
  if (poor.length && poor.length >= Math.max(1, pages.length * 0.3)){
    const todo = poor.slice(0, MAX_OCR_PAGES);
    ocrInfo = { pages: todo.length, skipped: poor.length - todo.length };
    prog(0, "Tu PDF parece escaneado. Reconociendo el texto (OCR) de " + todo.length + " página" + (todo.length === 1 ? "" : "s") + "…");
    const T = await loadOcr();
    let cur = 0;
    const worker = await T.createWorker("spa", 1, {
      workerPath: CONFIG.libs.tesseractWorker, corePath: CONFIG.libs.tesseractCore, langPath: CONFIG.libs.tesseractLang,
      logger: m => { if (m && m.status === "recognizing text" && typeof m.progress === "number") prog((cur + m.progress) / todo.length, "Reconociendo texto: página " + (cur + 1) + " de " + todo.length); else if (m && /loading|initializ/.test(m.status || "")) prog(0.02, "Preparando el reconocimiento de texto…"); }
    });
    try {
      for (const pg of todo){
        if (ST.cancel) throw new Error("CANCEL");
        const page = await doc.getPage(pg.n);
        const vp0 = page.getViewport({ scale: 1 });
        const scale = Math.min(2.5, 2000 / Math.max(vp0.width, vp0.height) * 1.4);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const r = await worker.recognize(canvas);
        pg.text = (r && r.data && r.data.text) || "";
        pg.ocr = true;
        page.cleanup(); canvas.width = canvas.height = 0;
        cur++;
      }
    } finally { await worker.terminate().catch(()=>{}); }
  }
  try { if (task && task.destroy) await task.destroy(); else if (doc && doc.destroy) await doc.destroy(); } catch(e){}
  return { pages, kind: "pdf", ocr: ocrInfo };
}

/* ---------------- Lectura de Word (.docx) ---------------- */
function wAttr(el, name){ return el.getAttributeNS(W_NS, name) || el.getAttribute("w:" + name) || ""; }
async function readDocx(buf, prog){
  const JSZip = await loadZip();
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch(e){ throw new Error("No hemos podido abrir el documento de Word. Puede que esté dañado."); }
  const f = zip.file("word/document.xml");
  if (!f) throw new Error("Este archivo no es un documento de Word (.docx) válido.");
  prog(0.3, "Leyendo el documento de Word…");
  const xml = await f.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("No hemos podido leer el contenido del documento de Word.");
  const paras = Array.from(doc.getElementsByTagNameNS(W_NS, "p"));
  const hasBreaks = doc.getElementsByTagNameNS(W_NS, "lastRenderedPageBreak").length > 0;
  const pages = [{ n: 1, text: "", heads: [] }];
  let cur = pages[0];
  const newPage = () => { cur = { n: pages.length + 1, text: "", heads: [] }; pages.push(cur); };
  paras.forEach((p, i) => {
    let text = "", brk = false;
    const walk = node => {
      for (const ch of node.childNodes){
        if (ch.nodeType !== 1) continue;
        const ln = ch.localName;
        if (ln === "t") text += ch.textContent;
        else if (ln === "tab") text += " ";
        else if (ln === "br" || ln === "cr"){ if (wAttr(ch, "type") === "page") brk = true; else text += "\n"; }
        else if (ln === "lastRenderedPageBreak") brk = true;
        else if (ln === "pPr" || ln === "rPr" || ln === "instrText" || ln === "delText") continue;
        else walk(ch);
      }
    };
    walk(p);
    if (brk && cur.text.trim()) newPage();
    let level = 0;
    const st = p.getElementsByTagNameNS(W_NS, "pStyle")[0], ol = p.getElementsByTagNameNS(W_NS, "outlineLvl")[0];
    if (st){ const m = /(?:heading|t[ií]?tulo|ttulo)\s*(\d)/i.exec(wAttr(st, "val")); if (m) level = +m[1]; else if (/^title$|^t[ií]tulo$/i.test(wAttr(st, "val"))) level = 1; }
    if (!level && ol){ const v = parseInt(wAttr(ol, "val"), 10); if (v >= 0 && v < 3) level = v + 1; }
    text = text.replace(/[ \t]+/g, " ").trim();
    if (!text) return;
    if (level && text.length < 160) cur.heads.push({ level, text });
    cur.text += text + "\n";
    if (!hasBreaks && cur.text.length > 3200) newPage();
    if (i % 400 === 0) prog(0.3 + 0.6 * i / paras.length, "Leyendo el documento de Word…");
  });
  return { pages: pages.filter(p => p.text.trim()), kind: "docx", ocr: null };
}

/* ---------------- Análisis: limpieza y temas ---------------- */
const normLine = l => l.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
function cleanPages(pages){
  const N = pages.length;
  const lines = pages.map(p => p.text.replace(/­/g, "").replace(/\r/g, "").split("\n").map(l => l.replace(/[ \t ]+/g, " ").trim()).filter(Boolean));
  if (N >= 4){
    const count = {};
    lines.forEach(ls => { const seen = new Set(); ls.slice(0, 2).concat(ls.slice(-2)).forEach(l => { const k = normLine(l); if (k.length > 0 && k.length < 120 && !seen.has(k)){ seen.add(k); count[k] = (count[k] || 0) + 1; } }); });
    const rep = new Set(Object.keys(count).filter(k => count[k] >= Math.max(3, N * 0.4)));
    lines.forEach((ls, i) => { lines[i] = ls.filter((l, j) => !((j < 2 || j >= ls.length - 2) && rep.has(normLine(l)))); });
  }
  return lines.map(ls => ls.filter(l => !/^(p[aá]g(ina)?\.?\s*)?\d{1,4}(\s*(de|\/)\s*\d{1,4})?$/i.test(l) && !/^[-–—_.·•\s]+$/.test(l)));
}
const HEAD_PATTERNS = [
  { re: /^(TEMA|Tema|UNIDAD(?: DID[ÁA]CTICA)?|Unidad(?: did[áa]ctica)?|BLOQUE|Bloque|LECCI[ÓO]N|Lecci[óo]n|M[ÓO]DULO|M[óo]dulo)\s+(\d{1,3}|[IVXLC]{1,7})\b\s*[.:\-–—]?\s*(.*)$/, name: "tema" },
  { re: /^(T[ÍI]TULO|T[íi]tulo)\s+([IVXLC]{1,7}|PRELIMINAR|Preliminar|\d{1,3})\b\s*[.:\-–—]?\s*(.*)$/, name: "titulo" },
  { re: /^(CAP[ÍI]TULO|Cap[íi]tulo)\s+([IVXLC]{1,7}|\d{1,3}|PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|S[ÉE]PTIMO|OCTAVO|NOVENO|D[ÉE]CIMO|[ÚU]NICO)\b\s*[.:\-–—]?\s*(.*)$/, name: "capitulo" },
  { re: /^(\d{1,2})\.\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ,;()\-–]{6,90})$/, name: "numerado" }
];
const isTocLine = l => /\.{4,}|…{2,}|_{4,}/.test(l) || /\s\d{1,3}$/.test(l) && l.length < 90 && /\.\s?\.\s?\./.test(l);
function paragraphs(lines){
  // Une líneas cortadas a mitad de frase (típico de los PDF).
  const lens = lines.map(l => l.length).sort((a, b) => a - b);
  const med = lens.length ? lens[Math.floor(lens.length / 2)] : 80;
  let out = "";
  lines.forEach((l, i) => {
    out += l;
    const nx = lines[i + 1];
    if (!nx){ out += "\n"; return; }
    const endsSentence = /[.:;!?»”"]$/.test(l);
    const short = l.length < med * 0.6;
    const nxList = /^([-–•·*]|\d{1,3}[.)º]|[a-zñ]\)|[IVX]{1,5}\.)\s/.test(nx);
    if (/-$/.test(l) && /^[a-záéíóúñ]/.test(nx)) out = out.slice(0, -1);
    else if (endsSentence || short || nxList) out += "\n";
    else out += " ";
  });
  return out;
}
function analyze(raw){
  const lines = cleanPages(raw.pages);
  const flat = [];
  lines.forEach((ls, i) => ls.forEach(l => flat.push({ p: raw.pages[i].n, t: l })));
  const docxHeads = raw.kind === "docx" ? raw.pages.flatMap(p => (p.heads || []).map(h => ({ ...h, p: p.n }))) : [];
  // Detectar el tipo de encabezado que divide el documento en temas.
  let chosen = null;
  for (const pat of HEAD_PATTERNS){
    const idx = [];
    flat.forEach((ln, i) => { if (ln.t.length < 140 && !isTocLine(ln.t) && pat.re.test(ln.t)) idx.push(i); });
    if (idx.length >= 2){ chosen = { idx, name: pat.name }; break; }
  }
  if (!chosen && docxHeads.length >= 2){
    const lvl = docxHeads.filter(h => h.level === 1).length >= 2 ? 1 : 2;
    const wanted = docxHeads.filter(h => h.level === lvl).map(h => h.text);
    const idx = [];
    let k = 0;
    flat.forEach((ln, i) => { if (k < wanted.length && ln.t === wanted[k]){ idx.push(i); k++; } });
    if (idx.length >= 2) chosen = { idx, name: "docx" };
  }
  let sections = [];
  const mk = (title, from, to) => {
    const part = flat.slice(from, to);
    if (!part.length) return null;
    const text = paragraphs(part.map(x => x.t));
    return { title, text, p1: part[0].p, p2: part[part.length - 1].p, chars: text.length };
  };
  if (chosen){
    if (chosen.idx[0] > 0){ const s = mk("Introducción", 0, chosen.idx[0]); if (s) sections.push(s); }
    chosen.idx.forEach((start, j) => {
      const end = j + 1 < chosen.idx.length ? chosen.idx[j + 1] : flat.length;
      let title = flat[start].t;
      if (title.length < 22 && flat[start + 1] && flat[start + 1].t.length < 110 && start + 1 < end) title += " · " + flat[start + 1].t;
      const s = mk(title.replace(/\s+/g, " ").slice(0, 110), start, end);
      if (s) sections.push(s);
    });
    // Los temas casi vacíos (índices, portadas) se unen al siguiente o se descartan.
    const merged = [];
    sections.forEach(s => {
      if (s.chars < 350){ if (merged.length && s.title !== "Introducción"){ const prev = merged[merged.length - 1]; prev.text += "\n" + s.text; prev.chars = prev.text.length; prev.p2 = s.p2; } return; }
      merged.push(s);
    });
    sections = merged;
  }
  if (sections.length < 2){
    const N = raw.pages.length, per = Math.max(1, Math.ceil(N / 12));
    sections = [];
    for (let a = 0; a < N; a += per){
      const pagesIn = raw.pages.slice(a, a + per).map(p => p.n);
      const part = flat.filter(x => pagesIn.indexOf(x.p) >= 0);
      if (!part.length) continue;
      const text = paragraphs(part.map(x => x.t));
      if (text.replace(/\s/g, "").length < 120) continue;
      const lbl = raw.kind === "docx" ? "Parte " + (sections.length + 1) : (pagesIn.length > 1 ? "Páginas " + pagesIn[0] + "–" + pagesIn[pagesIn.length - 1] : "Página " + pagesIn[0]);
      sections.push({ title: lbl, text, p1: pagesIn[0], p2: pagesIn[pagesIn.length - 1], chars: text.length });
    }
    chosen = null;
  }
  const all = sections.map(s => s.text).join("\n");
  const words = (all.match(/[A-Za-zÁÉÍÓÚÑáéíóúñü]{2,}/g) || []).length;
  const arts = new Set((all.match(/\bArt[íi]culo\s+\d{1,3}/gi) || []).map(a => a.replace(/\D/g, "")));
  return { sections, words, articles: arts.size, pages: raw.pages.length, kind: raw.kind, ocr: raw.ocr, byHeadings: !!chosen, emptyText: words < 60 };
}

/* ---------------- Generador básico (sin IA) ---------------- */
const NUMW = { "un":1,"uno":1,"una":1,"dos":2,"tres":3,"cuatro":4,"cinco":5,"seis":6,"siete":7,"ocho":8,"nueve":9,"diez":10,"once":11,"doce":12,"trece":13,"catorce":14,"quince":15,"dieciséis":16,"dieciseis":16,"diecisiete":17,"dieciocho":18,"diecinueve":19,"veinte":20,"veinticinco":25,"treinta":30,"cuarenta":40,"cuarenta y cinco":45,"cincuenta":50,"sesenta":60,"setenta":70,"ochenta":80,"noventa":90,"cien":100,"ciento veinte":120,"doscientos":200,"trescientos":300,"cuatrocientos":400,"quinientos":500,"mil":1000 };
const WORDN = {}; Object.keys(NUMW).forEach(k => { if (!WORDN[NUMW[k]] && k !== "uno" && k !== "una") WORDN[NUMW[k]] = k; });
const UNITS = [
  { re: "d[ií]as? h[áa]biles", sg: "día hábil", pl: "días hábiles", f: false, vals: [3,5,10,15,20,30,45,60] },
  { re: "d[ií]as? naturales", sg: "día natural", pl: "días naturales", f: false, vals: [3,5,10,15,20,30,45,60,90] },
  { re: "d[ií]as?", sg: "día", pl: "días", f: false, vals: [2,3,5,7,10,15,20,30,45,60,90] },
  { re: "semanas?", sg: "semana", pl: "semanas", f: true, vals: [1,2,3,4,6,8] },
  { re: "meses|mes", sg: "mes", pl: "meses", f: false, vals: [1,2,3,4,6,9,12,18] },
  { re: "años?", sg: "año", pl: "años", f: false, vals: [1,2,3,4,5,6,8,9,10,12,15,20] },
  { re: "horas?", sg: "hora", pl: "horas", f: true, vals: [6,12,24,48,72,96] },
  { re: "minutos?", sg: "minuto", pl: "minutos", f: false, vals: [5,10,15,20,30,45,60,90,120] },
  { re: "miembros", pl: "miembros", vals: [] }, { re: "diputados", pl: "diputados", vals: [] }, { re: "senadores", pl: "senadores", vals: [] },
  { re: "magistrados", pl: "magistrados", vals: [] }, { re: "vocales", pl: "vocales", vals: [] }, { re: "concejales", pl: "concejales", vals: [] },
  { re: "firmas", pl: "firmas", vals: [] }, { re: "euros", pl: "euros", vals: [] }, { re: "plazas", pl: "plazas", vals: [] }, { re: "personas", pl: "personas", vals: [] },
  { re: "(?:%|por ciento)", pl: "%", pct: true, vals: [] }
];
const NUMRE = "(\\d{1,3}(?:\\.\\d{3})+|\\d{1,6}(?:,\\d{1,2})?|" + Object.keys(NUMW).sort((a, b) => b.length - a.length).join("|") + ")";
const QTY_RE = new RegExp("(^|[^\\wáéíóúñ])" + NUMRE + "\\s*(" + UNITS.map(u => u.re).join("|") + ")(?![\\wáéíóúñ])", "gi");
function unitOf(word){ const w = word.toLowerCase(); for (const u of UNITS){ if (new RegExp("^(?:" + u.re + ")$", "i").test(w)) return u; } return null; }
function numVal(tok){ const t = tok.toLowerCase(); if (NUMW[t] != null) return NUMW[t]; return parseFloat(t.replace(/\./g, "").replace(",", ".")); }
function fmtQty(v, u, words){
  if (u.pct) return String(v).replace(".", ",") + " %";
  if (v === 1 && u.sg) return (u.f ? "una " : "un ") + u.sg;
  const n = words && WORDN[v] ? WORDN[v] : (v >= 10000 ? v.toLocaleString("es-ES") : String(v).replace(".", ","));
  return n + " " + (u.pl || u.sg);
}
const MAJ = [["mayoría absoluta","mayoría simple","mayoría cualificada","mayoría de tres quintos","mayoría de dos tercios"], ["tres quintos","dos tercios","tres cuartos","la mitad","un tercio"]];
const MAJ_RE = /\b(mayor[ií]a (?:absoluta|simple|cualificada|de (?:tres quintos|dos tercios))|tres quintos|dos tercios|tres cuartos)\b/i;
const STOP = new Set("para como esta este estos estas sobre entre desde hasta según cuando donde cual cuales cuyo cuya todos todas otros otras mismo misma dicho dicha debera deberá podrá podran podrán sera será seran serán tiene tienen haber habrá caso casos forma parte través mediante siguiente siguientes correspondiente correspondientes establecido establecida establecidos establecidas previsto prevista previstos previstas presente dispuesto dispuesta respecto artículo artículos apartado apartados".split(" "));
const LEAD = /^(?:El|La|Los|Las|Un|Una|Unos|Unas|En|Según|Por|Para|Con|Del|Al|De|Sin|Ante|Tras|Cuando|Si|Este|Esta|Estos|Estas|Dicho|Dicha|Cada|Todo|Toda|Todos|Todas)\s+/;
const ENT_RE = /\b[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,}(?:\s+(?:(?:de|del|de la|de los|de las|y|e|para|en)\s+)?[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{1,})*/g;
const ABBR = /(?:^|\s)(?:art|arts|n[úu]m|n\.?º|apdo|apdos|p[áa]g|p[áa]gs|sr|sra|sres|dña|d|dª|excmo|excma|ilmo|ilma|etc|vid|cfr|ej|p|pp|ss|aprox|admón|disp|adic|trans|cap|caps|vol|núms|ref|av|avda|tel|art\.º|ap|inc|lit)\.$/i;
function sentences(text){
  const out = [];
  text.split("\n").forEach(par => {
    par = par.trim(); if (par.length < 30) return;
    let start = 0;
    for (let i = 0; i < par.length; i++){
      const ch = par[i];
      if ((ch === "." || ch === "!" || ch === "?" || ch === ";") && i + 2 < par.length && par[i + 1] === " " && /[A-ZÁÉÍÓÚÑ¿¡«"(0-9]/.test(par[i + 2])){
        const piece = par.slice(start, i + 1);
        if (ch === "." && (ABBR.test(piece) || /(?:^|\s)[A-Za-z]\.$/.test(piece) || /\d\.$/.test(piece) && /^\d/.test(par.slice(i + 2)))) continue;
        out.push(piece.trim()); start = i + 2;
      }
    }
    out.push(par.slice(start).trim());
  });
  return out.filter(s => s.length >= 45 && s.length <= 320 && s.split(/\s+/).length >= 7 && !/^[^a-záéíóúñ]*$/.test(s) && /[a-záéíóúñ]{3}/.test(s));
}
const BLANK = "______";
function cutAround(s, a, b){
  // Recorta frases muy largas alrededor del hueco para que la pregunta se lea bien.
  if (s.length <= 230) return s;
  const L = Math.max(0, a - 110), R = Math.min(s.length, b + 110);
  return (L > 0 ? "…" + s.slice(s.indexOf(" ", L) + 1, a) : s.slice(0, a)) + s.slice(a, b) + (R < s.length ? s.slice(b, s.lastIndexOf(" ", R)) + "…" : s.slice(b));
}
function makeCloze(sent, a, b){
  const s = cutAround(sent, a, b);
  const shift = s.indexOf(sent.slice(a, b));
  const blanked = s.slice(0, shift) + BLANK + s.slice(shift + (b - a));
  return "Completa según tus apuntes: «" + blanked.replace(/\s+/g, " ").trim() + "»";
}
function buildIndex(sections){
  const qty = {}, ents = {}, entFirst = {}, words = {}, arts = [];
  sections.forEach(sec => {
    let m;
    QTY_RE.lastIndex = 0;
    while ((m = QTY_RE.exec(sec.text))){ const u = unitOf(m[3]); if (!u) continue; const v = numVal(m[2]); if (!isFinite(v)) continue; const k = u.pl || u.sg; (qty[k] = qty[k] || new Set()).add(v); }
    sec.text.split("\n").forEach(par => {
      (par.match(ENT_RE) || []).forEach((e, i) => {
        let ent = e.replace(LEAD, "").trim();
        if (ent.length < 5) return;
        const atStart = par.indexOf(e) === 0;
        const nw = ent.split(/\s+/).filter(w => /^[A-ZÁÉÍÓÚÑ]/.test(w)).length;
        if (nw < 2 && atStart) return;
        if (/^(Artículo|Art|Ley|Real|Tema|Título|Capítulo|Página|Disposición)$/i.test(ent)) return;
        ents[ent] = (ents[ent] || 0) + 1;
        if (atStart) entFirst[ent] = (entFirst[ent] || 0) + 1;
      });
      (par.match(/[a-záéíóúñü]{8,}/g) || []).forEach(w => { if (!STOP.has(w)) words[w] = (words[w] || 0) + 1; });
    });
    const re = /(?:^|\n)\s*Art[íi]culo\s+(\d{1,3})(?:\s*(bis|ter))?\s*[.\-–:]?\s*([^\n]*)/g;
    let am;
    while ((am = re.exec(sec.text))){
      const after = sec.text.slice(am.index + am[0].length, am.index + am[0].length + 900);
      let title = (am[3] || "").trim(), bodyTxt = after;
      const tm = /^([^.]{3,90})\.\s+(.*)$/s.exec(title);
      if (tm){ title = tm[1]; bodyTxt = tm[2] + " " + after; }
      else if (title.length > 90){ bodyTxt = title + " " + after; title = ""; }
      const first = (sentences(bodyTxt.replace(/^\s*\d+\.\s*/, ""))[0] || "").replace(/^\d+\.\s*/, "");
      arts.push({ n: +am[1], suf: am[2] || "", title, first, sec: sec.title });
    }
  });
  const entList = Object.keys(ents).filter(e => ents[e] >= 1 && (e.split(/\s+/).length > 1 || (ents[e] - (entFirst[e] || 0)) >= 2));
  return { qty, ents: entList.sort((a, b) => ents[b] - ents[a]), entCount: ents, words, arts };
}
function pickDistinct(cands, n, avoid, r){
  const out = [], seen = new Set(avoid.map(strip));
  for (const c of shuffleR(cands, r)){ const k = strip(c); if (seen.has(k)) continue; seen.add(k); out.push(c); if (out.length >= n) break; }
  return out;
}
function candidatesFor(sec, idx, nOpts, r){
  const need = nOpts - 1, res = [];
  const ref = sec.p1 ? (sec.p1 === sec.p2 ? "Pág. " + sec.p1 : "Págs. " + sec.p1 + "–" + sec.p2) : "";
  sentences(sec.text).forEach((s, si) => {
    // 1) Cifras con unidad: plazos, mayorías numéricas, miembros…
    QTY_RE.lastIndex = 0;
    const m = QTY_RE.exec(s);
    if (m){
      const u = unitOf(m[3]);
      if (u){
        const v = numVal(m[2]), words = isNaN(parseFloat(m[2]));
        const a = m.index + m[1].length, b = m.index + m[0].length;
        const answer = s.slice(a, b).trim();
        const pool = new Set();
        (idx.qty[u.pl || u.sg] || new Set()).forEach(x => { if (x !== v) pool.add(x); });
        (u.vals || []).forEach(x => { if (x !== v) pool.add(x); });
        if (pool.size < need + 2){ [v + 1, v - 1, v * 2, Math.round(v / 2), v + 2, v + 5, v + 10].forEach(x => { if (x > 0 && x !== v && Number.isInteger(x)) pool.add(x); }); }
        const near = Array.from(pool).sort((x, y) => Math.abs(Math.log(x / v)) - Math.abs(Math.log(y / v))).slice(0, need + 3);
        const distract = pickDistinct(near.map(x => fmtQty(x, u, words)), need, [answer], r);
        if (distract.length === need && isFinite(v)) res.push({ type: "num", score: 5, si, q: makeCloze(s, a, b), o: [answer].concat(distract), e: "Tus apuntes dicen: «" + s + "»", r: ref, g: sec.title });
      }
    }
    // 2) Mayorías y fracciones.
    const mj = MAJ_RE.exec(s);
    if (mj){
      const ans = mj[1]; const fam = MAJ.find(f => f.some(x => strip(x) === strip(ans))) || (/mayor/i.test(ans) ? MAJ[0] : MAJ[1]);
      const distract = pickDistinct(fam.filter(x => strip(x) !== strip(ans) && strip(s).indexOf(strip(x)) < 0), need, [ans], r);
      if (distract.length === need) res.push({ type: "maj", score: 5, si, q: makeCloze(s, mj.index, mj.index + ans.length), o: [ans].concat(distract), e: "Tus apuntes dicen: «" + s + "»", r: ref, g: sec.title });
    }
    // 3) Órganos, leyes e instituciones (nombres propios).
    const ents = idx.ents.filter(e => e.length >= 6 && s.indexOf(e) > 0 && s.indexOf(e) === s.lastIndexOf(e));
    if (ents.length){
      const ent = ents.sort((x, y) => y.length - x.length)[0];
      const words = ent.split(/\s+/).length;
      const pool = idx.ents.filter(e => e !== ent && s.indexOf(e) < 0 && e.indexOf(ent) < 0 && ent.indexOf(e) < 0 && Math.abs(e.split(/\s+/).length - words) <= 2);
      const distract = pickDistinct(pool.slice(0, 40), need, [ent], r);
      if (distract.length === need){ const a = s.indexOf(ent); res.push({ type: "ent", score: words > 1 ? 4 : 3, si, q: makeCloze(s, a, a + ent.length), o: [ent].concat(distract), e: "Tus apuntes dicen: «" + s + "»", r: ref, g: sec.title }); }
    }
    // 4) Palabra clave (último recurso).
    const kws = (s.match(/[a-záéíóúñü]{9,}/g) || []).filter(w => !STOP.has(w) && (idx.words[w] || 0) <= 6);
    if (kws.length){
      const w = kws.sort((x, y) => y.length - x.length)[0];
      const suf = w.slice(-4);
      let pool = Object.keys(idx.words).filter(x => x !== w && x.slice(-4) === suf && s.indexOf(x) < 0 && Math.abs(x.length - w.length) <= 4);
      if (pool.length < need) pool = pool.concat(Object.keys(idx.words).filter(x => x !== w && x.slice(-3) === w.slice(-3) && s.indexOf(x) < 0));
      const distract = pickDistinct(pool.slice(0, 60), need, [w], r);
      if (distract.length === need){ const a = s.search(new RegExp("(^|[^a-záéíóúñü])" + w + "(?![a-záéíóúñü])")); const st = a < 0 ? s.indexOf(w) : s.indexOf(w, a); res.push({ type: "kw", score: 1, si, q: makeCloze(s, st, st + w.length), o: [w].concat(distract), e: "Tus apuntes dicen: «" + s + "»", r: ref, g: sec.title }); }
    }
  });
  return res;
}
function articleQs(idx, secTitles, nOpts, r){
  const need = nOpts - 1, out = [];
  const nums = Array.from(new Set(idx.arts.map(a => a.n)));
  idx.arts.filter(a => secTitles.has(a.sec)).forEach(a => {
    const lbl = "Artículo " + a.n + (a.suf ? " " + a.suf : "");
    if (a.first && a.first.length >= 50){
      const near = nums.filter(x => x !== a.n).sort((x, y) => Math.abs(x - a.n) - Math.abs(y - a.n)).slice(0, need + 3);
      let pool = near.map(x => "Artículo " + x);
      if (pool.length < need) [1,2,3,-1,-2,5].forEach(d => { if (a.n + d > 0) pool.push("Artículo " + (a.n + d)); });
      const distract = pickDistinct(pool, need, [lbl], r);
      const txt = a.first.length > 240 ? a.first.slice(0, a.first.lastIndexOf(" ", 236)) + "…" : a.first;
      if (distract.length === need) out.push({ type: "art", score: 4, q: "Según tus apuntes, ¿qué artículo dice: «" + txt + "»?", o: [lbl].concat(distract), e: lbl + (a.title ? " (" + a.title + ")" : "") + ": «" + a.first + "»", r: lbl, g: a.sec });
    }
    if (a.title && a.title.length >= 6 && a.title.length <= 90){
      const pool = idx.arts.filter(b => b !== a && b.title && strip(b.title) !== strip(a.title) && b.title.length <= 90).map(b => b.title);
      const distract = pickDistinct(pool, need, [a.title], r);
      if (distract.length === need) out.push({ type: "rub", score: 3, q: "¿Cuál es el título (rúbrica) del " + lbl.toLowerCase().replace("artículo", "artículo") + "?", o: [a.title].concat(distract), e: lbl + ": " + a.title + ".", r: lbl, g: a.sec });
    }
  });
  return out;
}
function genBasic(sections, n, nOpts, seed){
  const r = rnd(seed || Date.now());
  const idx = buildIndex(sections);
  const titles = new Set(sections.map(s => s.title));
  const perSec = sections.map(sec => candidatesFor(sec, idx, nOpts, r).map(c => ({ ...c, sec: sec.title })));
  const arts = articleQs(idx, titles, nOpts, r);
  arts.forEach(a => { const i = sections.findIndex(s => s.title === a.g); if (i >= 0) perSec[i].push({ ...a, si: -1 - perSec[i].length, sec: a.g }); });
  // Reparto entre temas proporcional a los candidatos (al menos 1 por tema con candidatos).
  const total = perSec.reduce((a, l) => a + l.length, 0);
  if (!total) return [];
  const quota = perSec.map(l => l.length ? Math.max(1, Math.round(n * l.length / total)) : 0);
  let sum = quota.reduce((a, b) => a + b, 0);
  while (sum > n){ const i = quota.indexOf(Math.max.apply(null, quota)); quota[i]--; sum--; }
  const chosen = [], usedSent = new Set(), usedAns = new Set();
  const take = (c) => { const key = c.sec + "|" + c.si, ak = strip(c.o[0]) + "|" + strip(c.q).slice(0, 60); if (usedSent.has(key) || usedAns.has(ak)) return false; usedSent.add(key); usedAns.add(ak); chosen.push(c); return true; };
  perSec.forEach((list, i) => {
    const sorted = shuffleR(list, r).sort((a, b) => (b.score + r() * 1.5) - (a.score + r() * 1.5));
    let got = 0, kw = 0;
    for (const c of sorted){ if (got >= quota[i]) break; if (c.type === "kw" && kw >= Math.max(1, quota[i] * 0.25)) continue; if (take(c)){ got++; if (c.type === "kw") kw++; } }
  });
  if (chosen.length < n){
    const rest = shuffleR(perSec.flat(), r).sort((a, b) => b.score - a.score);
    for (const c of rest){ if (chosen.length >= n) break; take(c); }
  }
  return shuffleR(chosen.slice(0, n), r).map(c => ({ q: c.q, o: c.o, e: c.e, r: c.r, g: c.g }));
}

/* ---------------- Generación con IA (por fragmentos) ---------------- */
function chunksOf(sections, maxChars){
  const out = [];
  sections.forEach(sec => {
    const pars = sec.text.split("\n").filter(Boolean);
    let cur = "";
    const push = () => { if (cur.replace(/\s/g, "").length >= 300) out.push({ text: cur.trim(), sec: sec.title, ref: sec.p1 ? (sec.p1 === sec.p2 ? "Pág. " + sec.p1 : "Págs. " + sec.p1 + "–" + sec.p2) : "" }); cur = ""; };
    pars.forEach(p => { if (cur.length + p.length > maxChars && cur) push(); cur += p + "\n"; if (cur.length > maxChars * 1.3){ push(); } });
    push();
  });
  return out;
}
async function genAI(sections, n, nOpts, cat, onProg){
  const chunks = chunksOf(sections, 5500);
  if (!chunks.length) return { qs: [], fallback: n, msg: null };
  const per = 5, need = Math.min(chunks.length, Math.ceil(n / per));
  const step = chunks.length / need;
  const picked = Array.from({ length: need }, (_, i) => chunks[Math.min(chunks.length - 1, Math.floor(i * step + step / 2))]);
  let done = 0, stopMsg = null;
  const results = [];
  const base = Math.floor(n / need), extra = n % need;
  const queue = picked.map((c, i) => ({ c, k: Math.min(8, base + (i < extra ? 1 : 0)) })).filter(q => q.k > 0);
  let failedK = n - queue.reduce((a, q) => a + q.k, 0);
  const worker = async () => {
    while (queue.length){
      const job = queue.shift();
      if (stopMsg || ST.cancel){ failedK += job.k; continue; }
      try {
        const d = await api("/ia/preguntas", { method: "POST", data: { cat, nOpts, n: job.k, texto: job.c.text } });
        d.preguntas.forEach(q => results.push({ q: q.q, o: q.o, e: q.e, r: job.c.ref, g: job.c.sec }));
        if (d.preguntas.length < job.k) failedK += job.k - d.preguntas.length;
        if (d.cupo) ST.cupo = d.cupo;
      } catch(e){
        failedK += job.k;
        if (["LIMIT_IA","AI_QUOTA","NO_AI","NO_SESSION","OFFLINE"].indexOf(e.code) >= 0 || e.status === 401) stopMsg = e.message;
      }
      done++;
      onProg(done / picked.length, "Creando preguntas con IA: " + done + " de " + picked.length + " partes");
    }
  };
  await Promise.all([worker(), worker()]);
  return { qs: results, fallback: failedK, msg: stopMsg };
}

/* ---------------- Vistas ---------------- */
const optsInfo = c => c ? c.opts + " opciones por pregunta y cada fallo resta " + X.penText(c.pen) + (c.opts === 3 ? ", como en el examen real" : "") : "";
function opoSelect(id){
  const sel = ST.opo || (X.me() && X.me().oposicion) || store.get("opo", "") || "age";
  return '<select id="' + id + '">' + OPOS.map(c => '<option value="' + c.id + '"' + (c.id === sel ? " selected" : "") + '>' + esc(c.name) + '</option>').join("") + '</select>';
}
function gate(){
  return '<div class="esc-hero"><div class="stack"><p class="label">Sube tus apuntes</p><h1>Convierte tus apuntes en un test <span class="hl">de tu oposición</span></h1><p class="cat-lead">Sube tu temario en PDF o Word. Lo leemos entero (también si está escaneado), detectamos los temas y creamos preguntas con el número de opciones y la penalización de tu examen.</p>' +
    '<div class="auth-cta"><p><b>Para usar esta herramienta necesitas una cuenta gratis.</b> Así tus tests quedan guardados y los puedes hacer desde cualquier dispositivo.</p><div class="grp" style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" data-act="toRegister" data-next="subir">Crear cuenta gratis</button><button class="btn ghost" data-act="toLogin" data-next="subir">Ya tengo cuenta</button></div></div></div>' +
    '<ol class="steps3 vertical"><li><span class="mono">1</span><b>Sube un PDF o un Word (.docx)</b><small>Hasta ' + MAX_MB + ' MB. Si el PDF está escaneado, reconocemos el texto (OCR).</small></li><li><span class="mono">2</span><b>Revisa el escaneo</b><small>Te mostramos páginas, palabras, artículos y los temas que hemos encontrado.</small></li><li><span class="mono">3</span><b>Elige temas y número de preguntas</b><small>Con IA (mejor calidad) o con el generador rápido.</small></li><li><span class="mono">4</span><b>Practica</b><small>Con corrección al momento o en modo examen. Se guarda en tu cuenta.</small></li></ol></div>' +
    '<p class="hint privacy-note">🔒 Tu documento se lee en tu navegador y no se guarda en nuestros servidores.</p>';
}
function render(root){
  ROOT = root || ROOT || $("#subirRoot");
  if (!ROOT) return;
  X.stopTimer();
  if (!X.me()){ ROOT.innerHTML = gate(); return; }
  ROOT.innerHTML = '<div class="esc-head"><div><p class="label">Sube tus apuntes</p><h1>Crea un test con tus apuntes</h1></div><p class="hint" id="cupoTxt"></p></div>' +
    '<div class="esc-grid"><section class="panel esc-work" id="esWork"></section><aside class="panel esc-list"><div class="list-head"><h3>Mis tests</h3><span class="hint" id="nTests"></span></div><div id="esList"><p class="hint">Cargando…</p></div></aside></div>';
  renderWork();
  loadList();
}
async function loadList(){
  const box = $("#esList"); if (!box) return;
  try {
    const d = await api("/tests");
    const first = !ST.cupo;
    ST.tests = d.tests; ST.cupo = d.cupo;
    if (first && ST.phase === "ready" && $("#esN")) renderReady();
  } catch(e){ box.innerHTML = '<p class="msg err">' + esc(e.message) + '</p>'; return; }
  renderList(); renderCupo();
}
function renderCupo(){
  const el = $("#cupoTxt"); if (!el || !ST.cupo) return;
  const c = ST.cupo;
  el.innerHTML = c.ia ? 'Preguntas con IA hoy: <b class="mono">' + Math.max(0, c.limite - c.usado) + '</b> de ' + c.limite + (X.isPremium() ? "" : ' · <a href="' + href("premium") + '">más con Premium</a>') : "Generador básico activo";
}
function renderList(){
  const box = $("#esList"); if (!box) return;
  const t = ST.tests || [];
  $("#nTests").textContent = ST.cupo ? t.length + " de " + ST.cupo.maxTests : "";
  if (!t.length){ box.innerHTML = '<p class="hint">Aquí aparecerán los tests que crees con tus apuntes. Se guardan en tu cuenta.</p>'; return; }
  box.innerHTML = '<ul class="tlist">' + t.map(x => {
    const c = catById[x.cat];
    return '<li><div class="tl-main"><strong>' + esc(x.title) + '</strong><span class="hint">' + x.n + ' preguntas · ' + esc(c ? c.short : "General") + ' · ' + X.fmtDay(x.created_at) + (x.gen === "ia" ? ' · IA' : x.gen === "mixto" ? ' · IA + básico' : "") + '</span></div><div class="tl-act"><button class="btn small" data-esc="play" data-id="' + x.id + '">Practicar</button><button class="btn small ghost" data-esc="exam" data-id="' + x.id + '">Examen</button><button class="btn small ghost" data-esc="del" data-id="' + x.id + '" aria-label="Borrar ' + esc(x.title) + '">Borrar</button></div><div class="tl-confirm" id="del-' + x.id + '"></div></li>';
  }).join("") + '</ul>';
}
function progressHTML(title){
  return '<div class="scan"><p class="label">' + esc(title) + '</p><div class="scanbar"><i id="scBar"></i></div><p id="scTxt" class="hint">Empezando…</p><button class="btn small ghost" data-esc="cancel">Cancelar</button></div>';
}
function setProg(f, txt){ const b = $("#scBar"), t = $("#scTxt"); if (b) b.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + "%"; if (t && txt) t.textContent = txt; }
function renderWork(){
  const w = $("#esWork"); if (!w) return;
  if (ST.phase === "pick" || !ST.doc){
    w.innerHTML = '<div class="stack"><label class="field"><span class="label">1 · ¿Qué oposición preparas?</span>' + opoSelect("esOpo") + '</label><p class="hint" id="opoInfo">' + esc(optsInfo(catById[(ST.opo || (X.me() && X.me().oposicion) || "age")] || catById.age)) + '</p>' +
      '<span class="label">2 · Sube tus apuntes</span><label class="drop" id="drop" tabindex="0"><input type="file" id="esFile" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden><span class="drop-icon" aria-hidden="true">⇪</span><b>Arrastra aquí tu PDF o Word</b><span class="hint">o pulsa para elegirlo · solo .pdf y .docx · hasta ' + MAX_MB + ' MB</span></label>' +
      '<p class="msg err" id="esErr" hidden></p><p class="hint">🔒 El documento se lee en tu navegador y no se sube a nuestros servidores. Para las preguntas con IA solo se envían fragmentos de texto, que no se guardan.</p></div>';
    const sel = $("#esOpo");
    sel.addEventListener("change", () => { ST.opo = sel.value; store.set("opo", sel.value); $("#opoInfo").textContent = optsInfo(catById[sel.value]); });
    ST.opo = sel.value;
    const drop = $("#drop"), inp = $("#esFile");
    inp.addEventListener("change", () => { if (inp.files[0]) handleFile(inp.files[0]); });
    drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " "){ e.preventDefault(); inp.click(); } });
    ["dragenter","dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave","drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", e => { const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f); });
    return;
  }
  if (ST.phase === "ready") return renderReady();
}
function showErr(msg){ ST.phase = "pick"; ST.doc = null; renderWork(); const e = $("#esErr"); if (e){ e.textContent = msg; e.hidden = false; } }
async function handleFile(file){
  const name = file.name || "documento";
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "doc") return showErr("Los archivos .doc antiguos no se pueden leer. Ábrelo en Word y guárdalo como .docx o como PDF.");
  if (ext !== "pdf" && ext !== "docx") return showErr("Solo se pueden subir archivos PDF (.pdf) o Word (.docx).");
  if (file.size > MAX_MB * 1024 * 1024) return showErr("El archivo pesa más de " + MAX_MB + " MB. Divide el documento en partes más pequeñas.");
  if (file.size < 100) return showErr("El archivo está vacío.");
  const buf = new Uint8Array(await file.arrayBuffer());
  const head = String.fromCharCode.apply(null, buf.slice(0, 1024));
  if (ext === "pdf" && head.indexOf("%PDF") < 0) return showErr("Este archivo no es un PDF válido aunque termine en .pdf.");
  if (ext === "docx" && !(buf[0] === 0x50 && buf[1] === 0x4B)) return showErr("Este archivo no es un Word (.docx) válido aunque termine en .docx.");
  ST.cancel = false; ST.file = { name, size: file.size, ext };
  ST.opo = ($("#esOpo") || {}).value || ST.opo;
  const w = $("#esWork");
  w.innerHTML = progressHTML("Escaneando «" + name + "»");
  try {
    const t0 = Date.now();
    const raw = ext === "pdf" ? await readPdf(buf.buffer, setProg) : await readDocx(buf.buffer, setProg);
    setProg(0.97, "Buscando los temas del documento…");
    await sleep(30);
    const doc = analyze(raw);
    doc.secs = (Date.now() - t0) / 1000;
    if (doc.emptyText) return showErr(raw.ocr ? "No hemos podido reconocer texto en este documento escaneado. Prueba con un PDF de mejor calidad." : "No hemos encontrado texto en este documento.");
    ST.doc = doc; ST.phase = "ready";
    renderReady();
  } catch(e){
    if (e && e.message === "CANCEL"){ ST.phase = "pick"; ST.doc = null; renderWork(); toast("Escaneo cancelado"); return; }
    console.error(e);
    showErr(e && e.message ? e.message : "No hemos podido leer el documento.");
  }
}
function renderReady(){
  const w = $("#esWork"), d = ST.doc, c = catById[ST.opo] || catById.age, cupo = ST.cupo || { maxPreguntas: X.isPremium() ? 50 : 10, ia: false, limite: 0, usado: 0 };
  const left = Math.max(0, (cupo.limite || 0) - (cupo.usado || 0));
  const nOptions = [5, 10, 20, 30, 50];
  const defN = Math.min(10, cupo.maxPreguntas);
  w.innerHTML = '<div class="stack">' +
    '<div class="scan-done"><span class="ok-dot" aria-hidden="true">✓</span><div><b>Escaneo completo: «' + esc(ST.file.name) + '»</b><span class="hint">Leído en ' + d.secs.toFixed(1).replace(".", ",") + ' s' + (d.ocr ? ' · texto reconocido con OCR en ' + d.ocr.pages + ' páginas' + (d.ocr.skipped ? ' (hemos dejado sin leer ' + d.ocr.skipped + '; sube el resto en otro archivo)' : "") : "") + '</span></div><button class="link-btn" data-esc="other">Cambiar archivo</button></div>' +
    '<div class="grid4 scan-stats"><div><span class="label">' + (d.kind === "docx" ? "Partes" : "Páginas") + '</span><span class="v">' + fmtInt(d.pages) + '</span></div><div><span class="label">Palabras</span><span class="v">' + fmtInt(d.words) + '</span></div><div><span class="label">Temas</span><span class="v">' + d.sections.length + '</span></div><div><span class="label">Artículos</span><span class="v">' + fmtInt(d.articles) + '</span></div></div>' +
    '<div class="stack"><div class="list-head"><span class="label">3 · ¿Qué quieres estudiar?</span><span><button class="link-btn" data-esc="all">Todo</button> · <button class="link-btn" data-esc="none">Nada</button></span></div>' +
      '<p class="hint">' + (d.byHeadings ? "Hemos encontrado estos temas en tu documento:" : "No hemos encontrado títulos de tema, así que lo hemos dividido por páginas:") + '</p>' +
      '<div class="secs" id="secs">' + d.sections.map((s, i) => '<label class="sec"><input type="checkbox" value="' + i + '" checked><span><b>' + esc(s.title) + '</b><small class="hint">' + (s.p1 ? (d.kind === "docx" ? "" : (s.p1 === s.p2 ? "pág. " + s.p1 : "págs. " + s.p1 + "–" + s.p2) + " · ") : "") + fmtInt(Math.round(s.chars / 6)) + ' palabras</small></span></label>').join("") + '</div></div>' +
    '<div class="form-grid"><label class="field"><span class="label">Oposición</span>' + opoSelect("esOpo2") + '</label>' +
      '<label class="field"><span class="label">Número de preguntas</span><select id="esN">' + nOptions.map(n => '<option value="' + n + '"' + (n > cupo.maxPreguntas ? " disabled" : "") + (n === defN ? " selected" : "") + '>' + n + (n > cupo.maxPreguntas ? " · Premium" : "") + '</option>').join("") + '</select></label></div>' +
    '<p class="hint" id="opoInfo2">' + esc(optsInfo(c)) + '</p>' +
    '<fieldset class="gen-choice"><legend class="label">Cómo crear las preguntas</legend>' +
      '<label class="radio' + (cupo.ia && left > 0 ? "" : " off") + '"><input type="radio" name="gen" value="ia"' + (cupo.ia && left > 0 ? " checked" : " disabled") + '><span><b>Con inteligencia artificial</b> <span class="pill conf">Recomendado</span><small class="hint">Preguntas de examen redactadas a partir de tu texto. ' + (cupo.ia ? (left > 0 ? "Te quedan " + left + " hoy." : "Has usado todas las de hoy.") : "No disponible ahora.") + '</small></span></label>' +
      '<label class="radio"><input type="radio" name="gen" value="basico"' + (cupo.ia && left > 0 ? "" : " checked") + '><span><b>Generador rápido</b><small class="hint">Sin límite y al instante: frases de tus apuntes con huecos (plazos, cifras, órganos, artículos).</small></span></label></fieldset>' +
    '<p class="msg err" id="genErr" hidden></p>' +
    '<div class="actions"><span class="hint">Las preguntas automáticas pueden tener errores: compruébalas con tus apuntes.</span><button class="btn" data-esc="gen">Crear mi test</button></div></div>';
  const s2 = $("#esOpo2");
  s2.addEventListener("change", () => { ST.opo = s2.value; store.set("opo", s2.value); $("#opoInfo2").textContent = optsInfo(catById[s2.value]); });
}
async function generateTest(){
  const d = ST.doc, err = $("#genErr");
  const sel = $$("#secs input:checked").map(i => d.sections[+i.value]);
  if (!sel.length){ err.textContent = "Elige al menos un tema."; err.hidden = false; return; }
  const n = +$("#esN").value, cat = $("#esOpo2").value, c = catById[cat], nOpts = c.opts;
  const mode = (document.querySelector('input[name="gen"]:checked') || {}).value || "basico";
  const w = $("#esWork");
  w.innerHTML = progressHTML("Creando tu test de " + n + " preguntas");
  ST.cancel = false;
  let qs = [], gen = "basico", note = null;
  try {
    if (mode === "ia"){
      const r = await genAI(sel, n, nOpts, cat, setProg);
      qs = r.qs; gen = "ia";
      if (r.fallback > 0){
        const extra = genBasic(sel, r.fallback + 4, nOpts, Date.now()).filter(b => !qs.some(q => strip(q.o[0]) === strip(b.o[0]) && strip(q.q).slice(0, 40) === strip(b.q).slice(0, 40)));
        qs = qs.concat(extra.slice(0, n - qs.length));
        if (extra.length) gen = qs.length && r.qs.length ? "mixto" : "basico";
        note = r.msg ? r.msg : (r.qs.length ? "La IA no pudo con alguna parte; la hemos completado con el generador rápido." : "La IA no está disponible ahora; hemos usado el generador rápido.");
      }
    } else {
      setProg(0.5, "Buscando cifras, plazos, órganos y artículos en tus apuntes…");
      await sleep(40);
      qs = genBasic(sel, n, nOpts, Date.now());
    }
  } catch(e){ console.error(e); }
  if (ST.cancel){ ST.phase = "ready"; renderReady(); return; }
  if (!qs.length){ ST.phase = "ready"; renderReady(); const e = $("#genErr"); e.textContent = "No hemos encontrado suficiente información en los temas elegidos para hacer preguntas. Prueba con más temas o con otro documento."; e.hidden = false; return; }
  const title = ST.file.name.replace(/\.(pdf|docx)$/i, "") + (sel.length < d.sections.length ? " · " + (sel.length === 1 ? sel[0].title : sel.length + " temas") : "");
  const test = { id: null, title: title.slice(0, 110), cat, nOpts, gen, preguntas: qs.slice(0, n) };
  setProg(1, "Guardando el test en tu cuenta…");
  try {
    const r = await api("/tests", { method: "POST", data: { titulo: test.title, cat, nOpts, gen, fuente: ST.file.name, secciones: sel.map(s => s.title), preguntas: test.preguntas } });
    test.id = r.id;
  } catch(e){ note = (note ? note + " " : "") + "No se ha podido guardar en tu cuenta: " + e.message; test.id = "local" + Date.now(); }
  if (qs.length < n) note = (note ? note + " " : "") + "Hemos podido crear " + qs.length + " preguntas de las " + n + " que pediste.";
  loadList();
  play(test, true, note);
}
function play(test, feedback, note){
  const c = catById[test.cat];
  ST.lastTest = test;
  ROOT.innerHTML = '<div class="esc-play"><div class="esc-head"><button class="link-btn" data-esc="back">← Volver a mis apuntes</button>' + (note ? '<p class="msg">' + esc(note) + '</p>' : "") + '</div>' + X.sheetHTML(test.title, "") + '</div>';
  const pen = c ? c.pen : (test.nOpts === 3 ? 1/2 : 1/3);
  const qs = test.preguntas.map((p, i) => ({ id: "u:" + (test.id || "x") + ":" + i, c: test.cat || "ce", user: true, q: p.q, o: p.o, e: p.e, r: p.r, g: p.g }));
  X.startQuiz({ mode: feedback ? "user" : "userExam", userTest: test, cat: test.cat, pen, nOpts: test.nOpts || (c ? c.opts : 4), title: test.title + (feedback ? "" : " · examen"), qs: X.shuffle(qs), feedback, timeLimit: feedback ? 0 : qs.length * 60 });
}
async function openTest(id, feedback){
  try { const d = await api("/tests/" + id); play(d.test, feedback); }
  catch(e){ toast(e.message); }
}

/* ---------------- Acciones ---------------- */
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-esc]"); if (!b) return;
  e.preventDefault();
  const a = b.dataset.esc;
  if (a === "cancel"){ ST.cancel = true; setProg(0, "Cancelando…"); }
  else if (a === "other"){ ST.phase = "pick"; ST.doc = null; renderWork(); }
  else if (a === "all" || a === "none") $$("#secs input").forEach(i => { i.checked = a === "all"; });
  else if (a === "gen") generateTest();
  else if (a === "back"){ render(); }
  else if (a === "play") openTest(b.dataset.id, true);
  else if (a === "exam") openTest(b.dataset.id, false);
  else if (a === "del"){ const box = $("#del-" + b.dataset.id); box.innerHTML = '<span>¿Borrar este test?</span><button class="btn small" data-esc="delYes" data-id="' + b.dataset.id + '">Sí, borrar</button><button class="btn small ghost" data-esc="delNo" data-id="' + b.dataset.id + '">No</button>'; }
  else if (a === "delNo"){ $("#del-" + b.dataset.id).innerHTML = ""; }
  else if (a === "delYes"){ try { await api("/tests/" + b.dataset.id, { method: "DELETE" }); toast("Test borrado"); loadList(); } catch(err){ toast(err.message); } }
});

window.SLP_ESC = {
  render,
  again: test => play(test, true),
  _test: { analyze, genBasic, sentences, buildIndex, chunksOf, readDocx, itemsToText }
};
})();
