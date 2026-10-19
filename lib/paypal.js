// Cobro de Premium con PayPal (pedido + captura en el servidor).
// Variables de entorno: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV ("sandbox" o "live"), PRICE ("2.00").
import { fail } from "./http.js";

export const apiBase = env => env.PAYPAL_API_BASE || (String(env.PAYPAL_ENV || "").trim().toLowerCase() === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");

// Normaliza el precio a dos decimales: "2" → "2.00", "2,5" → "2.50".
export function priceOf(env){
  const n = parseFloat(String(env.PRICE || "4.99").replace(",", "."));
  return (isFinite(n) && n > 0 ? n : 4.99).toFixed(2);
}

export async function accessToken(env){
  const id = (env.PAYPAL_CLIENT_ID || "").trim(), secret = (env.PAYPAL_CLIENT_SECRET || "").trim();
  if (!id || !secret) fail(503, "Los pagos todavía no están configurados.", { code: "NO_PAYPAL" });
  const r = await fetch(apiBase(env) + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(id + ":" + secret), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  if (!r.ok) fail(502, "PayPal ha rechazado las claves configuradas. Revisa PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET y PAYPAL_ENV.", { code: "PAYPAL_AUTH" });
  return (await r.json()).access_token;
}

export async function createOrder(env, user){
  const token = await accessToken(env);
  const r = await fetch(apiBase(env) + "/v2/checkout/orders", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: "premium",
        custom_id: "u" + user.id,
        description: "SacaLaPlaza Premium · pago único",
        amount: { currency_code: "EUR", value: priceOf(env) }
      }],
      application_context: { brand_name: "SacaLaPlaza", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW", locale: "es-ES" }
    })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.id) fail(502, "No se ha podido crear el pedido en PayPal.");
  return d.id;
}

function firstCapture(order){
  const pu = order && order.purchase_units && order.purchase_units[0];
  const cap = pu && pu.payments && pu.payments.captures && pu.payments.captures[0];
  return { pu, cap };
}

// Cobra el pedido y devuelve los datos del cobro si está completado y es de este usuario.
export async function captureOrder(env, orderId, user){
  const token = await accessToken(env);
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json", "PayPal-Request-Id": "slp-" + orderId };
  let r = await fetch(apiBase(env) + "/v2/checkout/orders/" + orderId + "/capture", { method: "POST", headers });
  let d = await r.json().catch(() => ({}));
  if (!r.ok){
    const issue = d && d.details && d.details[0] && d.details[0].issue;
    if (issue === "ORDER_ALREADY_CAPTURED"){
      r = await fetch(apiBase(env) + "/v2/checkout/orders/" + orderId, { headers: { Authorization: "Bearer " + token } });
      d = await r.json().catch(() => ({}));
    } else if (issue === "INSTRUMENT_DECLINED"){
      fail(402, "PayPal ha rechazado el método de pago. Prueba con otra tarjeta o cuenta.", { code: "DECLINED" });
    } else {
      fail(502, "PayPal no ha podido completar el cobro.");
    }
  }
  const { pu, cap } = firstCapture(d);
  const custom = (cap && cap.custom_id) || (pu && pu.custom_id);
  const ok = cap && cap.status === "COMPLETED" && cap.amount && cap.amount.currency_code === "EUR" && cap.amount.value === priceOf(env);
  if (!ok) fail(402, "El pago no se ha completado.", { code: "NOT_COMPLETED" });
  if (custom !== "u" + user.id) fail(403, "Este pago pertenece a otra cuenta.", { code: "OTHER_USER" });
  return { amount: cap.amount.value, captureId: cap.id };
}
