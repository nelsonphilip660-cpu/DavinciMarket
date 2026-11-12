import { db } from "./firebase.js";

import {
    collection,
    getDocs,
    query,
    where
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { openProductGallery } from "./product-gallery.js";
import { MARKETPLACE_CATEGORIES } from "./categories.js";

const productGrid = document.getElementById("productGrid");
const productMessage = document.getElementById("productMessage");
const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const categoryFilter = document.getElementById("categoryFilter");

const cartPanel = document.getElementById("cartPanel");
const cartOverlay = document.getElementById("cartOverlay");
const cartButton = document.getElementById("cartButton");
const closeCart = document.getElementById("closeCart");
const cartItems = document.getElementById("cartItems");
const cartCount = document.getElementById("cartCount");
const cartTotal = document.getElementById("cartTotal");
const clearCartButton = document.getElementById("clearCart");

let products = [];

let cart = [];

try {
    const mainCart = JSON.parse(localStorage.getItem("davinciMarketCart") || "[]");
    const legacyCart = JSON.parse(localStorage.getItem("dm_cart") || "[]");
    cart = Array.isArray(mainCart) && mainCart.length ? mainCart : legacyCart;
    if (!Array.isArray(cart)) cart = [];
} catch {
    cart = [];
}

function escapeHTML(value = "") {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

function formatPrice(price) {
    return "₦" + Number(price || 0).toLocaleString("en-NG");
}

// FETCH PRODUCTS FROM FIREBASE
async function loadProducts() {
    productMessage.textContent = "Loading products...";

    try {const productsQuery = query(
    collection(db, "products"),
    where("status", "==", "approved"),
    where("active", "==", true)
);

        const snapshot = await getDocs(productsQuery);

        products = snapshot.docs.map(document => ({
            id: document.id,
            ...document.data()
        }));

        products = products.filter(product =>
            Number.isFinite(Number(product.price)) &&
            Number(product.price) >= 0
        );

        populateCategories();
        displayProducts(products);

   } catch (error) {
    console.error("PRODUCT LOADING ERROR:", error);

    productMessage.textContent =
        "Firebase Error: " + error.code + " - " + error.message;
}
}

// CREATE CATEGORY FILTER OPTIONS
function populateCategories() {
    const categories = [...new Set([
        ...MARKETPLACE_CATEGORIES,
        ...products.map(product => product.category).filter(Boolean)
    ])];

    categoryFilter.innerHTML =
        '<option value="all">All Categories</option>';

    categories.forEach(category => {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = category;
        categoryFilter.appendChild(option);
    });
}

// DISPLAY PRODUCT CARDS
function displayProducts(items) {
    productGrid.innerHTML = "";

    if (!items.length) {
        productMessage.textContent = "No products found.";
        return;
    }

    productMessage.textContent =
        `${items.length} product${items.length === 1 ? "" : "s"} found.`;

    items.forEach(product => {
        const card = document.createElement("article");
        card.className = "product-card";

        const image = product.imageUrl || "https://placehold.co/500x400?text=Product";

        const sellerName = product.sellerName || product.sellerEmail?.split("@")[0] || "DavinciMarket Seller";
        card.innerHTML = `
            <div class="product-image-wrap">
                <img
                    class="product-image"
                    src="${escapeHTML(image)}"
                    alt="${escapeHTML(product.name || "Product")}"
                    loading="lazy"
                >
                <span class="product-seller-badge">${escapeHTML(sellerName)}</span>
                <button class="view-more-photos" type="button" aria-label="View photos of ${escapeHTML(product.name || "product")}">View more</button>
            </div>

            <div class="product-info">
                <span class="product-category">
                    ${escapeHTML(product.category || "General")}
                </span>

                <h3>${escapeHTML(product.name || "Unnamed product")}</h3>

                <p class="product-description">
                    ${escapeHTML(product.description || "Available on DavinciMarket.")}
                </p>

                <p class="product-price">
                    ${formatPrice(product.price)}
                </p>

                <button
                    class="add-cart"
                    data-product-id="${escapeHTML(product.id)}"
                    ${Number(product.stock) <= 0 ? "disabled" : ""}
                >
                    ${Number(product.stock) <= 0 ? "Out of Stock" : "Add to Cart"}
                </button>
            </div>
        `;

        const productImage = card.querySelector(".product-image");
        card.querySelector(".view-more-photos").addEventListener("click", () => openProductGallery(product.imageUrls?.length ? product.imageUrls : [product.imageUrl], product.name));

        productImage.addEventListener("error", () => {
            productImage.src = "https://placehold.co/500x400?text=Image+Unavailable";
        }, { once: true });

        productGrid.appendChild(card);
    });
}

// SEARCH AND FILTER PRODUCTS
function filterProducts() {
    const keyword = searchInput.value.trim().toLowerCase();
    const category = categoryFilter.value;

    const filtered = products.filter(product => {
        const searchableText = [
            product.name,
            product.description,
            product.category
        ].join(" ").toLowerCase();

        const matchesKeyword = searchableText.includes(keyword);

        const matchesCategory =
            category === "all" || product.category === category;

        return matchesKeyword && matchesCategory;
    });

    displayProducts(filtered);
}

searchButton.addEventListener("click", filterProducts);

searchInput.addEventListener("input", filterProducts);

categoryFilter.addEventListener("change", filterProducts);

// ADD PRODUCT TO CART
productGrid.addEventListener("click", event => {
    const button = event.target.closest(".add-cart");

    if (!button) return;

    const product = products.find(item =>
        item.id === button.dataset.productId
    );

    if (!product) return;

    const existingItem = cart.find(item => item.id === product.id);

    const stock = Number(product.stock);

    if (existingItem) {
        if (existingItem.quantity >= stock) {
            alert("You have reached the available stock for this product.");
            return;
        }

        existingItem.quantity++;
    } else {
        cart.push({
            id: product.id,
            name: product.name || "Product",
            price: Number(product.price),
            imageUrl: product.imageUrl || "",
            quantity: 1,
            stock
        });
    }

    saveCart();
    alert("Product added to your cart!");
});

// SAVE CART
function saveCart() {
    localStorage.setItem(
        "davinciMarketCart",
        JSON.stringify(cart)
    );
    localStorage.setItem("dm_cart", JSON.stringify(cart));

    renderCart();
}

// DISPLAY CART
function renderCart() {
    cartItems.innerHTML = "";

    let total = 0;
    let quantityTotal = 0;

    if (!cart.length) {
        cartItems.innerHTML = "<p>Your cart is empty.</p>";
    }

    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;

        total += itemTotal;
        quantityTotal += item.quantity;

        const row = document.createElement("div");
        row.className = "cart-item";

        row.innerHTML = `
            <div>
                <strong>${escapeHTML(item.name)}</strong>
                <small>${item.quantity} × ${formatPrice(item.price)}</small>
            </div>

            <div>
                <strong>${formatPrice(itemTotal)}</strong>
                <button
                    class="remove-item"
                    data-remove-id="${escapeHTML(item.id)}"
                >
                    Remove
                </button>
            </div>
        `;

        cartItems.appendChild(row);
    });

    cartCount.textContent = quantityTotal;
    cartTotal.textContent = formatPrice(total);
}

// REMOVE ITEM
cartItems.addEventListener("click", event => {
    const button = event.target.closest(".remove-item");

    if (!button) return;

    cart = cart.filter(item => item.id !== button.dataset.removeId);

    saveCart();
});

// CLEAR CART
clearCartButton.addEventListener("click", () => {
    if (!cart.length) return;

    if (confirm("Are you sure you want to clear your cart?")) {
        cart = [];
        saveCart();
    }
});

// OPEN AND CLOSE CART
function openCart() {
    cartPanel.classList.add("open");
    cartOverlay.classList.add("show");
}

function closeCartPanel() {
    cartPanel.classList.remove("open");
    cartOverlay.classList.remove("show");
}

cartButton.addEventListener("click", openCart);
closeCart.addEventListener("click", closeCartPanel);
cartOverlay.addEventListener("click", closeCartPanel);

// FOOTER YEAR
document.getElementById("currentYear").textContent =
    new Date().getFullYear();

// INITIALISE
renderCart();
loadProducts();
