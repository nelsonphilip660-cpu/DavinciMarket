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
const FEATURED_PROFILE_PRICE_NAIRA = 20000;
const FEATURED_PROFILE_TERM_DAYS = 30;
const featuredPayments = db.collection("featuredProfilePayments");
const featuredProfiles = db.collection("featuredSellerProfiles");
const users = db.collection("users");
const admins = db.collection("admins");

async function requireSeller(uid) {
    const snap = await users.doc(uid).get();
    if (!snap.exists || snap.data().role !== "seller") throw new HttpsError("permission-denied", "Create or sign in to a seller account first.");
    return snap.data();
}

async function requireAdmin(uid) {
    const snap = await admins.doc(uid).get();
    if (!snap.exists) throw new HttpsError("permission-denied", "Administrator access is required.");
}

exports.submitFeaturedProfileTransfer = onCall({ region: REGION, cors: true }, async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in to your seller account.");
    const seller = await requireSeller(request.auth.uid);
    const senderName = typeof request.data?.senderName === "string" ? request.data.senderName.trim().slice(0, 100) : "";
    const transactionReference = typeof request.data?.transactionReference === "string" ? request.data.transactionReference.trim().slice(0, 80) : "";
    const transferDate = typeof request.data?.transferDate === "string" ? request.data.transferDate.trim().slice(0, 20) : "";
    if (senderName.length < 2 || !/^[A-Za-z0-9-]{4,80}$/.test(transactionReference) || !/^\d{4}-\d{2}-\d{2}$/.test(transferDate)) throw new HttpsError("invalid-argument", "Enter the sender name, OPay transaction reference, and transfer date.");
    const profileRef = featuredProfiles.doc(request.auth.uid);
    const profileSnap = await profileRef.get();
    if (profileSnap.exists && profileSnap.data().pendingPaymentId) {
        const existing = await featuredPayments.doc(profileSnap.data().pendingPaymentId).get();
        if (existing.exists && existing.data().status === "pending_review") throw new HttpsError("already-exists", "Your OPay transfer is already waiting for administrator verification.");
    }
    const paymentRef = featuredPayments.doc();
    await paymentRef.set({ uid: request.auth.uid, sellerName: seller.fullName || seller.name || "", sellerEmail: request.auth.token.email || seller.email || "", senderName, transactionReference, transferDate, amountNaira: FEATURED_PROFILE_PRICE_NAIRA, currency: "NGN", method: "OPay manual transfer", status: "pending_review", createdAt: FieldValue.serverTimestamp() });
    await profileRef.set({ uid: request.auth.uid, paymentStatus: profileSnap.exists ? profileSnap.data().paymentStatus || "unpaid" : "unpaid", status: profileSnap.exists ? profileSnap.data().status || "draft" : "draft", pendingPaymentId: paymentRef.id, paymentReviewStatus: "pending_review", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { submitted: true, paymentId: paymentRef.id };
});

exports.getMyFeaturedSellerProfile = onCall({ region: REGION, cors: true }, async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in to your seller account.");
    await requireSeller(request.auth.uid);
    const snap = await featuredProfiles.doc(request.auth.uid).get();
    if (!snap.exists) return { active: false, paymentPending: false, paymentRejected: false, profile: null };
    const data = snap.data();
    const active = data.paymentStatus === "verified" && data.expiresAt?.toMillis?.() > Date.now();
    let paymentPending = data.paymentReviewStatus === "pending_review", paymentRejected = data.paymentReviewStatus === "rejected";
    if (data.pendingPaymentId) {
        const payment = await featuredPayments.doc(data.pendingPaymentId).get();
        paymentPending = payment.exists && payment.data().status === "pending_review";
        paymentRejected = payment.exists && payment.data().status === "rejected";
    }
    const { updatedAt, ...profile } = data.profile || {};
    return { active, paymentPending, paymentRejected, expiresAt: data.expiresAt?.toDate?.().toISOString() || null, profile, rejectionMessage: data.lastPaymentRejection || "" };
});

exports.listPendingFeaturedProfileTransfers = onCall({ region: REGION, cors: true }, async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
    await requireAdmin(request.auth.uid);
    const snap = await featuredPayments.where("status", "==", "pending_review").get();
    return { transfers: snap.docs.map(doc => {
        const data = doc.data();
        return { id: doc.id, uid: data.uid, sellerName: data.sellerName || "", sellerEmail: data.sellerEmail || "", senderName: data.senderName || "", transactionReference: data.transactionReference || "", transferDate: data.transferDate || "", amountNaira: data.amountNaira || FEATURED_PROFILE_PRICE_NAIRA, submittedAt: data.createdAt?.toDate?.().toISOString() || "" };
    }) };
});

