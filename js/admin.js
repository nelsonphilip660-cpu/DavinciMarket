/* =========================================
   DAVINCIMARKET ADMIN DASHBOARD
   Firebase Authentication + Firestore
   Product Approval + Bank Transfer Approval
========================================= */

import { auth, db } from "./firebase.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
    collection,
    getDocs,
    query,
    where,
    doc,
    getDoc,
    updateDoc,
    setDoc,
    writeBatch,
    serverTimestamp,
    runTransaction
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// =========================================
// HTML ELEMENTS
// =========================================

const msg = document.getElementById("adminMessage");
const logoutBtn = document.getElementById("logoutBtn");

const money = n =>
    new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 0
    }).format(Number(n) || 0);

function showMessage(message, success = false) {
    if (!msg) return;

    msg.textContent = message;
    msg.style.color = success ? "#22c55e" : "#ef4444";
}

// =========================================
// WHATSAPP CUSTOMER LINK
// =========================================

function customerWhatsApp(phone, orderId) {
    let number = String(phone || "").replace(/\D/g, "");

    if (number.startsWith("0")) {
        number = "234" + number.slice(1);
    } else if (!number.startsWith("234")) {
        number = "234" + number;
    }

    const text = encodeURIComponent(
        `Hello, regarding your DavinciMarket order ${orderId}.`
    );

    return `https://wa.me/${number}?text=${text}`;
}

// =========================================
// ADMIN LOGOUT
// =========================================

if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
        try {
            logoutBtn.disabled = true;
            logoutBtn.textContent = "Logging out...";

            await signOut(auth);

            window.location.replace("login.html");

        } catch (error) {
            console.error("Logout error:", error);
            showMessage("Logout failed: " + error.message);

            logoutBtn.disabled = false;
            logoutBtn.textContent = "Logout";
        }
    });
}

// =========================================
// DASHBOARD SECTION STYLING
// =========================================

function createSection(id, title, description, countId, containerId) {

    let section = document.getElementById(id);

    if (section) return section;

    section = document.createElement("section");
    section.id = id;

    section.style.marginTop = "30px";
    section.style.padding = "20px";
    section.style.background = "#181525";
    section.style.color = "#ffffff";
    section.style.borderRadius = "14px";

    const heading = document.createElement("h2");
    heading.textContent = title;

    const info = document.createElement("p");
    info.textContent = description;

    const count = document.createElement("h3");
    count.id = countId;

    const container = document.createElement("div");
    container.id = containerId;

    container.textContent = "Loading...";

    section.append(heading, info, count, container);

    const parent =
        document.querySelector("main") ||
        document.querySelector(".admin-container") ||
        document.body;

    parent.appendChild(section);

    return section;
}

function createProductSection() {
    return createSection(
        "productApprovalSection",
        "Product Approval Center",
        "Review products submitted by marketplace sellers.",
        "pendingProductCount",
        "pendingProducts"
    );
}

function createOrderSection() {
    return createSection(
        "orderApprovalSection",
        "Bank Transfer Order Management",
        "Verify WhatsApp receipts and approve or reject customer payments.",
        "pendingOrderCount",
        "pendingOrders"
    );
}

// =========================================
// PRODUCT APPROVAL CARD
// =========================================

