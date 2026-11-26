const $ = (s) => document.querySelector(s);
const money = (n) => "$" + n.toFixed(2);
const finalPrice = (p) => p.price * (1 - (p.discountPercentage || 0) / 100);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let products = [];
let categories = {};
let state = { cat: "", q: "", sort: "" };
let cart = JSON.parse(localStorage.getItem("cart") || "{}"); // { id: qty }

async function init() {
  try {
    [categories, products] = await Promise.all([
      fetch("/api/categories").then((r) => r.json()),
      fetch("/api/products").then((r) => r.json()),
    ]);
    rate = (await fetch("/api/config").then((r) => r.json())).usd_uzs_rate || rate;
    if (!Array.isArray(products)) throw new Error(products.error);
  } catch (e) {
    $("#grid").innerHTML = `<p class="err">Mahsulotlarni yuklab bo'lmadi: ${esc(e.message)}</p>`;
    return;
  }
  renderCats();
  renderGrid();
  renderCart();
  if (location.hash === "#cart") openCart();
}

function renderCats() {
  const all = [["", "Barchasi"], ...Object.entries(categories)];
  $("#cats").innerHTML = all
    .map(([k, v]) => `<button data-cat="${k}" class="${state.cat === k ? "active" : ""}">${esc(v)}</button>`)
    .join("");
}

function filtered() {
  let list = products.filter(
    (p) =>
      (!state.cat || p.category === state.cat) &&
      (!state.q || (p.title + " " + (p.brand || "")).toLowerCase().includes(state.q))
  );
  if (state.sort === "price-asc") list.sort((a, b) => finalPrice(a) - finalPrice(b));
  if (state.sort === "price-desc") list.sort((a, b) => finalPrice(b) - finalPrice(a));
  if (state.sort === "rating") list.sort((a, b) => b.rating - a.rating);
  return list;
}

function renderGrid() {
  const list = filtered();
  $("#resultInfo").textContent = `${list.length} ta mahsulot`;
  $("#grid").innerHTML = list.length
    ? list
        .map(
          (p) => `
      <article class="card" data-open="${p.id}">
        <div class="img">
          ${p.discountPercentage >= 1 ? `<span class="badge">-${Math.round(p.discountPercentage)}%</span>` : ""}
          <img src="${esc(p.thumbnail)}" alt="${esc(p.title)}" loading="lazy" />
        </div>
        <div class="body">
          <span class="muted">${esc(p.brand || p.categoryName)} · ★ ${p.rating.toFixed(1)}</span>
          <h3>${esc(p.title)}</h3>
          <div class="price">${money(finalPrice(p))}${p.discountPercentage >= 1 ? `<span class="old">${money(p.price)}</span>` : ""}</div>
          <button class="primary add" data-add="${p.id}">Savatchaga</button>
        </div>
      </article>`
        )
        .join("")
    : `<p class="muted">Hech narsa topilmadi</p>`;
}

function openProduct(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  const imgs = p.images?.length ? p.images : [p.thumbnail];
  $("#productBody").innerHTML = `
    <div class="pm">
      <button class="icon close" data-close>✕</button>
      <div>
        <img class="main-img" src="${esc(imgs[0])}" alt="${esc(p.title)}" />
        <div class="thumbs">${imgs.map((u, i) => `<img src="${esc(u)}" data-img="${esc(u)}" class="${i ? "" : "on"}" />`).join("")}</div>
      </div>
      <div>
        <span class="muted">${esc(p.categoryName)} · ${esc(p.brand || "")}</span>
        <h2>${esc(p.title)}</h2>
        <p class="muted">★ ${p.rating.toFixed(1)} · Omborda: ${p.stock} dona</p>
        <div class="price">${money(finalPrice(p))}${p.discountPercentage >= 1 ? `<span class="old">${money(p.price)}</span>` : ""}</div>
        <p>${esc(p.description)}</p>
        <button class="primary wide" data-add="${p.id}">Savatchaga qo'shish</button>
      </div>
    </div>`;
  $("#productModal").showModal();
}