exports.resolveFeaturedProfileTransfer = onCall({ region: REGION, cors: true }, async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
    await requireAdmin(request.auth.uid);
    const paymentId = request.data?.paymentId;
    const decision = request.data?.decision;
    if (typeof paymentId !== "string" || !["approve", "reject"].includes(decision)) throw new HttpsError("invalid-argument", "Choose a valid transfer and decision.");
    const paymentRef = featuredPayments.doc(paymentId);
    const paymentSnap = await paymentRef.get();
    if (!paymentSnap.exists) throw new HttpsError("not-found", "Transfer request not found.");
    const payment = paymentSnap.data();
    if (payment.status !== "pending_review") throw new HttpsError("failed-precondition", "This transfer request has already been reviewed.");
    const profileRef = featuredProfiles.doc(payment.uid);
    await db.runTransaction(async tx => {
        const freshPayment = await tx.get(paymentRef);
        const currentProfile = await tx.get(profileRef);
        if (freshPayment.data().status !== "pending_review") throw new HttpsError("failed-precondition", "This transfer request has already been reviewed.");
        if (decision === "approve") {
            const currentExpiry = currentProfile.exists ? currentProfile.data().expiresAt?.toMillis?.() || 0 : 0;
            const startFrom = Math.max(Date.now(), currentExpiry);
            const expiresAt = new Date(startFrom + FEATURED_PROFILE_TERM_DAYS * 24 * 60 * 60 * 1000);
            tx.update(paymentRef, { status: "verified", verifiedAt: FieldValue.serverTimestamp(), verifiedBy: request.auth.uid, expiresAt });
            tx.set(profileRef, { uid: payment.uid, paymentStatus: "verified", status: currentProfile.exists && currentProfile.data().status === "published" ? "published" : "draft", expiresAt, pendingPaymentId: null, paymentReviewStatus: "verified", lastPaymentRejection: "", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        } else {
            const reason = typeof request.data?.reason === "string" ? request.data.reason.trim().slice(0, 300) : "Please check your transfer details and contact support.";
            tx.update(paymentRef, { status: "rejected", reviewedAt: FieldValue.serverTimestamp(), reviewedBy: request.auth.uid, rejectionReason: reason });
            tx.set(profileRef, { pendingPaymentId: null, paymentReviewStatus: "rejected", lastPaymentRejection: reason, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
    });
    return { resolved: true, decision };
});

exports.saveFeaturedSellerProfile = onCall({ region: REGION, cors: true }, async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in to your seller account.");
    const uid = request.auth.uid;
    await requireSeller(uid);
    const profileRef = featuredProfiles.doc(uid);
    const snap = await profileRef.get();
    if (!snap.exists || snap.data().paymentStatus !== "verified" || !snap.data().expiresAt || snap.data().expiresAt.toMillis() <= Date.now()) throw new HttpsError("failed-precondition", "Submit the ₦20,000 OPay transfer and wait for administrator verification before publishing your profile.");
    const input = request.data || {};
    const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
    const businessName = clean(input.businessName, 100);
    const sellerName = clean(input.sellerName, 100);
    const bio = clean(input.bio, 1200);
    const location = clean(input.location, 180);
    const category = clean(input.category, 60);
    const handle = clean(input.handle, 80);
    const profilePhoto = clean(input.profilePhoto, 1000);
    const storeImages = Array.isArray(input.storeImages) ? input.storeImages.slice(0, 6).map(url => clean(url, 1000)) : [];
    const socialLinks = { instagram: clean(input.socialLinks?.instagram, 300), tiktok: clean(input.socialLinks?.tiktok, 300), website: clean(input.socialLinks?.website, 300) };
    const validImage = url => { try { const parsed = new URL(url); return parsed.protocol === "https:" && parsed.hostname === "res.cloudinary.com"; } catch { return false; } };
    if (!businessName || !sellerName || !bio || !location || !profilePhoto || !validImage(profilePhoto) || storeImages.some(url => !validImage(url))) throw new HttpsError("invalid-argument", "Add your name, business details, location, profile photo, and valid store photos.");
    for (const url of Object.values(socialLinks)) if (url && !/^https:\/\//i.test(url)) throw new HttpsError("invalid-argument", "Social links must start with https://.");
    const profile = { uid, name: sellerName, businessName, business: businessName, category, bio, location, mapQuery: location, handle, platform: "Instagram", profilePhoto, storeImages, socialLinks, status: "published", verified: false, updatedAt: FieldValue.serverTimestamp() };
    await profileRef.set({ uid, paymentStatus: "verified", status: "published", profile, expiresAt: snap.data().expiresAt, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { saved: true, profileId: uid };
});

exports.getFeaturedSellerProfile = onCall({ region: REGION, cors: true }, async request => {
    const uid = request.data?.uid;
    if (typeof uid !== "string" || uid.length < 10 || uid.length > 128) throw new HttpsError("invalid-argument", "Invalid seller profile.");
    const snap = await featuredProfiles.doc(uid).get();
    if (!snap.exists) throw new HttpsError("not-found", "Seller profile not found.");
    const data = snap.data();
    if (data.status !== "published" || data.paymentStatus !== "verified" || !data.expiresAt || data.expiresAt.toMillis() <= Date.now() || !data.profile) throw new HttpsError("not-found", "This featured seller listing has expired or is unavailable.");
    const { updatedAt, ...profile } = data.profile;
    return { profile };
});

exports.listFeaturedSellerProfiles = onCall({ region: REGION, cors: true }, async () => {
    const snap = await featuredProfiles.get();
    const now = Date.now();
    return { profiles: snap.docs.map(doc => doc.data()).filter(data => data.status === "published" && data.paymentStatus === "verified" && data.expiresAt?.toMillis?.() > now && data.profile).map(data => { const { updatedAt, ...profile } = data.profile; return profile; }) };
});