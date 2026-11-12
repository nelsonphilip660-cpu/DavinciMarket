import { auth, db } from "./firebase.js";

import {
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
    collection,
    doc,
    getDoc,
    setDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// DAVINCIMARKET BANK TRANSFER CHECKOUT

const WHATSAPP_NUMBER = "2349037141652";
const ACCOUNT_NUMBER = "9037141652";

const form = document.getElementById("checkoutForm");
const message = document.getElementById("checkoutMessage");
const button = document.getElementById("placeOrderButton");

const checkoutItems = document.getElementById("checkoutItems");
const checkoutTotal = document.getElementById("checkoutTotal");

let currentUser = null;
let cart = [];
let authReady = false;

try {
    cart = JSON.parse(
        localStorage.getItem("davinciMarketCart")
    ) || [];

    if (!Array.isArray(cart)) cart = [];
} catch {
    cart = [];
}

function money(value) {
    return "₦" + Number(value).toLocaleString("en-NG");
}

// DISPLAY ORDER SUMMARY

function displayOrderSummary() {
    checkoutItems.innerHTML = "";

    if (!cart.length) {
        checkoutItems.innerHTML =
            "<p>Your cart is empty. Return to the shop.</p>";

        checkoutTotal.textContent = "₦0";
        button.disabled = true;
        return;
    }

    let total = 0;

    cart.forEach(item => {
        const price = Number(item.price);
        const quantity = Number(item.quantity);

        total += price * quantity;

        const row = document.createElement("div");
        row.className = "summary-item";

        const name = document.createElement("span");
        name.textContent = `${item.name} × ${quantity}`;

        const amount = document.createElement("strong");
        amount.textContent = money(price * quantity);

        row.append(name, amount);
        checkoutItems.appendChild(row);
    });

    checkoutTotal.textContent = money(total);
}

// COPY ACCOUNT NUMBER

document.getElementById("copyAccount").addEventListener(
    "click",
    async () => {
        try {
            await navigator.clipboard.writeText(ACCOUNT_NUMBER);

            document.getElementById("copyAccount").textContent =
                "Account number copied!";
        } catch {
            message.textContent =
                "Please copy the account number manually.";
        }
    }
);

// CHECK LOGIN

button.disabled = true;

onAuthStateChanged(auth, user => {
    authReady = true;

    if (!user) {
        window.location.href =
            "login.html?redirect=checkout.html";
        return;
    }

    currentUser = user;

    if (cart.length) {
        button.disabled = false;
    }
});

// SUBMIT ORDER

form.addEventListener("submit", async event => {
    event.preventDefault();

    if (!authReady || !currentUser) {
        message.textContent = "Please wait for your account to load.";
        return;
    }

    if (!cart.length) {
        message.textContent = "Your cart is empty.";
        return;
    }

    const name = document.getElementById("customerName").value.trim();
    const phone = document.getElementById("customerPhone").value.trim();
    const email = document.getElementById("customerEmail").value.trim();
    const address = document.getElementById("deliveryAddress").value.trim();
    const note = document.getElementById("deliveryNote").value.trim();

    button.disabled = true;
    button.textContent = "Processing order...";
    message.textContent = "";

    try {
        const verifiedItems = [];

        // VERIFY PRODUCTS FROM FIRESTORE

        for (const cartItem of cart) {
            const productRef = doc(db, "products", cartItem.id);

            const snapshot = await getDoc(productRef);

            if (!snapshot.exists()) {
                throw new Error(
                    `${cartItem.name} is no longer available.`
                );
            }

            const product = snapshot.data();

            const quantity = Number(cartItem.quantity);
            const price = Number(product.price);
            const stock = Number(product.stock);

            if (
                product.active !== true ||
                !Number.isFinite(price) ||
                !Number.isFinite(stock) ||
                !Number.isInteger(quantity) ||
                quantity < 1 ||
                quantity > stock
            ) {
                throw new Error(
                    `${product.name || cartItem.name} is unavailable or has insufficient stock.`
                );
            }

            verifiedItems.push({
                productId: cartItem.id,
                name: product.name || "Product",
                price,
                quantity,
                sellerId: product.sellerId || ""
            });
        }

        // CALCULATE VERIFIED TOTAL

        const total = verifiedItems.reduce(
            (sum, item) => sum + item.price * item.quantity,
            0
        );

        // GENERATE FIRESTORE ORDER ID

        const orderRef = doc(collection(db, "orders"));

        const order = {
            buyerId: currentUser.uid,

            customerName: name,
            customerPhone: phone,
            customerEmail: email,

            deliveryAddress: address,
            deliveryNote: note,

            items: verifiedItems,
            total,

            paymentMethod: "bank_transfer",
            paymentBank: "OPay",
            paymentAccountName: "Nelson Philip",
            paymentAccountNumber: ACCOUNT_NUMBER,

            paymentStatus: "pending",
            orderStatus: "pending",

            receiptSubmission: "WhatsApp",

            createdAt: serverTimestamp()
        };

        // SAVE ORDER TO FIRESTORE

        await setDoc(orderRef, order);

        // PREPARE WHATSAPP MESSAGE

        const whatsappMessage = `
Hello DavinciMarket Admin.

I have placed an order and want to submit my payment receipt.

ORDER DETAILS
Order ID: ${orderRef.id}

Customer: ${name}
Phone: ${phone}
Email: ${email}

DELIVERY ADDRESS
${address}

ORDER ITEMS
${verifiedItems.map(item =>
    `${item.name} x ${item.quantity} - ${money(item.price * item.quantity)}`
).join("\n")}

TOTAL AMOUNT: ${money(total)}

BANK: OPay
ACCOUNT NAME: Nelson Philip
ACCOUNT NUMBER: ${ACCOUNT_NUMBER}

I will attach my transfer receipt here for verification.

Please confirm my payment and process my order.

Thank you.
        `.trim();

        const whatsappURL =
            "https://wa.me/" +
            WHATSAPP_NUMBER +
            "?text=" +
            encodeURIComponent(whatsappMessage);

        // CLEAR CART AFTER SUCCESSFUL ORDER

        localStorage.removeItem("davinciMarketCart");
        localStorage.removeItem("dm_cart");
        cart = [];

        displayOrderSummary();

        message.textContent =
            `Order ${orderRef.id} created successfully. Opening WhatsApp...`;

        button.textContent = "Opening WhatsApp...";

        // OPEN WHATSAPP

        window.location.href = whatsappURL;

    } catch (error) {
        console.error("Checkout error:", error);

        message.textContent =
            error.message ||
            "Unable to submit order. Please try again.";

        button.disabled = false;
        button.textContent =
            "Place order & continue to WhatsApp";
    }
});

displayOrderSummary();
