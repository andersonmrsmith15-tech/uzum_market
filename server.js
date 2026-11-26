import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
// To'lov tizimi: Fake Click Pay (lokal, /Users/akbarali/Documents/Vibe Projects/Click)
const CLICKPAY_URL = (process.env.CLICKPAY_URL || "http://localhost:4000").replace(/\/$/, "");
const CLICKPAY_KEY = process.env.CLICKPAY_API_KEY;
// Mahsulot narxlari dollarda, to'lov so'mda yechiladi
const USD_UZS_RATE = Number(process.env.USD_UZS_RATE || 12800);
// Demo: SMS o'rniga tasdiqlash kodini sahifada ko'rsatish
const SHOW_DEMO_OTP = (process.env.SHOW_DEMO_OTP || "true") === "true";

// Faqat elektr qurilmalari kategoriyalari (DummyJSON ochiq API)
const CATEGORIES = {
  smartphones: "Smartfonlar",
  laptops: "Noutbuklar",
  tablets: "Planshetlar",
  "mobile-accessories": "Aksessuarlar",
};

// Rasmlar CDN'i IP bo'yicha so'rovlarni cheklaydi va keshlashni taqiqlaydi,
// shuning uchun rasmlarni server orqali bir marta yuklab, xotiradan beramiz.
const IMG_HOST = "https://cdn.dummyjson.com/";
const toLocal = (u) => (u?.startsWith(IMG_HOST) ? "/img/" + u.slice(IMG_HOST.length) : u);
const imgCache = new Map(); // path -> Promise<{type, buf}>

async function fetchImage(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(IMG_HOST + path);
    if (r.ok) return { type: r.headers.get("content-type") || "image/webp", buf: Buffer.from(await r.arrayBuffer()) };
    if (r.status !== 429 && r.status < 500) throw new Error(String(r.status));
    await new Promise((s) => setTimeout(s, 1000 * (attempt + 1)));
  }
  throw new Error("Rasm yuklanmadi");
}

let cache = { at: 0, products: [] };
const CACHE_MS = 60 * 60 * 1000;

async function loadProducts() {
  if (cache.products.length && Date.now() - cache.at < CACHE_MS) return cache.products;
  const fields = "id,title,description,price,discountPercentage,rating,stock,brand,thumbnail,images,category";
  const lists = await Promise.all(
    Object.keys(CATEGORIES).map(async (cat) => {
      const r = await fetch(`https://dummyjson.com/products/category/${cat}?limit=0&select=${fields}`);
      if (!r.ok) throw new Error(`Mahsulotlarni yuklab bo'lmadi: ${cat}`);
      const data = await r.json();
      return data.products.map((p) => ({
        ...p,
        category: cat,
        categoryName: CATEGORIES[cat],
        remoteThumbnail: p.thumbnail, // to'lov sahifasi uchun asl manzil
        thumbnail: toLocal(p.thumbnail),
        images: (p.images || []).map(toLocal),
      }));
    })
  );
  cache = { at: Date.now(), products: lists.flat() };
  return cache.products;
}

app.use(express.json({ limit: "50kb" }));
app.use(express.static("public"));

app.get(/^\/img\/(product-images\/[\w\-./]+\.(?:webp|png|jpe?g))$/, async (req, res) => {
  const path = req.params[0];
  if (path.includes("..")) return res.sendStatus(400);
  if (!imgCache.has(path)) imgCache.set(path, fetchImage(path).catch((e) => (imgCache.delete(path), Promise.reject(e))));
  try {
    const { type, buf } = await imgCache.get(path);
    res.set({ "Content-Type": type, "Cache-Control": "public, max-age=604800, immutable" }).send(buf);
  } catch {
    res.sendStatus(502);
  }
});

app.get("/api/categories", (_req, res) => res.json(CATEGORIES));