// ---- Savatcha ----
function saveCart() {
  localStorage.setItem("cart", JSON.stringify(cart));
  renderCart();
}
function addToCart(id) {
  cart[id] = Math.min((cart[id] || 0) + 1, 20);
  saveCart();
}
function renderCart() {
  const entries = Object.entries(cart)
    .map(([id, qty]) => ({ p: products.find((x) => x.id === +id), qty }))
    .filter((e) => e.p);
  $("#cartCount").textContent = entries.reduce((s, e) => s + e.qty, 0);
  $("#cartTotal").innerHTML = esc(money(entries.reduce((s, e) => s + finalPrice(e.p) * e.qty, 0))) +
    (entries.length ? `<span class="sum-uzs">${esc(som(cartUzs()))}</span>` : "");
  $("#checkoutBtn").disabled = !entries.length;
  $("#cartItems").innerHTML = entries.length
    ? entries
        .map(
          ({ p, qty }) => `
      <div class="ci">
        <img src="${esc(p.thumbnail)}" alt="" />
        <div>
          <div class="t">${esc(p.title)}</div>
          <div class="qty">
            <button data-dec="${p.id}">−</button><b>${qty}</b><button data-inc="${p.id}">+</button>
          </div>
        </div>
        <div>
          <b>${money(finalPrice(p) * qty)}</b><br />
          <button class="icon" data-del="${p.id}" title="O'chirish">🗑</button>
        </div>
      </div>`
        )
        .join("")
    : `<p class="muted">Savatcha bo'sh</p>`;
}
function openCart() {
  $("#cart").classList.add("open");
  $("#overlay").classList.add("show");
}
function closeCart() {
  $("#cart").classList.remove("open");
  $("#overlay").classList.remove("show");
  if (location.hash === "#cart") history.replaceState(null, "", location.pathname);
}

// ---- To'lov (Fake Click Pay) ----
let rate = 12800; // 1 USD -> so'm, serverdan olinadi
const som = (n) => Math.round(n).toLocaleString("ru-RU").replace(/,/g, " ") + " so'm";
const cartEntries = () => Object.entries(cart).map(([id, qty]) => ({ p: products.find((x) => x.id === +id), qty })).filter((e) => e.p);
// Server bilan bir xil hisob: har bir dona narxi so'mga yaxlitlanadi
const cartUzs = () => cartEntries().reduce((s, { p, qty }) => s + Math.round(Math.round(finalPrice(p) * 100) / 100 * rate) * qty, 0);
let pay = { orderId: null };

function checkout() {
  closeCart();
  $("#paySum").textContent = som(cartUzs());
  $("#paySumUsd").textContent = `≈ ${$("#cartTotal").firstChild?.textContent || ""} · kurs 1$ = ${som(rate)}`;
  showStep("card");
  $("#payModal").showModal();
  $("#cardNumber").focus();
}

function showStep(step) {
  $("#cardStep").hidden = step !== "card";
  $("#otpStep").hidden = step !== "otp";
  $("#cardErr").textContent = $("#otpErr").textContent = "";
}

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  if (label) btn.textContent = busy ? "Kutilmoqda…" : label;
}

function showDemoOtp(code) {
  const el = $("#demoOtp");
  el.hidden = !code;
  if (code) el.innerHTML = `🧪 Demo rejim: SMS o'rniga kod shu yerda — <b>${esc(code)}</b>`;
}

async function postJSON(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || "Xatolik yuz berdi"), { code: d.code });
  return d;
}

$("#cardNumber").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
});
$("#cardExpiry").addEventListener("input", (e) => {
  const v = e.target.value.replace(/\D/g, "").slice(0, 4);
  e.target.value = v.length > 2 ? v.slice(0, 2) + "/" + v.slice(2) : v;
});
$("#otpInput").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });

$("#cardStep").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#payBtn");
  setBusy(btn, true, "Davom etish");
  $("#cardErr").textContent = "";
  try {
    const items = Object.entries(cart).map(([id, qty]) => ({ id: +id, qty }));
    const d = await postJSON("/api/checkout", { items, card_number: $("#cardNumber").value, expiry: $("#cardExpiry").value });
    pay.orderId = d.order.order_id;
    $("#paySum").textContent = som(d.order.amount_uzs);
    $("#otpCard").textContent = d.order.card;
    showDemoOtp(d.demo_otp);
    $("#otpInput").value = "";
    showStep("otp");
    $("#otpInput").focus();
  } catch (err) {
    $("#cardErr").textContent = err.message;
  } finally {
    setBusy(btn, false, "Davom etish");
  }
});

