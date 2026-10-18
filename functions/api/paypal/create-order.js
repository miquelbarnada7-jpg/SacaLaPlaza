// POST /api/paypal/create-order → crea un pedido de PayPal por el precio de Premium.
import { apiBase, accessToken, json, priceOf } from "../../../lib/paypal.js";

export async function onRequestPost({ env }){
  try {
    const token = await accessToken(env);
    const r = await fetch(apiBase(env) + "/v2/checkout/orders", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: "premium",
          description: "Tema Común Premium · pago único",
          amount: { currency_code: "EUR", value: priceOf(env) }
        }]
      })
    });
    const d = await r.json();
    if (!r.ok || !d.id) return json({ error: "No se pudo crear el pedido" }, 502);
    return json({ id: d.id });
  } catch (e){
    return json({ error: e.message }, 500);
  }
}