app.get("/api/products", async (_req, res) => {
  try {
    res.json(await loadProducts());
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ===================== To'lov: Fake Click Pay =====================
// Narxlar mijozdan emas, serverdagi ma'lumotlardan hisoblanadi.
// Karta ma'lumotlari do'konda saqlanmaydi — faqat to'lov tizimiga uzatiladi.

const ORDERS_FILE = path.join(process.cwd(), "data", "orders.json");
fs.mkdirSync(path.dirname(ORDERS_FILE), { recursive: true });
const orders = new Map(fs.existsSync(ORDERS_FILE) ? Object.entries(JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"))) : []);
const saveOrders = () => fs.writeFileSync(ORDERS_FILE, JSON.stringify(Object.fromEntries(orders), null, 2));

const FRIENDLY = {
  CARD_NOT_FOUND: "Karta topilmadi yoki amal qilish muddati noto'g'ri",
  INVALID_CARD_NUMBER: "Karta raqami 16 ta raqamdan iborat bo'lishi kerak",
  INVALID_EXPIRY: "Amal qilish muddatini MM/YY ko'rinishida kiriting",
  CARD_EXPIRED: "Karta muddati o'tgan",
  CARD_BLOCKED: "Karta bloklangan",
  INSUFFICIENT_FUNDS: "Kartada mablag' yetarli emas",
  INVALID_OTP: "SMS kod noto'g'ri",
  OTP_EXPIRED: "SMS kod muddati o'tdi. Qaytadan urinib ko'ring",
  OTP_ATTEMPTS_EXCEEDED: "Urinishlar soni tugadi. To'lov bekor qilindi, qaytadan boshlang",
};

class PayError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

async function clickpay(method, path, body) {
  if (!CLICKPAY_KEY) throw new PayError(500, "To'lov tizimi sozlanmagan (.env: CLICKPAY_API_KEY)");
  let r, data;
  try {
    r = await fetch(CLICKPAY_URL + "/api/v1" + path, {
      method,
      headers: { "Content-Type": "application/json", "X-API-Key": CLICKPAY_KEY },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    data = await r.json();
  } catch (e) {
    console.error("Fake Click Pay bilan aloqa yo'q:", e.message);
    throw new PayError(502, "To'lov vaqtincha ishlamayapti. Keyinroq urinib ko'ring.");
  }
  if (!r.ok || data.ok === false) {
    const code = data?.error?.code;
    console.error("Fake Click Pay xatosi:", r.status, code, data?.error?.message);
    // Kalit/tizim xatolari xaridorga ko'rsatilmaydi
    throw new PayError(FRIENDLY[code] ? 400 : 502, FRIENDLY[code] || "To'lov vaqtincha ishlamayapti. Keyinroq urinib ko'ring.", code);
  }
  return data;
}

const uzs = (usd) => Math.round(usd * USD_UZS_RATE);
const publicOrder = (o) => ({
  order_id: o.id, status: o.status, amount_uzs: o.amount_uzs, amount_usd: o.amount_usd,
  card: o.card, items: o.items, created_at: o.created_at, paid_at: o.paid_at,
});
function getOrder(id) {
  const o = orders.get(String(id || ""));
  if (!o) throw new PayError(404, "Buyurtma topilmadi");
  return o;
}
const sendErr = (res, e) => res.status(e.status || 500).json({ error: e.message, code: e.code });

app.get("/api/config", (_req, res) => res.json({ usd_uzs_rate: USD_UZS_RATE }));

// 1-qadam: buyurtma yaratish va to'lovni boshlash -> SMS kod yuboriladi
app.post("/api/checkout", async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length || items.length > 50) throw new PayError(400, "Savatcha bo'sh");
    const card_number = String(req.body?.card_number || "").replace(/\D/g, "");
    const expiry = String(req.body?.expiry || "").trim();
    if (card_number.length !== 16) throw new PayError(400, FRIENDLY.INVALID_CARD_NUMBER);
    if (!/^\d{2}\/?\d{2}$/.test(expiry)) throw new PayError(400, FRIENDLY.INVALID_EXPIRY);

    const products = await loadProducts();
    const lines = items.map((it) => {
      const p = products.find((x) => x.id === Number(it.id));
      const qty = Math.floor(Number(it.qty));
      if (!p || !(qty >= 1 && qty <= 20)) throw new PayError(400, "Noto'g'ri mahsulot");
      const unit = Math.round(p.price * (1 - (p.discountPercentage || 0) / 100) * 100) / 100;
      return { id: p.id, title: p.title, qty, unit_usd: unit, unit_uzs: uzs(unit) };
    });

    const order = {
      id: "EM-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(4).toString("hex").toUpperCase(),
      items: lines,
      amount_usd: Math.round(lines.reduce((s, l) => s + l.unit_usd * l.qty, 0) * 100) / 100,
      amount_uzs: lines.reduce((s, l) => s + l.unit_uzs * l.qty, 0),
      card: "•••• " + card_number.slice(-4),
      status: "pending",
      created_at: new Date().toISOString(),
    };

    const data = await clickpay("POST", "/payments", {
      card_number, expiry, amount: order.amount_uzs, order_id: order.id,
      description: `Elektro Market: ${lines.length} xil mahsulot`,
    });
    order.payment_id = data.payment.payment_id;
    orders.set(order.id, order);
    saveOrders();

    res.json({
      order: publicOrder(order),
      otp_expires_at: data.payment.otp_expires_at,
      // DEMO: haqiqiy tizimda kod SMS orqali keladi
      ...(SHOW_DEMO_OTP && data.otp_code ? { demo_otp: data.otp_code } : {}),
    });
  } catch (e) {
    if (!(e instanceof PayError)) console.error(e);
    sendErr(res, e instanceof PayError ? e : new PayError(500, "Xatolik yuz berdi"));
  }
});

// 2-qadam: SMS kod bilan tasdiqlash -> pul yechiladi
app.post("/api/checkout/confirm", async (req, res) => {
  try {
    const o = getOrder(req.body?.order_id);
    if (o.status === "paid") return res.json({ order: publicOrder(o) });
    if (o.status !== "pending") throw new PayError(409, "Bu buyurtma uchun to'lov yakunlangan. Qaytadan boshlang");
    const otp = String(req.body?.otp || "").trim();
    if (!/^\d{6}$/.test(otp)) throw new PayError(400, "6 xonali SMS kodni kiriting");
    try {
      const { payment } = await clickpay("POST", `/payments/${o.payment_id}/confirm`, { otp });
      if (payment.status === "completed") { o.status = "paid"; o.paid_at = payment.completed_at; }
    } catch (e) {
      // Qayta urinib bo'lmaydigan xatolar -> buyurtma yopiladi
      if (["OTP_EXPIRED", "OTP_ATTEMPTS_EXCEEDED", "INSUFFICIENT_FUNDS", "CARD_BLOCKED"].includes(e.code)) o.status = "failed";
      saveOrders();
      throw e;
    }
    saveOrders();
    res.json({ order: publicOrder(o) });
  } catch (e) {
    sendErr(res, e instanceof PayError ? e : new PayError(500, "Xatolik yuz berdi"));
  }
});

// SMS kodni qayta yuborish
app.post("/api/checkout/resend", async (req, res) => {
  try {
    const o = getOrder(req.body?.order_id);
    if (o.status !== "pending") throw new PayError(409, "Bu buyurtma uchun to'lov yakunlangan");
    const data = await clickpay("POST", `/payments/${o.payment_id}/resend-otp`);
    res.json({ ok: true, ...(SHOW_DEMO_OTP && data.otp_code ? { demo_otp: data.otp_code } : {}) });
  } catch (e) {
    sendErr(res, e instanceof PayError ? e : new PayError(500, "Xatolik yuz berdi"));
  }
});

// Buyurtma holati (natija sahifasi uchun)
app.get("/api/orders/:id", (req, res) => {
  try { res.json(publicOrder(getOrder(req.params.id))); } catch (e) { sendErr(res, e); }
});

app.listen(PORT, () => console.log(`Elektro Market: ${BASE_URL}`));
