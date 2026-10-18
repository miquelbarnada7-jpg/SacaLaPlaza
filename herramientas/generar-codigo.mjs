// Genera un código Premium a mano (por ejemplo, si alguien te paga por Bizum o transferencia).
// Necesitas Node 18 o superior. Uso:
//   LICENSE_SECRET="la-misma-frase-que-en-cloudflare" node generar-codigo.mjs "Bizum Ana 12-11-2026"
import crypto from "node:crypto";

const secret = process.env.LICENSE_SECRET;
const ref = process.argv.slice(2).join(" ") || "MANUAL";
if (!secret){ console.error("Falta LICENSE_SECRET. Usa la misma frase que pusiste en Cloudflare."); process.exit(1); }

const b64url = buf => Buffer.from(buf).toString("base64url");
const payload = b64url(JSON.stringify({ o: "MANUAL-" + ref, t: Date.now() }));
const sig = b64url(crypto.createHmac("sha256", secret).update(payload).digest());
console.log("TC1." + payload + "." + sig);
