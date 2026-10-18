// POST /api/license/verify { license } → { valid: true|false }
import { json, checkLicense } from "../../../lib/paypal.js";

export async function onRequestPost({ request, env }){
  const { license } = await request.json().catch(() => ({}));
  return json({ valid: await checkLicense(env.LICENSE_SECRET, license) });
}