function createProductCard(product, productId) {

    const card = document.createElement("article");

    card.style.cssText = `
        background:#242036;
        padding:15px;
        margin-bottom:15px;
        border-radius:12px;
        display:flex;
        flex-wrap:wrap;
        gap:15px;
        align-items:center;
    `;

    const image = document.createElement("img");

    image.src = product.imageUrl || "";
    image.alt = product.name || "Product";
    image.loading = "lazy";

    image.style.cssText = `
        width:110px;
        height:110px;
        object-fit:cover;
        border-radius:10px;
    `;

    const details = document.createElement("div");
    details.style.flex = "1";
    details.style.minWidth = "160px";

    const title = document.createElement("h3");
    title.textContent = product.name || "Unnamed product";

    const description = document.createElement("p");
    description.textContent =
        product.description || "No description provided.";

    const price = document.createElement("p");
    price.textContent = "Price: " + money(product.price);

    const stock = document.createElement("p");
    stock.textContent = "Stock: " + (product.stock ?? 0);

    const category = document.createElement("p");
    category.textContent =
        "Category: " + (product.category || "Uncategorized");

    const seller = document.createElement("p");
    seller.textContent =
        "Seller: " + (product.sellerEmail || product.sellerId || "Unknown");

    details.append(
        title, description, price, stock, category, seller
    );

    const actions = document.createElement("div");

    actions.style.display = "flex";
    actions.style.gap = "10px";
    actions.style.flexWrap = "wrap";

    const approve = document.createElement("button");
    approve.textContent = "Approve";
    approve.style.cssText =
        "background:#16a34a;color:white;padding:10px;border:0;border-radius:8px;";

    const reject = document.createElement("button");
    reject.textContent = "Reject";
    reject.style.cssText =
        "background:#dc2626;color:white;padding:10px;border:0;border-radius:8px;";

    approve.addEventListener("click", async () => {

        if (!confirm(`Approve "${product.name}"?`)) return;

        approve.disabled = true;
        reject.disabled = true;

        try {
            await updateDoc(doc(db, "products", productId), {
                status: "approved",
                active: true,
                approvedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            showMessage("Product approved successfully!", true);
            await loadPendingProducts();

        } catch (error) {
            showMessage(error.message);
            approve.disabled = false;
            reject.disabled = false;
        }
    });

    reject.addEventListener("click", async () => {

        if (!confirm(`Reject "${product.name}"?`)) return;

        approve.disabled = true;
        reject.disabled = true;

        try {
            await updateDoc(doc(db, "products", productId), {
                status: "rejected",
                active: false,
                updatedAt: serverTimestamp()
            });

            showMessage("Product rejected.", true);
            await loadPendingProducts();

        } catch (error) {
            showMessage(error.message);
            approve.disabled = false;
            reject.disabled = false;
        }
    });

    actions.append(approve, reject);
    card.append(image, details, actions);

    return card;
}

// =========================================
// LOAD PENDING PRODUCTS
// =========================================

async function loadPendingProducts() {

    const container = document.getElementById("pendingProducts");
    const count = document.getElementById("pendingProductCount");

    if (!container) return;

    container.textContent = "Loading products...";

    try {

        const snapshot = await getDocs(
            query(
                collection(db, "products"),
                where("status", "==", "pending")
            )
        );

        container.innerHTML = "";

        if (count) {
            count.textContent = `Pending Products: ${snapshot.size}`;
        }

        if (snapshot.empty) {
            container.textContent = "No products waiting for approval.";
            return;
        }

        snapshot.forEach(productDoc => {
            container.appendChild(
                createProductCard(productDoc.data(), productDoc.id)
            );
        });

    } catch (error) {
        console.error(error);
        container.textContent =
            "Unable to load products: " + error.message;
    }
}

// =========================================
// CREATE BANK TRANSFER ORDER CARD
// =========================================

function createOrderCard(order, orderId) {

    const card = document.createElement("article");

    card.style.cssText = `
        background:#242036;
        padding:18px;
        margin-bottom:18px;
        border-radius:12px;
        border:1px solid #403854;
    `;

    const title = document.createElement("h3");
    title.textContent = "Order #" + orderId;

    const status = document.createElement("p");
    status.textContent =
        "Payment: " + (order.paymentStatus || "pending").toUpperCase();

    status.style.color = "#f5c451";

    const details = document.createElement("div");

    const fields = [
        ["Customer", order.customerName],
        ["Phone", order.customerPhone],
        ["Email", order.customerEmail],
        ["Delivery address", order.deliveryAddress],
        ["Delivery note", order.deliveryNote || "None"],
        ["Payment method", order.paymentMethod],
        ["Bank", order.paymentBank || "OPay"],
        ["Total", money(order.total)]
    ];

    fields.forEach(([label, value]) => {
        const p = document.createElement("p");
        p.textContent = `${label}: ${value || "Not provided"}`;
        details.appendChild(p);
    });

    const itemsHeading = document.createElement("h4");
    itemsHeading.textContent = "Products ordered";

    const itemsList = document.createElement("ul");

    (Array.isArray(order.items) ? order.items : []).forEach(item => {
        const li = document.createElement("li");

        li.textContent =
            `${item.name} × ${item.quantity} — ${money(
                Number(item.price) * Number(item.quantity)
            )}`;

        itemsList.appendChild(li);
    });

    const whatsapp = document.createElement("a");

    whatsapp.href = customerWhatsApp(order.customerPhone, orderId);
    whatsapp.target = "_blank";
    whatsapp.rel = "noopener noreferrer";
    whatsapp.textContent = "Contact customer on WhatsApp";

    whatsapp.style.cssText = `
        display:inline-block;
        background:#128c45;
        color:white;
        padding:11px 15px;
        border-radius:8px;
        text-decoration:none;
        margin:10px 0;
    `;

    const receiptNote = document.createElement("p");
    receiptNote.textContent =
        "Verify the customer's transfer receipt in your WhatsApp conversation and confirm the actual OPay transaction before approving.";

    receiptNote.style.color = "#f5c451";

    const actions = document.createElement("div");

    actions.style.cssText = `
        display:flex;
        gap:10px;
        flex-wrap:wrap;
        margin-top:15px;
    `;

    const approve = document.createElement("button");
    approve.textContent = "Approve Payment";

    approve.style.cssText = `
        background:#16a34a;
        color:white;
        padding:12px 17px;
        border:0;
        border-radius:8px;
        cursor:pointer;
    `;

    const reject = document.createElement("button");
    reject.textContent = "Reject Payment";

    reject.style.cssText = `
        background:#dc2626;
        color:white;
        padding:12px 17px;
        border:0;
        border-radius:8px;
        cursor:pointer;
    `;

    // APPROVE PAYMENT

    approve.addEventListener("click", async () => {

        const confirmed = confirm(
            `Have you verified the actual OPay transfer of ${money(order.total)} for order ${orderId}? Approving will reduce stock and permanently delete any product listing that becomes sold out.`
        );

        if (!confirmed) return;

        approve.disabled = true;
        reject.disabled = true;

        try {

            const orderRef = doc(db, "orders", orderId);
            const inventoryResult = await runTransaction(db, async transaction => {
                const freshOrder = await transaction.get(orderRef);
                if (!freshOrder.exists()) throw new Error("This order no longer exists.");
                const freshOrderData = freshOrder.data();
                if (freshOrderData.paymentStatus !== "pending") throw new Error("This order has already been reviewed.");

                const quantities = new Map();
                for (const item of Array.isArray(freshOrderData.items) ? freshOrderData.items : []) {
                    const productId = String(item.productId || "");
                    const quantity = Number(item.quantity);
                    if (!productId || !Number.isInteger(quantity) || quantity < 1) {
                        throw new Error("The order contains an item without a valid product ID or quantity. No changes were made.");
                    }
                    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
                }
                if (!quantities.size) throw new Error("This order has no product items.");

                const inventory = [];
                for (const [productId, quantity] of quantities) {
                    const productRef = doc(db, "products", productId);
                    const productSnapshot = await transaction.get(productRef);
                    if (!productSnapshot.exists()) throw new Error(`Product ${productId} was not found. No changes were made.`);
                    const product = productSnapshot.data();
                    const stock = Number(product.stock);
                    if (!Number.isInteger(stock) || stock < quantity) {
                        throw new Error(`${product.name || "A product"} has only ${Number.isFinite(stock) ? stock : 0} in stock, but this order requires ${quantity}. No changes were made.`);
                    }
                    inventory.push({ productId, productRef, product, remaining: stock - quantity });
                }

                const deleted = [];
                const reduced = [];
                for (const item of inventory) {
                    if (item.remaining === 0) {
                        transaction.delete(item.productRef);
                        deleted.push(item.product.name || "Unnamed product");
                    } else {
                        transaction.update(item.productRef, { stock: item.remaining, updatedAt: serverTimestamp() });
                        reduced.push(`${item.product.name || "Unnamed product"}: ${item.remaining} left`);
                    }
                }
                transaction.update(orderRef, {
                    paymentStatus: "paid",
                    orderStatus: "processing",
                    paymentVerifiedAt: serverTimestamp(),
                    paymentVerifiedBy: auth.currentUser.uid,
                    updatedAt: serverTimestamp()
                });
                return { deleted, reduced };
            });

            showMessage(
                `Payment for order ${orderId} approved. ${inventoryResult.deleted.length ? `Permanently deleted sold-out listings: ${inventoryResult.deleted.join(", ")}. ` : ""}${inventoryResult.reduced.length ? `Updated stock: ${inventoryResult.reduced.join(", ")}.` : ""}`,
                true
            );

            await Promise.all([
                loadPendingOrders(),
                loadSalesStatistics()
            ]);

        } catch (error) {

            console.error("Payment approval error:", error);
            showMessage("Approval failed: " + error.message);

            approve.disabled = false;
            reject.disabled = false;
        }
    });

    // REJECT PAYMENT

    reject.addEventListener("click", async () => {

        const confirmed = confirm(
            `Reject payment for order ${orderId}?`
        );

        if (!confirmed) return;

        approve.disabled = true;
        reject.disabled = true;

        try {

            await updateDoc(doc(db, "orders", orderId), {
                paymentStatus: "rejected",
                orderStatus: "cancelled",
                paymentRejectedAt: serverTimestamp(),
                paymentVerifiedBy: auth.currentUser.uid,
                updatedAt: serverTimestamp()
            });

            showMessage(
                `Payment for order ${orderId} rejected.`,
                true
            );

            await loadPendingOrders();

        } catch (error) {

            console.error("Payment rejection error:", error);
            showMessage("Rejection failed: " + error.message);

            approve.disabled = false;
            reject.disabled = false;
        }
    });

    actions.append(approve, reject);

    card.append(
        title,
        status,
        details,
        itemsHeading,
        itemsList,
        whatsapp,
        receiptNote,
        actions
    );

    return card;
}

// =========================================
// LOAD PENDING BANK TRANSFER ORDERS
// =========================================

async function loadPendingOrders() {

    const container = document.getElementById("pendingOrders");
    const count = document.getElementById("pendingOrderCount");

    if (!container) return;

    container.textContent = "Loading orders...";

    try {

        const snapshot = await getDocs(
            query(
                collection(db, "orders"),
                where("paymentStatus", "==", "pending")
            )
        );

        container.innerHTML = "";

        const pendingOrders = snapshot.docs.filter(orderDoc => {
            const order = orderDoc.data();

            return order.paymentMethod === "bank_transfer";
        });

        if (count) {
            count.textContent =
                `Pending Bank Transfers: ${pendingOrders.length}`;
        }

        if (!pendingOrders.length) {
            container.textContent =
                "No pending bank-transfer orders.";
            return;
        }

        pendingOrders.forEach(orderDoc => {

            const order = orderDoc.data();

            container.appendChild(
                createOrderCard(order, orderDoc.id)
            );
        });

    } catch (error) {

        console.error("Order loading error:", error);

        container.textContent =
            "Unable to load orders: " + error.message;
    }
}

// =========================================
// LOAD SALES STATISTICS
// =========================================

async function loadSalesStatistics() {

    const orders = await getDocs(
        query(
            collection(db, "orders"),
            where("paymentStatus", "==", "paid")
        )
    );

    let gross = 0;
    let commission = 0;
    let seller = 0;

    orders.forEach(orderDoc => {

        const x = orderDoc.data();

        const total = Number(x.total ?? x.subtotal) || 0;

        gross += total;

        commission +=
            Number(x.commissionAmount) || total * 0.05;

        seller +=
            Number(x.sellerPayable) || total * 0.95;
    });

    const paidOrders = document.getElementById("paidOrders");
    const grossSales = document.getElementById("grossSales");
    const commissionElement = document.getElementById("commission");
    const sellerPayable = document.getElementById("sellerPayable");

    if (paidOrders) paidOrders.textContent = orders.size;
    if (grossSales) grossSales.textContent = money(gross);

    if (commissionElement) {
        commissionElement.textContent = money(commission);
    }

    if (sellerPayable) {
        sellerPayable.textContent = money(seller);
    }
}

// =========================================
// FEATURED SELLER OPay TRANSFER REVIEW
// =========================================

function createFeaturedTransferSection() {
    return createSection("featuredTransferSection", "Featured Seller Profile Payments", "Review uploaded OPay receipts and approve the seller's 30-day featured listing.", "pendingFeaturedTransferCount", "pendingFeaturedTransfers");
}

async function loadPendingFeaturedTransfers() {
    const container = document.getElementById("pendingFeaturedTransfers");
    const count = document.getElementById("pendingFeaturedTransferCount");
    if (!container) return;
    container.textContent = "Loading OPay receipts…";
    try {
        const snapshot = await getDocs(query(collection(db, "featuredProfilePayments"), where("status", "==", "pending_review")));
        container.replaceChildren();
        if (count) count.textContent = `Waiting for verification: ${snapshot.size}`;
        if (snapshot.empty) { container.textContent = "No featured seller receipts are waiting for review."; return; }
        snapshot.forEach(paymentDoc => {
            const payment = paymentDoc.data();
            const card = document.createElement("article");
            card.style.cssText = "background:#242036;padding:18px;margin:0 0 14px;border-radius:12px;border:1px solid #403854";
            const title = document.createElement("h3");
            title.textContent = payment.sellerName || "Featured seller payment";
            const details = document.createElement("p");
            details.textContent = `Seller: ${payment.sellerEmail || payment.uid} · Sender: ${payment.senderName || "—"} · Amount: ${money(payment.amountNaira)} · Date: ${payment.transferDate || "—"} · OPay reference: ${payment.transactionReference || "—"}`;
            const receipt = document.createElement("a");
            receipt.href = payment.receiptUrl || "#"; receipt.target = "_blank"; receipt.rel = "noopener noreferrer"; receipt.textContent = "Open uploaded receipt";
            const preview = document.createElement("img");
            preview.src = payment.receiptUrl || ""; preview.alt = `OPay receipt from ${payment.senderName || payment.sellerName || "seller"}`; preview.loading = "lazy";
            preview.style.cssText = "display:block;max-width:320px;max-height:260px;object-fit:contain;margin:12px 0;border-radius:10px";
            const note = document.createElement("p");
            note.textContent = "Confirm the ₦20,000 transaction in the OPay account before approving."; note.style.color = "#f5c451";
            const actions = document.createElement("div"); actions.style.cssText = "display:flex;gap:10px;flex-wrap:wrap";
            const approve = document.createElement("button"); approve.textContent = "Approve payment"; approve.style.cssText = "background:#16a34a;color:white;padding:11px 14px;border:0;border-radius:8px;cursor:pointer";
            const reject = document.createElement("button"); reject.textContent = "Reject receipt"; reject.style.cssText = "background:#dc2626;color:white;padding:11px 14px;border:0;border-radius:8px;cursor:pointer";
            approve.addEventListener("click", async () => {
                if (!confirm(`Have you confirmed ₦20,000 arrived in OPay for ${payment.transactionReference}?`)) return;
                approve.disabled = true; reject.disabled = true;
                try {
                    const accessRef = doc(db, "featuredSellerAccess", payment.uid);
                    const accessSnap = await getDoc(accessRef);
                    const currentExpiry = accessSnap.exists() ? accessSnap.data().expiresAt?.toDate?.().getTime() || 0 : 0;
                    const expiresAt = new Date(Math.max(Date.now(), currentExpiry) + 30 * 24 * 60 * 60 * 1000);
                    const profileRef = doc(db, "featuredSellerProfiles", payment.uid);
                    const profileSnap = await getDoc(profileRef);
                    const batch = writeBatch(db);
                    batch.update(doc(db, "featuredProfilePayments", paymentDoc.id), { status: "verified", verifiedAt: serverTimestamp(), verifiedBy: auth.currentUser.uid, expiresAt });
                    batch.set(accessRef, { uid: payment.uid, status: "approved", paymentId: paymentDoc.id, expiresAt, updatedAt: serverTimestamp() }, { merge: true });
                    if (profileSnap.exists()) batch.update(profileRef, { expiresAt, updatedAt: serverTimestamp() });
                    await batch.commit();
                    showMessage("Payment approved. The seller can sign in and finish their profile.", true);
                    await loadPendingFeaturedTransfers();
                } catch (error) { showMessage("Could not approve receipt: " + error.message); approve.disabled = false; reject.disabled = false; }
            });
            reject.addEventListener("click", async () => {
                const reason = prompt("Reason for rejecting this receipt:", "Transfer not found or amount does not match");
                if (reason === null) return;
                approve.disabled = true; reject.disabled = true;
                try {
                    await updateDoc(doc(db, "featuredProfilePayments", paymentDoc.id), { status: "rejected", rejectionReason: reason.trim().slice(0, 300), reviewedAt: serverTimestamp(), reviewedBy: auth.currentUser.uid });
                    showMessage("Receipt rejected.", true);
                    await loadPendingFeaturedTransfers();
                } catch (error) { showMessage("Could not reject receipt: " + error.message); approve.disabled = false; reject.disabled = false; }
            });
            actions.append(approve, reject); card.append(title, details, receipt, preview, note, actions); container.append(card);
        });
    } catch (error) {
        console.error("Featured seller payment requests error:", error);
        container.textContent = "Unable to load featured seller receipts: " + error.message;
    }
}
// ADMIN AUTHENTICATION
// =========================================

onAuthStateChanged(auth, async user => {

    if (!user) {
        window.location.replace("login.html");
        return;
    }

    try {

        showMessage("Verifying administrator account...", true);

        const adminDoc = await getDoc(
            doc(db, "admins", user.uid)
        );

        console.log("Logged-in email:", user.email);
        console.log("Logged-in UID:", user.uid);
        console.log("Admin document exists:", adminDoc.exists());
        console.log("Firebase project:", auth.app.options.projectId);

        if (!adminDoc.exists()) {

            showMessage(
                "ADMIN NOT FOUND. Your Firebase UID is: " + user.uid
            );

            return;
        }

        showMessage("Administrator access verified.", true);

        createProductSection();
        createOrderSection();
        createFeaturedTransferSection();

        await Promise.all([
            loadPendingProducts(),
            loadPendingOrders(),
            loadPendingFeaturedTransfers(),
            loadSalesStatistics()
        ]);

    } catch (error) {

        console.error("Admin dashboard error:", error);

        showMessage("Dashboard error: " + error.message);
    }
});
