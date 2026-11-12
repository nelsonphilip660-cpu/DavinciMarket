import { db, auth } from "./firebase.js";
import { openProductGallery } from "./product-gallery.js";
import { MARKETPLACE_CATEGORIES } from "./categories.js";

import {
    collection,
    getDocs,
    query,
    where
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

// ELEMENTS
const grid = document.getElementById("productGrid");
const status = document.getElementById("productStatus");
const search = document.getElementById("searchInput");
const category = document.getElementById("categoryFilter");
const stateFilter = document.getElementById("stateFilter");
const nigerianStates = Array.from(stateFilter?.options || []).map(option => option.value).filter(Boolean);

let products = [];

// FORMAT PRICE
const money = n =>
    new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 0
    }).format(n || 0);

// DISPLAY PRODUCTS
function render() {
    if (!grid) return;

    const term = (search?.value || "").toLowerCase();
    const cat = category?.value || "";
    const selectedState = (stateFilter?.value || "").toLowerCase();

    const shown = products.filter(p =>
        (!cat || p.category === cat) &&
        (!selectedState || productState(p) === selectedState) &&
        (`${p.name || ""} ${p.description || ""}`)
            .toLowerCase()
            .includes(term)
    );

    grid.innerHTML = "";

    if (!shown.length) {
        grid.innerHTML = `<p class="muted">${selectedState ? `No approved products found in ${stateFilter.value} yet.` : "No approved products found yet."}</p>`;
        return;
    }

    for (const p of shown) {
        const card = document.createElement("article");
        card.className = "product-card";

        const image = document.createElement("div");
        image.className = "product-image";

        const sellerBadge = document.createElement("span");
        sellerBadge.className = "product-seller-badge";
        sellerBadge.textContent = p.sellerName || p.sellerEmail?.split("@")[0] || "DavinciMarket Seller";

        if (p.imageUrl) {
            const img = document.createElement("img");

            img.src = p.imageUrl;
            img.alt = p.name || "Product";
            img.loading = "lazy";

            img.onerror = () => {
                image.textContent = "Product image unavailable";
            };

            image.append(img);
        } else {
            image.textContent = "DavinciMarket";
        }
        image.append(sellerBadge);

        const photoButton = document.createElement("button");
        photoButton.type = "button";
        photoButton.className = "view-more-photos";
        photoButton.textContent = "View more";
        photoButton.setAttribute("aria-label", `View photos of ${p.name || "product"}`);
        photoButton.addEventListener("click", () => openProductGallery(p.imageUrls?.length ? p.imageUrls : [p.imageUrl], p.name));
        image.append(photoButton);

        const info = document.createElement("div");
        info.className = "product-info";

        const catP = document.createElement("div");
        catP.className = "eyebrow";
        catP.textContent = p.category || "Other";

        const h = document.createElement("h3");
        h.textContent = p.name || "Unnamed product";

        const desc = document.createElement("p");
        desc.textContent = p.description || "";

        const bottom = document.createElement("div");
        bottom.className = "card-bottom";

        const price = document.createElement("span");
        price.className = "price";
        price.textContent = money(p.price);

        const btn = document.createElement("button");
        btn.className = "add-button";
        btn.textContent = "Add to cart";

        btn.addEventListener("click", () => addToCart(p));

        bottom.append(price, btn);
        info.append(catP, h, desc, bottom);
        card.append(image, info);

        grid.append(card);
    }
}

function productState(product) {
    const location = String(product.sellerState || product.state || product.sellerLocation || "").toLowerCase();
    return nigerianStates.find(state => {
        const escaped = state.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(location);
    })?.toLowerCase() || "";
}

// ADD TO CART
function addToCart(p) {
    let cart = [];

    try {
        cart = JSON.parse(localStorage.getItem("dm_cart") || "[]");

        if (!Array.isArray(cart)) cart = [];
    } catch {
        cart = [];
    }

    const item = cart.find(x => x.id === p.id);

    if (item) {
        item.quantity++;
    } else {
        cart.push({
            id: p.id,
            name: p.name,
            price: Number(p.price),
            imageUrl: p.imageUrl || "",
            sellerId: p.sellerId,
            quantity: 1
        });
    }

    localStorage.setItem("dm_cart", JSON.stringify(cart));
    localStorage.setItem("davinciMarketCart", JSON.stringify(cart));

    const count = document.getElementById("cartCount");

    if (count) {
        count.textContent = cart.reduce(
            (sum, x) => sum + x.quantity,
            0
        );
    }

    alert("Added to cart.");
}

// LOAD APPROVED PRODUCTS FROM FIRESTORE
async function load() {
    if (!grid) return;

    try {
        status.textContent = "Loading products...";

        const productsQuery = query(
            collection(db, "products"),
            where("status", "==", "approved"),
            where("active", "==", true)
        );

        const snap = await getDocs(productsQuery);

        products = snap.docs.map(d => ({
            id: d.id,
            ...d.data()
        }));

        // Keep products with valid prices
        products = products.filter(p =>
            Number.isFinite(Number(p.price)) &&
            Number(p.price) >= 0
        );

        status.textContent = `${products.length} products`;

        // Populate category options
        if (category) {
            const categories = [...new Set([
                ...MARKETPLACE_CATEGORIES,
                ...products.map(p => p.category).filter(Boolean)
            ])];

            category.innerHTML =
                '<option value="">All Categories</option>';

            categories.forEach(cat => {
                const option = document.createElement("option");

                option.value = cat;
                option.textContent = cat;

                category.append(option);
            });
        }

        render();

    } catch (error) {
        console.error("DAVINCIMARKET FIRESTORE ERROR:", error);

        status.textContent = "Could not load products";

        grid.innerHTML = "";

        const errorMessage = document.createElement("p");
        errorMessage.className = "muted";
        errorMessage.textContent =
            `Firebase error: ${error.code || "unknown"} - ${error.message}`;

        grid.append(errorMessage);
    }
}

// SEARCH AND CATEGORY FILTER
search?.addEventListener("input", render);
category?.addEventListener("change", render);
stateFilter?.addEventListener("change", render);

// INITIALISE
onAuthStateChanged(auth, () => {
    load();
});
