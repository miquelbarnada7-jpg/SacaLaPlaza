// POST /api/paypal/capture-order { orderID } → cobra el pedido y, si el pago se completa, devuelve el código Premium.
import { apiBase, accessToken, json, priceOf, makeLicense } from "../../../lib/paypal.js";

export async function onRequestPost({ request, env }){
  try {
    const { orderID } = await request.json().catch(() => ({}));
    if (!orderID || !/^[A-Z0-9]{8,32}$/.test(orderID)) return json({ error: "Pedido no válido" }, 400);
    const token = await accessToken(env);
    const r = await fetch(apiBase(env) + "/v2/checkout/orders/" + orderID + "/capture", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }
    });
    const d = await r.json();
    const cap = d && d.purchase_units && d.purchase_units[0] && d.purchase_units[0].payments && d.purchase_units[0].payments.captures && d.purchase_units[0].payments.captures[0];
    const paid = d.status === "COMPLETED" && cap && cap.status === "COMPLETED" && cap.amount && cap.amount.currency_code === "EUR" && cap.amount.value === priceOf(env);
    if (!paid) return json({ error: "El pago no se ha completado" }, 402);
    const license = await makeLicense(env.LICENSE_SECRET, orderID);
    return json({ license });
  } catch (e){
    return json({ error: e.message }, 500);
  }
}