$("#otpStep").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#otpBtn");
  setBusy(btn, true, "Tasdiqlash va to'lash");
  $("#otpErr").textContent = "";
  try {
    const d = await postJSON("/api/checkout/confirm", { order_id: pay.orderId, otp: $("#otpInput").value });
    if (d.order.status === "paid") {
      cart = {};
      saveCart();
      location.href = "/success.html?order=" + encodeURIComponent(d.order.order_id);
      return;
    }
    $("#otpErr").textContent = "To'lov yakunlanmadi";
  } catch (err) {
    $("#otpErr").textContent = err.message;
    // Qayta urinib bo'lmaydigan xato -> karta bosqichiga qaytish
    if (["OTP_EXPIRED", "OTP_ATTEMPTS_EXCEEDED", "INSUFFICIENT_FUNDS", "CARD_BLOCKED"].includes(err.code)) {
      setTimeout(() => { showStep("card"); $("#cardErr").textContent = err.message; }, 1800);
    }
  } finally {
    setBusy(btn, false, "Tasdiqlash va to'lash");
  }
});

$("#resendBtn").addEventListener("click", async (e) => {
  const btn = e.target;
  btn.disabled = true;
  try {
    const d = await postJSON("/api/checkout/resend", { order_id: pay.orderId });
    showDemoOtp(d.demo_otp);
    $("#otpErr").textContent = "";
    btn.textContent = "Kod yuborildi ✓";
    setTimeout(() => { btn.textContent = "Kodni qayta yuborish"; btn.disabled = false; }, 30000);
  } catch (err) {
    $("#otpErr").textContent = err.message;
    btn.disabled = false;
  }
});
$("#backBtn").addEventListener("click", () => showStep("card"));
$("#payClose").addEventListener("click", () => $("#payModal").close());

// ---- Hodisalar ----
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-add],[data-open],[data-cat],[data-inc],[data-dec],[data-del],[data-img],[data-close]");
  if (!t) return;
  const d = t.dataset;
  if (d.add) { e.stopPropagation(); addToCart(+d.add); const txt = t.textContent; t.textContent = "✓ Qo'shildi"; setTimeout(() => (t.textContent = txt), 900); return; }
  if (d.cat !== undefined) { state.cat = d.cat; renderCats(); renderGrid(); return; }
  if (d.inc) { cart[d.inc] = Math.min(cart[d.inc] + 1, 20); saveCart(); return; }
  if (d.dec) { cart[d.dec]--; if (cart[d.dec] <= 0) delete cart[d.dec]; saveCart(); return; }
  if (d.del) { delete cart[d.del]; saveCart(); return; }
  if (d.img) { t.closest(".pm").querySelector(".main-img").src = d.img; t.parentElement.querySelectorAll("img").forEach((i) => i.classList.toggle("on", i === t)); return; }
  if (d.close !== undefined) { $("#productModal").close(); return; }
  if (d.open) openProduct(+d.open);
});
$("#productModal").addEventListener("click", (e) => { if (e.target.id === "productModal") e.target.close(); });
$("#search").addEventListener("input", (e) => { state.q = e.target.value.trim().toLowerCase(); renderGrid(); });
$("#sort").addEventListener("change", (e) => { state.sort = e.target.value; renderGrid(); });
$("#cartBtn").addEventListener("click", openCart);
$("#closeCart").addEventListener("click", closeCart);
$("#overlay").addEventListener("click", closeCart);
$("#checkoutBtn").addEventListener("click", checkout);

// Rasm yuklanmasa — zaxira belgi
const FALLBACK_IMG = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f0f1f5"/><text x="50" y="60" font-size="36" text-anchor="middle">🔌</text></svg>'
);
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img.tagName === "IMG" && img.src !== FALLBACK_IMG) img.src = FALLBACK_IMG;
}, true);

init();
