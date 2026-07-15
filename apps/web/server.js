/**
 * Laiba Badar brand restaurant + delivery API
 * Parity target: Foodpanda restaurant storefront / brand apps (single kitchen)
 */
const http = require("http");
const { URL } = require("url");
const crypto = require("crypto");
const PORT = process.env.PORT || 8788;
const uid = (p) => `${p}_${crypto.randomBytes(4).toString("hex")}`;
const iso = () => new Date().toISOString();

const MENU = [
  { id: "m1", name: "Chicken Karahi", category: "mains", price_pkr: 1450, prep_min: 30, popular: true },
  { id: "m2", name: "Mutton Handi", category: "mains", price_pkr: 2100, prep_min: 40, popular: true },
  { id: "m3", name: "Garlic Naan", category: "bread", price_pkr: 80, prep_min: 8, popular: false },
  { id: "m4", name: "Gulab Jamun", category: "dessert", price_pkr: 250, prep_min: 5, popular: true },
  { id: "m5", name: "Fresh Lime", category: "drinks", price_pkr: 120, prep_min: 3, popular: false },
];
const ZONES = [
  { id: "z1", name: "DHA", fee_pkr: 100, eta_min: 35 },
  { id: "z2", name: "Gulberg", fee_pkr: 120, eta_min: 40 },
  { id: "z3", name: "Johar Town", fee_pkr: 150, eta_min: 50 },
];
const carts = {};
const orders = {};
const loyalty = {}; // user -> points

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(obj, null, 2));
}
function body(req) {
  return new Promise((r) => { let d=""; req.on("data", c => d+=c); req.on("end", () => { try{r(JSON.parse(d||"{}"))}catch{r({})} }); });
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = u.pathname.replace(/\/$/, "") || "/";
  if (req.method === "GET" && (p === "/" || p === "/health")) {
    return json(res, 200, { ok: true, service: "laibabadar", version: "2.0.0", brand: "Laiba Badar",
      parity_target: "Foodpanda single-restaurant / brand delivery apps",
      site: "https://laibabadar.com" });
  }
  if (p === "/capabilities") return json(res, 200, { ok: true, competitor: "Foodpanda restaurant storefront",
    features: ["menu", "modifiers", "delivery_zones", "cart", "checkout", "order_tracking", "loyalty"] });
  if (p === "/menu") {
    const cat = u.searchParams.get("category");
    let rows = MENU;
    if (cat) rows = rows.filter(m => m.category === cat);
    return json(res, 200, { ok: true, menu: rows });
  }
  if (p === "/zones") return json(res, 200, { ok: true, zones: ZONES });
  if (p === "/cart") {
    const user = u.searchParams.get("user") || "guest";
    return json(res, 200, { ok: true, items: carts[user] || [] });
  }
  if (p === "/loyalty") {
    const user = u.searchParams.get("user") || "guest";
    return json(res, 200, { ok: true, user, points: loyalty[user] || 0 });
  }
  if (p === "/orders") {
    const user = u.searchParams.get("user");
    let rows = Object.values(orders);
    if (user) rows = rows.filter(o => o.user === user);
    return json(res, 200, { ok: true, orders: rows });
  }
  if (p.startsWith("/orders/")) {
    const o = orders[p.split("/")[2]];
    return o ? json(res, 200, { ok: true, order: o }) : json(res, 404, { ok: false });
  }
  if (req.method === "POST" && p === "/cart/add") {
    const b = await body(req);
    const user = b.user || "guest";
    const item = MENU.find(m => m.id === b.item_id);
    if (!item) return json(res, 400, { ok: false, error: "unknown_item" });
    carts[user] = carts[user] || [];
    carts[user].push({ item_id: item.id, name: item.name, qty: b.qty || 1, unit_price: item.price_pkr, note: b.note || "" });
    return json(res, 200, { ok: true, cart: carts[user] });
  }
  if (req.method === "POST" && (p === "/checkout" || p === "/order")) {
    const b = await body(req);
    const user = b.user || "guest";
    const items = carts[user] || [];
    if (!items.length) return json(res, 400, { ok: false, error: "cart_empty" });
    const zone = ZONES.find(z => z.id === b.zone_id) || ZONES[0];
    const sub = items.reduce((s, i) => s + i.unit_price * i.qty, 0);
    const total = sub + zone.fee_pkr;
    const id = uid("lb");
    const order = {
      id, user, items, zone, subtotal_pkr: sub, delivery_fee_pkr: zone.fee_pkr, total_pkr: total,
      payment_method: b.payment_method || "cod", address: b.address || "", phone: b.phone || "",
      status: "placed", eta_min: zone.eta_min, timeline: [{ status: "placed", at: iso() }], created_at: iso(),
    };
    orders[id] = order;
    carts[user] = [];
    loyalty[user] = (loyalty[user] || 0) + Math.floor(total / 100);
    return json(res, 201, { ok: true, order, loyalty_points: loyalty[user] });
  }
  if (req.method === "POST" && p.startsWith("/orders/") && p.endsWith("/advance")) {
    const id = p.split("/")[2];
    const o = orders[id];
    if (!o) return json(res, 404, { ok: false });
    const seq = ["placed", "confirmed", "cooking", "out_for_delivery", "delivered"];
    const i = seq.indexOf(o.status);
    if (i >= 0 && i < seq.length - 1) {
      o.status = seq[i + 1];
      o.timeline.push({ status: o.status, at: iso() });
    }
    return json(res, 200, { ok: true, order: o });
  }
  // simple landing
  if (req.method === "GET" && p === "/page") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(`<!doctype html><html><body style="font-family:system-ui;max-width:720px;margin:2rem auto">
      <h1>Laiba Badar 🍽️</h1><p>Brand restaurant API on :${PORT}</p>
      <p><a href="/menu">Menu JSON</a> · <a href="/capabilities">Capabilities</a></p></body></html>`);
  }
  json(res, 404, { ok: false, error: "not_found" });
}).listen(PORT, "127.0.0.1", () => console.log(`Laiba Badar v2 http://127.0.0.1:${PORT}`));
