const app = document.querySelector("#app");
const status = document.querySelector("#status");
const list = document.querySelector("#orders");
const nonce = crypto.randomUUID();
app.dataset.requestNonce = nonce;

try {
  const response = await fetch(`/api/orders?nonce=${encodeURIComponent(nonce)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Orders request failed with ${response.status}`);
  const payload = await response.json();
  list.innerHTML = payload.orders.map((order) => `<li>Order ${order.id} — $${Number(order.total).toFixed(2)}</li>`).join("");
  status.textContent = `Loaded ${payload.orders.length} orders`;
} catch (error) {
  status.textContent = error.message;
} finally {
  app.setAttribute("aria-busy", "false");
}
