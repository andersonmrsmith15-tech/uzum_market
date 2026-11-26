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
  $("#cartTotal").textContent = money(entries.reduce((s, e) => s + finalPrice(e.p) * e.qty, 0));
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

async function checkout() {
  const btn = $("#checkoutBtn");
  btn.disabled = true;
  btn.textContent = "Yuborilmoqda…";
  $("#checkoutErr").textContent = "";
  try {
    const items = Object.entries(cart).map(([id, qty]) => ({ id: +id, qty }));
    const r = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    location.href = d.url;
  } catch (e) {
    $("#checkoutErr").textContent = e.message || "Xatolik yuz berdi";
    btn.disabled = false;
    btn.textContent = "To'lovga o'tish";
  }
}

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
