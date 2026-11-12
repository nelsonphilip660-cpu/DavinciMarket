const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const crypto = require("node:crypto");
initializeApp();
const db = getFirestore();
const PAYSTACK_SECRET_KEY = defineSecret("PAYSTACK_SECRET_KEY");
const REGION = "africa-south1";
const COMMISSION_RATE = 0.05;

exports.initializePaystackCheckout = onCall({ region: REGION, secrets: [PAYSTACK_SECRET_KEY], cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Please log in before checkout.");
    const { items, deliveryAddress, deliveryPhone } = request.data || {};
    if (!Array.isArray(items) || items.length < 1 || items.length > 30) throw new HttpsError("invalid-argument", "Your cart is invalid.");
    if (typeof deliveryAddress !== "string" || deliveryAddress.trim().length < 8 || typeof deliveryPhone !== "string" || deliveryPhone.trim().length < 7) throw new HttpsError("invalid-argument", "A valid delivery address and phone number are required.");
    const normalized = new Map();
    for (const item of items) {
        if (!item || typeof item.productId !== "string" || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) throw new HttpsError("invalid-argument", "Invalid cart item.");
        normalized.set(item.productId, (normalized.get(item.productId) || 0) + item.quantity);
    }
    const productRefs = [...normalized.keys()].map(id => db.collection("products").doc(id));
    const productSnaps = await db.getAll(...productRefs);
    const orderLines = []; let subtotal = 0; const sellerIds = new Set();
    for (const snap of productSnaps) {
        if (!snap.exists) throw new HttpsError("failed-precondition", "A product in your cart no longer exists.");
        const p = snap.data(), quantity = normalized.get(snap.id);
        if (p.active !== true || !Number.isSafeInteger(p.price) || p.price < 100 || !Number.isSafeInteger(p.stock) || p.stock < quantity) throw new HttpsError("failed-precondition", `Product ${p.name || snap.id} is unavailable or has insufficient stock.`);
        if (p.sellerId === request.auth.uid) throw new HttpsError("failed-precondition", "You cannot purchase your own listing.");
        const lineTotal = p.price * quantity; subtotal += lineTotal; sellerIds.add(p.sellerId);
        orderLines.push({ productId: snap.id, sellerId: p.sellerId, name: p.name, unitPrice: p.price, quantity, lineTotal, commissionAmount: Math.round(lineTotal * COMMISSION_RATE), sellerPayable: lineTotal - Math.round(lineTotal * COMMISSION_RATE) });
    }
    if (!Number.isSafeInteger(subtotal) || subtotal < 100) throw new HttpsError("invalid-argument", "Order total is invalid.");
    const commissionAmount = orderLines.reduce((s, x) => s + x.commissionAmount, 0);
    const sellerPayable = subtotal - commissionAmount;
    const orderRef = db.collection("orders").doc();
    const email = request.auth.token.email;
    if (!email) throw new HttpsError("failed-precondition", "Your account needs a valid email address.");
    const reference = `DM-${orderRef.id}-${Date.now()}`;
    await orderRef.set({ customerId: request.auth.uid, customerEmail: email, items: orderLines, sellerIds: [...sellerIds], subtotal, commissionRate: COMMISSION_RATE, commissionAmount, sellerPayable, deliveryAddress: deliveryAddress.trim(), deliveryPhone: deliveryPhone.trim(), deliveryStatus: "awaiting_payment", paymentStatus: "pending", paymentReference: reference, createdAt: FieldValue.serverTimestamp() });
    const response = await fetch("https://api.paystack.co/transaction/initialize", { method: "POST", headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY.value()}`, "Content-Type": "application/json" }, body: JSON.stringify({ email, amount: subtotal * 100, reference, callback_url: "https://davincimarket-869eb.web.app/payment-callback.html", metadata: { orderId: orderRef.id, customerId: request.auth.uid } }) });
    const payload = await response.json();
    if (!response.ok || !payload.status || !payload.data?.authorization_url) {
        await orderRef.update({ paymentStatus: "initialization_failed" });
        throw new HttpsError("internal", payload.message || "Paystack could not initialize this payment.");
    }
    await orderRef.update({ paystackAccessCode: payload.data.access_code });
    return { authorizationUrl: payload.data.authorization_url, reference, orderId: orderRef.id };
});

exports.verifyPaystackPayment = onCall({ region: REGION, secrets: [PAYSTACK_SECRET_KEY], cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Please log in.");
    const reference = request.data?.reference;
    if (typeof reference !== "string" || !reference.startsWith("DM-")) throw new HttpsError("invalid-argument", "Invalid payment reference.");
    const snap = await db.collection("orders").where("paymentReference", "==", reference).limit(1).get();
    if (snap.empty) throw new HttpsError("not-found", "Order not found.");
    const orderDoc = snap.docs[0], order = orderDoc.data();
    if (order.customerId !== request.auth.uid) throw new HttpsError("permission-denied", "This order does not belong to your account.");
    if (order.paymentStatus === "paid") return { verified: true, orderId: orderDoc.id };
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY.value()}` } });
    const payload = await response.json();
    if (!response.ok || !payload.status || payload.data?.status !== "success" || payload.data?.reference !== reference || payload.data?.amount !== order.subtotal * 100 || payload.data?.currency !== "NGN") throw new HttpsError("failed-precondition", "Paystack has not confirmed this payment.");
    await db.runTransaction(async tx => {
        const fresh = await tx.get(orderDoc.ref);
        if (fresh.data().paymentStatus === "paid") return;
        tx.update(orderDoc.ref, { paymentStatus: "paid", deliveryStatus: "seller_to_contact_buyer", paidAt: FieldValue.serverTimestamp(), paystackTransactionId: payload.data.id, paystackChannel: payload.data.channel });
        tx.set(db.collection("payments").doc(reference), { orderId: orderDoc.id, customerId: order.customerId, amount: order.subtotal, commissionAmount: order.commissionAmount, sellerPayable: order.sellerPayable, status: "verified", createdAt: FieldValue.serverTimestamp() });
    });
    return { verified: true, orderId: orderDoc.id };
});

