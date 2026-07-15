/**
 * Laiba Badar v3 — restaurant parity + payments + undercut
 */
const http = require("http");
const { URL } = require("url");
const crypto = require("crypto");
const pay = require("./payments");
const PORT = process.env.PORT || 8788;
const uid = (p) => `${p}_${crypto.randomBytes(4).toString("hex")}`;
const iso = () => new Date().toISOString();

const MENU = [
  { id: "m1", name: "Chicken Karahi", category: "mains", price_pkr: 1199, competitor_price_pkr: 1600, prep_min: 30, popular: true },
  { id: "m2", name: "Mutton Handi", category: "mains", price_pkr: 1799, competitor_price_pkr: 2400, prep_min: 40, popular: true },
  { id: "m3", name: "Garlic Naan", category: "bread", price_pkr: 60, competitor_price_pkr: 90, prep_min: 8, popular: false },
  { id: "m4", name: "Gulab Jamun", category: "dessert", price_pkr: 180, competitor_price_pkr: 280, prep_min: 5, popular: true },
  { id: "m5", name: "Fresh Lime", category: "drinks", price_pkr: 90, competitor_price_pkr: 140, prep_min: 3, popular: false },
];
const ZONES = [
  { id: "z1", name: "DHA", fee_pkr: 50, eta_min: 35 },
  { id: "z2", name: "Gulberg", fee_pkr: 50, eta_min: 40 },
  { id: "z3", name: "Johar Town", fee_pkr: 60, eta_min: 50 },
];
const carts = {}, orders = {}, loyalty = {}, reservations = {}, giftCards = {};

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
    return json(res, 200, { ok: true, service: "laibabadar", version: "3.0.0", brand: "Laiba Badar",
      gaps_closed: ["reservations", "gift_cards", "scheduled_delivery", "multi_rail_pay", "undercut"] });
  }
  if (p === "/capabilities") return json(res, 200, { ok: true, competitor: "Foodpanda restaurant",
    features: ["menu","zones","cart","checkout","tracking","loyalty","reservations","gift_cards","scheduled","stripe","jazzcash"] });
  if (p === "/pricing") return json(res, 200, { ok: true, ...pay.pricing("laibabadar") });
  if (p === "/payments/rails") return json(res, 200, { ok: true, rails: pay.RAILS });
  if (p === "/gap-analysis") return json(res, 200, { ok: true, added: ["table reservation free", "gift cards", "scheduled delivery", "stripe+PK rails"] });
  if (p === "/menu") {
    const cat = u.searchParams.get("category");
    let rows = MENU; if (cat) rows = rows.filter(m => m.category === cat);
    return json(res, 200, { ok: true, menu: rows.map(m => ({...m, save_pkr: m.competitor_price_pkr - m.price_pkr})) });
  }
  if (p === "/zones") return json(res, 200, { ok: true, zones: ZONES, note: "Delivery fees undercut Foodpanda (~Rs50 vs ~120)" });
  if (p === "/cart") return json(res, 200, { ok: true, items: carts[u.searchParams.get("user") || "guest"] || [] });
  if (p === "/loyalty") return json(res, 200, { ok: true, points: loyalty[u.searchParams.get("user") || "guest"] || 0 });
  if (p === "/reservations") return json(res, 200, { ok: true, reservations: Object.values(reservations) });
  if (p === "/orders") {
    let rows = Object.values(orders);
    const user = u.searchParams.get("user"); if (user) rows = rows.filter(o => o.user === user);
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
  if (req.method === "POST" && p === "/reservations") {
    const b = await body(req);
    const id = uid("res");
    reservations[id] = { id, name: b.name, party_size: b.party_size || 2, at: b.at, phone: b.phone, fee_pkr: 0, status: "held", created: iso() };
    return json(res, 201, { ok: true, reservation: reservations[id], note: "Free hold vs competitors charging deposits" });
  }
  if (req.method === "POST" && p === "/gift-cards") {
    const b = await body(req);
    const amount = Number(b.amount_pkr) || 1000;
    const inv = await pay.createInvoice({ product: "laibabadar", amount, currency: "PKR", method: b.payment_method || "stripe", customer: b.user || "guest", description: "Gift card" });
    const id = uid("gc");
    giftCards[id] = { id, amount_pkr: amount, balance_pkr: amount, invoice: inv, code: id.slice(-8).toUpperCase() };
    return json(res, 201, { ok: true, gift_card: giftCards[id] });
  }
  if (req.method === "POST" && (p === "/checkout" || p === "/order")) {
    const b = await body(req);
    const user = b.user || "guest";
    const items = carts[user] || [];
    if (!items.length) return json(res, 400, { ok: false, error: "cart_empty" });
    const zone = ZONES.find(z => z.id === b.zone_id) || ZONES[0];
    const sub = items.reduce((s, i) => s + i.unit_price * i.qty, 0);
    const total = sub + zone.fee_pkr;
    const method = b.payment_method || "cod";
    const inv = await pay.createInvoice({ product: "laibabadar", amount: total, currency: "PKR", method, customer: user, description: "Laiba Badar order" });
    const id = uid("lb");
    const order = {
      id, user, items, zone, subtotal_pkr: sub, delivery_fee_pkr: zone.fee_pkr, total_pkr: total,
      payment_method: method, invoice_id: inv.id, payment: inv, address: b.address || "", phone: b.phone || "",
      status: "placed", eta_min: zone.eta_min, scheduled_for: b.scheduled_for || null,
      timeline: [{ status: "placed", at: iso() }], created_at: iso(),
    };
    orders[id] = order; carts[user] = [];
    loyalty[user] = (loyalty[user] || 0) + Math.floor(total / 80);
    return json(res, 201, { ok: true, order, loyalty_points: loyalty[user] });
  }
  if (req.method === "POST" && p.startsWith("/orders/") && p.endsWith("/advance")) {
    const o = orders[p.split("/")[2]]; if (!o) return json(res, 404, { ok: false });
    const seq = ["placed","confirmed","cooking","out_for_delivery","delivered"];
    const i = seq.indexOf(o.status);
    if (i >= 0 && i < seq.length - 1) { o.status = seq[i+1]; o.timeline.push({ status: o.status, at: iso() }); }
    return json(res, 200, { ok: true, order: o });
  }
  if (req.method === "POST" && p === "/payments/create") {
    const b = await body(req);
    const inv = await pay.createInvoice({ product: "laibabadar", amount: b.amount, currency: b.currency || "PKR", method: b.method || "stripe", sku: b.sku, customer: b.customer });
    return json(res, 201, { ok: true, invoice: inv });
  }
  json(res, 404, { ok: false });
}).listen(PORT, "127.0.0.1", () => console.log(`Laiba Badar v3 http://127.0.0.1:${PORT}`));
