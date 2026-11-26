import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const CURRENCY = process.env.CURRENCY || "usd";
const SECRET_KEY = process.env.STRIPE_SECRET_KEY;

// Faqat elektr qurilmalari kategoriyalari (DummyJSON ochiq API)
const CATEGORIES = {
  smartphones: "Smartfonlar",
  laptops: "Noutbuklar",
  tablets: "Planshetlar",
  "mobile-accessories": "Aksessuarlar",
};

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
      return data.products.map((p) => ({ ...p, category: cat, categoryName: CATEGORIES[cat] }));
    })
  );
  cache = { at: Date.now(), products: lists.flat() };
  return cache.products;
}

app.use(express.json({ limit: "50kb" }));
app.use(express.static("public"));

app.get("/api/categories", (_req, res) => res.json(CATEGORIES));

app.get("/api/products", async (_req, res) => {
  try {
    res.json(await loadProducts());
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// To'lov: narxlar mijozdan emas, serverdagi ma'lumotlardan hisoblanadi
app.post("/api/checkout", async (req, res) => {
  if (!SECRET_KEY) return res.status(500).json({ error: "To'lov kaliti sozlanmagan (.env)" });
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length || items.length > 50) return res.status(400).json({ error: "Savatcha bo'sh" });

  try {
    const products = await loadProducts();
    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("success_url", `${BASE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`);
    params.append("cancel_url", `${BASE_URL}/#cart`);

    items.forEach((it, i) => {
      const p = products.find((x) => x.id === Number(it.id));
      const qty = Math.floor(Number(it.qty));
      if (!p || !(qty >= 1 && qty <= 20)) throw Object.assign(new Error("Noto'g'ri mahsulot"), { status: 400 });
      const unit = Math.round(p.price * (1 - (p.discountPercentage || 0) / 100) * 100);
      params.append(`line_items[${i}][quantity]`, String(qty));
      params.append(`line_items[${i}][price_data][currency]`, CURRENCY);
      params.append(`line_items[${i}][price_data][unit_amount]`, String(unit));
      params.append(`line_items[${i}][price_data][product_data][name]`, p.title);
      params.append(`line_items[${i}][price_data][product_data][images][0]`, p.thumbnail);
    });

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || "To'lov tizimi xatosi" });
    res.json({ url: data.url });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// To'lov holatini tekshirish
app.get("/api/session/:id", async (req, res) => {
  if (!/^cs_[A-Za-z0-9_]+$/.test(req.params.id)) return res.status(400).json({ error: "Noto'g'ri ID" });
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${req.params.id}`, {
    headers: { Authorization: `Bearer ${SECRET_KEY}` },
  });
  const d = await r.json();
  if (!r.ok) return res.status(502).json({ error: d?.error?.message });
  res.json({ status: d.payment_status, amount: d.amount_total, currency: d.currency, email: d.customer_details?.email });
});

app.listen(PORT, () => console.log(`Elektro Market: ${BASE_URL}`));