// Paystack webhook: set PAYSTACK_SECRET_KEY as a Functions secret before deployment.
exports.paystackWebhook = onRequest({ region: REGION, secrets: [PAYSTACK_SECRET_KEY] }, async (req, res) => {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");
    const signature = req.headers["x-paystack-signature"];
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));
    const expected = crypto.createHmac("sha512", PAYSTACK_SECRET_KEY.value()).update(rawBody).digest("hex");
    if (!signature || signature !== expected) return res.status(401).send("Invalid signature");
    const event = req.body;
    if (event.event === "charge.success" && event.data?.reference) {
        const reference = event.data.reference;
        const snap = await db.collection("orders").where("paymentReference", "==", reference).limit(1).get();
        if (!snap.empty) {
            const ref = snap.docs[0].ref, order = snap.docs[0].data();
            if (event.data.status === "success" && event.data.amount === order.subtotal * 100 && event.data.currency === "NGN") {
                await db.runTransaction(async tx => { const fresh = await tx.get(ref); if (fresh.data().paymentStatus !== "paid") { tx.update(ref, { paymentStatus: "paid", deliveryStatus: "seller_to_contact_buyer", paidAt: FieldValue.serverTimestamp(), paystackTransactionId: event.data.id }); tx.set(db.collection("payments").doc(reference), { orderId: snap.docs[0].id, customerId: order.customerId, amount: order.subtotal, commissionAmount: order.commissionAmount, sellerPayable: order.sellerPayable, status: "verified", createdAt: FieldValue.serverTimestamp() }); } });
            }
        }
    }
    return res.sendStatus(200);
});