import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, query, where, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const statusBox = document.getElementById("featuredStatus");
const transferForm = document.getElementById("transferForm");
const transferMessage = document.getElementById("transferMessage");
const transferButton = document.getElementById("submitTransferBtn");
const featuredLoginLinks = document.getElementById("featuredLoginLinks");
const approvedLinks = document.getElementById("approvedLinks");
let currentUser = null;
let reviewPending = false;
const moneyAmount = 20000;
const cloudinaryUploadUrl = "https://api.cloudinary.com/v1_1/dbglhqgr/image/upload";
const cloudinaryUploadPreset = "davincimarket_products";

function showMessage(text, success = false) {
  transferMessage.textContent = text;
  transferMessage.style.color = success ? "#22c55e" : "#ef4444";
}

async function refreshStatus() {
  if (!currentUser) return;
  const userSnap = await getDoc(doc(db, "users", currentUser.uid));
  if (!userSnap.exists() || userSnap.data().role !== "seller") {
    statusBox.textContent = "Sign in with your DavinciMarket seller account, or create one below.";
    transferForm.hidden = true;
    featuredLoginLinks.hidden = false;
    return;
  }
  featuredLoginLinks.hidden = true;
  const [accessSnap, paymentsSnap] = await Promise.all([
    getDoc(doc(db, "featuredSellerAccess", currentUser.uid)),
    getDocs(query(collection(db, "featuredProfilePayments"), where("uid", "==", currentUser.uid)))
  ]);
  const activeAccess = accessSnap.exists() && accessSnap.data().status === "approved" && accessSnap.data().expiresAt?.toDate?.().getTime() > Date.now();
  const payments = paymentsSnap.docs.map(item => item.data());
  const pending = payments.some(payment => payment.status === "pending_review");
  const approved = activeAccess;
  reviewPending = pending;
  if (pending) {
    statusBox.textContent = "Receipt uploaded. It is now in the admin dashboard for payment review. Your seller form will unlock after approval.";
    transferForm.hidden = true;
    approvedLinks.hidden = true;
  } else if (approved) {
    const expiry = accessSnap.data().expiresAt.toDate();
    statusBox.textContent = `Payment approved. Your featured listing is active until ${expiry.toLocaleDateString()}. Open your seller dashboard to complete your profile and list up to five items.`;
    transferForm.hidden = false;
    approvedLinks.hidden = false;
  } else {
    const rejected = payments.find(payment => payment.status === "rejected");
    statusBox.textContent = rejected ? `Previous receipt was rejected: ${rejected.rejectionReason || "please check the receipt details"}. You can upload a corrected receipt.` : "Transfer ₦20,000 to OPay 9037141652, then upload your receipt below.";
    transferForm.hidden = false;
    approvedLinks.hidden = true;
  }
}

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) {
    statusBox.textContent = "Sign in or create a seller account to upload your receipt.";
    featuredLoginLinks.hidden = false;
    transferForm.hidden = true;
    approvedLinks.hidden = true;
    return;
  }
  try { await refreshStatus(); }
  catch (error) { console.error(error); statusBox.textContent = `Unable to load payment status: ${error.message}`; }
});

setInterval(() => {
  if (currentUser && reviewPending) refreshStatus().catch(error => console.warn("Payment status refresh failed:", error));
}, 10000);

const dateField = transferForm.elements.transferDate;
if (dateField) dateField.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

transferForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentUser) { statusBox.textContent = "Sign in to your seller account before uploading a receipt."; return; }
  const file = transferForm.elements.receipt.files?.[0];
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
    showMessage("Choose a JPG, PNG or WEBP receipt image up to 5MB."); return;
  }
  transferButton.disabled = true;
  transferButton.textContent = "Uploading receipt…";
  try {
    const sellerSnap = await getDoc(doc(db, "users", currentUser.uid));
    if (!sellerSnap.exists() || sellerSnap.data().role !== "seller") throw new Error("Use a registered seller account.");
    const paymentRef = doc(collection(db, "featuredProfilePayments"));
    const receiptPath = `featured-receipts/${currentUser.uid}/${paymentRef.id}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const uploadData = new FormData();
    uploadData.append("file", file);
    uploadData.append("upload_preset", cloudinaryUploadPreset);
    uploadData.append("folder", `davincimarket/featured-receipts/${currentUser.uid}`);
    const uploadResponse = await fetch(cloudinaryUploadUrl, { method: "POST", body: uploadData });
    const uploaded = await uploadResponse.json();
    if (!uploadResponse.ok || !uploaded.secure_url) {
      throw new Error(uploaded.error?.message || "Receipt image upload failed.");
    }
    const receiptUrl = uploaded.secure_url;
    await setDoc(paymentRef, {
      uid: currentUser.uid,
      sellerName: sellerSnap.data().fullName || sellerSnap.data().name || "",
      sellerEmail: currentUser.email || "",
      senderName: transferForm.elements.senderName.value.trim(),
      transactionReference: transferForm.elements.transactionReference.value.trim(),
      transferDate: transferForm.elements.transferDate.value,
      receiptPath,
      receiptUrl,
      amountNaira: moneyAmount,
      currency: "NGN",
      method: "OPay manual transfer",
      status: "pending_review",
      createdAt: serverTimestamp()
    });
    showMessage("Receipt uploaded and sent to the admin dashboard for review.", true);
    await refreshStatus();
  } catch (error) {
    console.error(error);
    showMessage(error.message || "Receipt upload failed.");
  } finally {
    transferButton.disabled = false;
    transferButton.textContent = "Upload receipt for approval";
  }
});
