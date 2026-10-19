// Generación de preguntas tipo test con la IA de Cloudflare (Workers AI).
// Necesita el enlace (binding) "AI" en el proyecto de Cloudflare Pages.
// Modelos configurables con la variable AI_MODELS (separados por comas); se prueban en orden.

const DEFAULT_MODELS = ["@cf/google/gemma-4-26b-a4b-it", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"];

const SYSTEM = "Eres un preparador experto de oposiciones en España. Creas preguntas tipo test a partir de los apuntes de un alumno. Respondes SOLO con JSON válido, sin texto antes ni después.";

export function buildPrompt({ oposicion, k, nOpts, texto }){
  const letras = Array.from({ length: nOpts }, () => '"..."').join(",");
  return [
    "Oposición: " + oposicion + ".",
    "Crea " + k + " preguntas tipo test sobre el TEXTO, como las del examen de esta oposición.",
    "Reglas:",
    "- Cada pregunta tiene exactamente " + nOpts + " opciones y solo una es correcta.",
    "- Usa solo información que aparece en el TEXTO. No inventes datos.",
    "- Pregunta lo que suele caer en el examen: plazos, cifras, órganos, requisitos, definiciones y excepciones.",
    "- Reparte las preguntas por todo el TEXTO, sin repetir la misma idea.",
    "- Las opciones incorrectas deben ser plausibles (mismo tipo de dato) pero falsas según el TEXTO.",
    "- No uses «todas las anteriores» ni «ninguna de las anteriores».",
    "- Español de España. Enunciados de una o dos líneas.",
    '- "correcta" es el índice (empezando en 0) de la opción correcta. Varía su posición.',
    '- "explicacion": una frase que justifica la respuesta con el TEXTO.',
    'Formato exacto: {"preguntas":[{"pregunta":"...","opciones":[' + letras + '],"correcta":0,"explicacion":"..."}]}',
    "",
    'TEXTO:',
    '"""',
    texto,
    '"""'
  ].join("\n");
}

function textOf(r){
  if (r == null) return "";
  if (typeof r === "string") return r;
  if (typeof r.response === "string") return r.response;
  if (r.response && typeof r.response === "object") return JSON.stringify(r.response);
  const c = r.choices && r.choices[0];
  if (c){
    const m = c.message || {};
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) return m.content.map(p => p.text || "").join("");
    if (typeof c.text === "string") return c.text;
  }
  if (r.result) return textOf(r.result);
  return "";
}

// Extrae el JSON aunque venga con ```json, texto alrededor o comas sobrantes.
export function parseJsonLoose(text){
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  const a2 = t.indexOf("["), b2 = t.lastIndexOf("]");
  const tries = [];
  if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  if (a2 >= 0 && b2 > a2) tries.push(t.slice(a2, b2 + 1));
  for (const s of tries){
    for (const v of [s, s.replace(/,\s*([}\]])/g, "$1")]){
      try { return JSON.parse(v); } catch (e){}
    }
  }
  return null;
}

const clean = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const norm = s => clean(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[.\s]+$/, "");
const BANNED = /(todas|ninguna) (de )?las (anteriores|respuestas)/i;

// Valida y normaliza: devuelve [{q, o:[correcta, ...incorrectas], e}]
export function normalizeQuestions(data, nOpts){
  const list = Array.isArray(data) ? data : (data && (data.preguntas || data.questions)) || [];
  const out = [], seen = new Set();
  for (const it of list){
    if (!it || typeof it !== "object") continue;
    const q = clean(it.pregunta || it.question || it.enunciado);
    let opts = (it.opciones || it.options || []).map(clean).filter(Boolean);
    let ci = parseInt(it.correcta != null ? it.correcta : it.correct, 10);
    if (typeof it.correcta === "string" && /^[A-D]$/i.test(it.correcta.trim())) ci = it.correcta.trim().toUpperCase().charCodeAt(0) - 65;
    if (!q || q.length < 8 || q.length > 400 || !(ci >= 0 && ci < opts.length)) continue;
    const correct = opts[ci];
    let wrong = opts.filter((o, i) => i !== ci);
    const ok = new Set([norm(correct)]);
    wrong = wrong.filter(o => { const k = norm(o); if (!k || ok.has(k) || BANNED.test(o) || o.length > 300) return false; ok.add(k); return true; });
    if (BANNED.test(correct) || correct.length > 300 || wrong.length < nOpts - 1) continue;
    const key = norm(q);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ q, o: [correct].concat(wrong.slice(0, nOpts - 1)), e: clean(it.explicacion || it.explanation).slice(0, 500) });
  }
  return out;
}

function inputFor(model, prompt, k){
  const maxTok = Math.min(6000, 900 + k * 420);
  const base = { messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }], temperature: 0.4 };
  if (/gemma-4|gpt-oss|qwen3|glm|kimi|deepseek-v4|nemotron/.test(model)) return { ...base, max_completion_tokens: maxTok };
  return { ...base, max_tokens: maxTok };
}

function withTimeout(p, ms){
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

export async function generate(env, { oposicion, k, nOpts, texto }){
  if (!env.AI || typeof env.AI.run !== "function"){ const e = new Error("NO_AI"); e.code = "NO_AI"; throw e; }
  const models = String(env.AI_MODELS || "").split(",").map(s => s.trim()).filter(Boolean);
  const chain = models.length ? models : DEFAULT_MODELS;
  const prompt = buildPrompt({ oposicion, k, nOpts, texto });
  let lastErr = null;
  for (const model of chain){
    try {
      const r = await withTimeout(env.AI.run(model, inputFor(model, prompt, k)), 100000);
      const qs = normalizeQuestions(parseJsonLoose(textOf(r)), nOpts);
      if (qs.length) return { model, questions: qs.slice(0, k) };
      lastErr = new Error("La IA no devolvió preguntas válidas (" + model + ")");
    } catch (e){
      lastErr = e;
      // Si se ha agotado el cupo diario gratuito de la IA, no tiene sentido probar otro modelo.
      if (/(4006|neurons|daily free allocation|exceeded|quota)/i.test(String(e && e.message))){ const q = new Error("AI_QUOTA"); q.code = "AI_QUOTA"; throw q; }
    }
  }
  throw lastErr || new Error("IA no disponible");
}
