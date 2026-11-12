import { auth } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

const itemsEl = document.getElementById("cartItems");
const subtotalEl = document.getElementById("subtotal");
const totalEl = document.getElementById("total");
const message = document.getElementById("checkoutMessage");
const checkout = document.getElementById("checkoutBtn");

let user = null;
let authReady = false;

const money = amount =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0
  }).format(Number(amount) || 0);

// Keep the cart compatible with checkout.js
function getCart() {
  try {
    const primary = JSON.parse(localStorage.getItem("davinciMarketCart") || "[]");
    const legacy = JSON.parse(localStorage.getItem("dm_cart") || "[]");
    const cart = Array.isArray(primary) && primary.length
      ? primary
      : (Array.isArray(legacy) ? legacy : []);
    // Keep both keys aligned so checkout and older pages see the same cart.
    localStorage.setItem("davinciMarketCart", JSON.stringify(cart));
    localStorage.setItem("dm_cart", JSON.stringify(cart));
    return cart;
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem("dm_cart", JSON.stringify(cart));
  localStorage.setItem("davinciMarketCart", JSON.stringify(cart));
  renderCart();
}

function renderCart() {
  if (!itemsEl) return;

  const cart = getCart();

  itemsEl.innerHTML = "";

  if (cart.length === 0) {
    itemsEl.textContent =
      "Your cart is empty. Visit the marketplace to add products.";
  }

  let subtotal = 0;

  cart.forEach((product, index) => {
    const price = Number(product.price) || 0;
    const quantity = Math.max(
      1,
      Number(product.quantity) || 1
    );

    subtotal += price * quantity;

    const row = document.createElement("div");
    row.className = "cart-line";

    const thumb = document.createElement("div");
    thumb.className = "cart-thumb";

    if (product.imageUrl) {
      const image = document.createElement("img");
      image.src = product.imageUrl;
      image.alt = product.name || "Product";
      thumb.appendChild(image);
    } else {
      thumb.textContent = "DM";
    }

    const details = document.createElement("div");

    const name = document.createElement("h3");
    name.textContent = product.name || "Unnamed product";

    const priceText = document.createElement("p");
    priceText.textContent = money(price);

    const quantityText = document.createElement("p");
    quantityText.className = "small muted";
    quantityText.textContent = `Quantity: ${quantity}`;

    details.append(name, priceText, quantityText);

    const remove = document.createElement("button");
    remove.className = "remove-button";
    remove.textContent = "Remove";

    remove.addEventListener("click", () => {
      const updatedCart = getCart();
      updatedCart.splice(index, 1);
      saveCart(updatedCart);
    });

    row.append(thumb, details, remove);
    itemsEl.appendChild(row);
  });

  if (subtotalEl) {
    subtotalEl.textContent = money(subtotal);
  }

  if (totalEl) {
    totalEl.textContent = money(subtotal);
  }

  if (checkout) {
    checkout.disabled = cart.length === 0 || !authReady;
  }
}

onAuthStateChanged(auth, currentUser => {
  user = currentUser;
  authReady = true;
  renderCart();
});

checkout?.addEventListener("click", () => {
  if (!authReady) {
    message.textContent = "Checking your login. Please wait...";
    return;
  }

  if (!user) {
    window.location.href =
      "login.html?redirect=checkout.html";
    return;
  }

  const cart = getCart();

  if (!cart.length) {
    message.textContent = "Your cart is empty.";
    return;
  }

  // Save the cart using the key expected by checkout.js
  localStorage.setItem(
    "davinciMarketCart",
    JSON.stringify(cart)
  );

  localStorage.setItem(
    "dm_cart",
    JSON.stringify(cart)
  );

  message.textContent = "Opening your secure checkout...";

  window.location.href = "checkout.html";
});

renderCart();

window.addEventListener("storage", renderCart);
