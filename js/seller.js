/* =========================================
   DAVINCIMARKET - SELLER DASHBOARD
   Firebase + Firestore + Cloudinary
   Admin Product Approval System
========================================= */

import { auth, db } from "./firebase.js";

import {
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    serverTimestamp,
    doc,
    updateDoc,
    getDoc,
    setDoc
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

// =========================================
// CLOUDINARY CONFIGURATION
// =========================================

const CLOUDINARY_CLOUD_NAME = "dbglhqgr";
const CLOUDINARY_UPLOAD_PRESET = "davincimarket_products";

const CLOUDINARY_UPLOAD_URL =
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

// =========================================
// HTML ELEMENTS
// =========================================

const form = document.getElementById("productForm");
const msg = document.getElementById("sellerMessage");
const list = document.getElementById("sellerProducts");
const logoutBtn = document.getElementById("logoutBtn");
const featuredProfilePanel = document.getElementById("featuredProfilePanel");
const featuredProfileForm = document.getElementById("featuredProfileForm");
const featuredProfileMessage = document.getElementById("featuredProfileMessage");
const featuredProductLimit = document.getElementById("featuredProductLimit");
const featuredPicturePreview = document.getElementById("featuredPicturePreview");


const imageInput =
    document.getElementById("imageFile") ||
    document.getElementById("productImage") ||
    document.getElementById("imageUpload") ||
    document.getElementById("imageUrl");
const productPhotoInputs = Array.from(document.querySelectorAll(".product-photo-input"));

let currentUser = null;
let sellerVerified = false;
let featuredAccessActive = false;
let featuredExpiresAt = null;
let featuredSellerProfile = null;
let sellerProductCount = 0;
let sellerAccountData = {};

const nigeriaStateNames = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno","Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","Federal Capital Territory","Gombe","Imo","Jigawa","Kaduna","Kano","Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau","Rivers","Sokoto","Taraba","Yobe","Zamfara"];
function stateFromSellerLocation(value) {
    const location = String(value || "").toLowerCase();
    if (/(^|[^a-z])(abuja|fct)([^a-z]|$)/.test(location)) return "Federal Capital Territory";
    return nigeriaStateNames.find(state => {
        const escaped = state.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(location);
    }) || "";
}


// =========================================
// LOGOUT FUNCTION
// =========================================

logoutBtn?.addEventListener("click", async () => {

    try {

        logoutBtn.disabled = true;
        logoutBtn.textContent = "Logging out...";

        await signOut(auth);

        window.location.replace("login.html");

    } catch (error) {

        console.error("Logout error:", error);

        alert("Unable to log out: " + error.message);

        logoutBtn.disabled = false;
        logoutBtn.textContent = "Logout";

    }

});

// =========================================
// CURRENCY FORMATTER
// =========================================

const money = (n) =>
    new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 0
    }).format(n || 0);

// =========================================
// MESSAGE DISPLAY
// =========================================

function showMessage(message, success = false) {

    if (!msg) return;

    msg.textContent = message;
    msg.style.color = success ? "#22c55e" : "#ef4444";

}

// =========================================
// CLOUDINARY IMAGE UPLOAD
// =========================================

async function uploadProductImage(file, folder = "davincimarket/products") {

    if (!file) {
        throw new Error("Please select a product image.");
    }

    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];

    if (!allowedTypes.includes(file.type)) {
        throw new Error("Only JPG, PNG and WEBP images are allowed.");
    }

    if (file.size > 5 * 1024 * 1024) {
        throw new Error("Image must not exceed 5MB.");
    }

    const imageData = new FormData();

    imageData.append("file", file);
    imageData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    imageData.append("folder", folder);

    const response = await fetch(
        CLOUDINARY_UPLOAD_URL,
        {
            method: "POST",
            body: imageData
        }
    );

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.error?.message || "Cloudinary image upload failed."
        );
    }

    if (!result.secure_url) {
        throw new Error("Image URL was not returned by Cloudinary.");
    }

    return result.secure_url;

}

async function loadFeaturedSellerProfile(user) {
    if (!featuredProfilePanel) return;
    const accessSnap = await getDoc(doc(db, "featuredSellerAccess", user.uid));
    const access = accessSnap.exists() ? accessSnap.data() : null;
    featuredExpiresAt = access?.expiresAt || null;
    featuredAccessActive = Boolean(access?.status === "approved" && featuredExpiresAt?.toDate?.().getTime() > Date.now());
    featuredProfilePanel.hidden = !featuredAccessActive;
    if (!featuredAccessActive) return;
    const profileSnap = await getDoc(doc(db, "featuredSellerProfiles", user.uid));
    featuredSellerProfile = profileSnap.exists() ? profileSnap.data() : null;
    const profile = featuredSellerProfile || {};
    document.getElementById("featuredBusinessName").value = profile.businessName || "";
    document.getElementById("featuredLocation").value = profile.location || "";
    document.getElementById("featuredBio").value = profile.bio || "";
    document.getElementById("featuredHandle").value = profile.handle || "";
    document.getElementById("featuredInstagram").value = profile.socialLinks?.instagram || "";
    document.getElementById("featuredTikTok").value = profile.socialLinks?.tiktok || "";
    document.getElementById("featuredWebsite").value = profile.socialLinks?.website || "";
    if (profile.profilePhoto) { featuredPicturePreview.src = profile.profilePhoto; featuredPicturePreview.hidden = false; }
}
// =========================================
// VERIFY SELLER ACCOUNT
// =========================================

onAuthStateChanged(auth, async (user) => {

    currentUser = null;
    sellerVerified = false;

    if (!user) {
        window.location.replace("login.html");
        return;
    }

    try {

        const profileRef = doc(db, "users", user.uid);
        const profile = await getDoc(profileRef);

        if (!profile.exists() || profile.data().role !== "seller") {

            showMessage(
                "Access denied. Please use a registered seller account."
            );

            if (form) {
                const button = form.querySelector('[type="submit"]');
                if (button) button.disabled = true;
            }

            return;
        }

        sellerAccountData = profile.data();

        currentUser = user;
        sellerVerified = true;

        await loadFeaturedSellerProfile(user);
        await loadProducts();

    } catch (error) {

        console.error("Seller verification error:", error);

        showMessage(
            "Unable to verify seller account: " + error.message
        );

    }

});

featuredProfileForm?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!currentUser || !featuredAccessActive) { if (featuredProfileMessage) featuredProfileMessage.textContent = "Your payment must be approved before saving this profile."; return; }
    const button = featuredProfileForm.querySelector('[type="submit"]');
    const file = document.getElementById("featuredPicture").files?.[0];
    if (!file && !featuredSellerProfile?.profilePhoto) { featuredProfileMessage.textContent = "Choose a business profile picture."; return; }
    try {
        button.disabled = true; button.textContent = "Saving profile…";
        const profilePhoto = file ? await uploadProductImage(file, `davincimarket/featured-sellers/${currentUser.uid}`) : featuredSellerProfile.profilePhoto;
        const accountSnap = await getDoc(doc(db, "users", currentUser.uid));
        const account = accountSnap.data() || {};
        const value = id => document.getElementById(id).value.trim();
        const profile = {
            uid: currentUser.uid,
            businessName: value("featuredBusinessName"),
            name: account.fullName || account.name || currentUser.displayName || "Seller",
            bio: value("featuredBio"),
            location: value("featuredLocation"),
            mapQuery: value("featuredLocation"),
            handle: value("featuredHandle"),
            profilePhoto,
            socialLinks: { instagram: value("featuredInstagram"), tiktok: value("featuredTikTok"), website: value("featuredWebsite") },
            status: "published",
            expiresAt: featuredExpiresAt,
            updatedAt: serverTimestamp()
        };
        await setDoc(doc(db, "featuredSellerProfiles", currentUser.uid), profile, { merge: true });
        featuredSellerProfile = profile;
        featuredPicturePreview.src = profilePhoto; featuredPicturePreview.hidden = false;
        featuredProfileMessage.textContent = "Business profile saved and published. Add up to five products below.";
        featuredProfileMessage.style.color = "#22c55e";
    } catch (error) {
        console.error("Featured seller profile save error:", error);
        featuredProfileMessage.textContent = error.message || "Unable to save your profile.";
        featuredProfileMessage.style.color = "#ef4444";
    } finally { button.disabled = false; button.textContent = "Save business profile"; }
});
// =========================================
// PUBLISH PRODUCT
// =========================================

form?.addEventListener("submit", async (e) => {

    e.preventDefault();

    if (!currentUser || !sellerVerified) {
        showMessage("Your seller account has not been verified.");
        return;
    }
    if (featuredAccessActive && sellerProductCount >= 5) {
        showMessage("Your featured listing allows a maximum of five products.");
        return;
    }

    const submitButton =
        form.querySelector('[type="submit"]');

    try {

        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Processing...";
        }

        const name =
            document.getElementById("productName").value.trim();

        const description =
            document.getElementById("description").value.trim();

        const price =
            Number(document.getElementById("price").value);

        const stock =
            Number(document.getElementById("stock").value);

        const category =
            document.getElementById("category").value;

        if (!name || !description || !category) {
            throw new Error("Please complete all product details.");
        }

        if (!Number.isSafeInteger(price) || price < 100) {
            throw new Error("Minimum product price is ₦100.");
        }

        if (!Number.isSafeInteger(stock) || stock < 1) {
            throw new Error("Stock must be at least 1.");
        }

        if (!imageInput || imageInput.type !== "file") {
            throw new Error(
                'Your image input must have id="imageFile" and type="file".'
            );
        }

        const files = productPhotoInputs.length
            ? productPhotoInputs.map(input => input.files?.[0]).filter(Boolean)
            : Array.from(imageInput.files || []);
        if (!files.length) throw new Error("Please select at least one product photo.");
        if (files.length > 5) throw new Error("Choose no more than five photos for one product.");
        if (files.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024)) {
            throw new Error("Each photo must be JPG, PNG or WEBP and no larger than 5MB.");
        }

        showMessage(`Uploading product photo 1 of ${files.length}...`);

        if (submitButton) {
            submitButton.textContent = "Uploading Image...";
        }

        const imageUrls = [];
        for (const [index, file] of files.entries()) {
            if (submitButton) submitButton.textContent = `Uploading photo ${index + 1} of ${files.length}...`;
            imageUrls.push(await uploadProductImage(file));
        }
        const imageUrl = imageUrls[0];

        const sellerProfileSnap = await getDoc(doc(db, "users", currentUser.uid));
        const sellerProfile = sellerProfileSnap.data() || {};
        const sellerName = sellerProfile.businessName || sellerProfile.fullName || sellerProfile.name || currentUser.displayName || currentUser.email?.split("@")[0] || "DavinciMarket Seller";

        showMessage("Submitting product for admin approval...");

        if (submitButton) {
            submitButton.textContent = "Submitting...";
        }

        await addDoc(collection(db, "products"), {

            name,
            description,
            price,
            stock,
            category,

            imageUrl,
            imageUrls,

            sellerId: currentUser.uid,
            sellerName,
            sellerEmail: currentUser.email || "",
            sellerState: document.getElementById("sellerState")?.value || "",

            status: "pending",
            active: false,

            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),

            approvedAt: null

        });

        form.reset();
        document.getElementById("productImagePreviews")?.replaceChildren();

        showMessage(
            "Product submitted successfully! Waiting for admin approval.",
            true
        );

        await loadProducts();

    } catch (error) {

        console.error("Product publishing error:", error);

        showMessage(error.message);

    } finally {

        if (submitButton) {
            const atFeaturedLimit = featuredAccessActive && sellerProductCount >= 5;
            submitButton.disabled = atFeaturedLimit;
            submitButton.textContent = atFeaturedLimit ? "5-product limit reached" : "Add product to my featured listing";
        }

    }

});

// =========================================
// LOAD SELLER PRODUCTS
// =========================================

async function loadProducts() {

    if (!currentUser || !list) return;

    try {

        list.innerHTML = "Loading your products...";

        const productsQuery = query(
            collection(db, "products"),
            where("sellerId", "==", currentUser.uid)
        );

        const snap = await getDocs(productsQuery);
        const accountState = stateFromSellerLocation(sellerAccountData.state || sellerAccountData.location);
        if (accountState) {
            const oldApprovedProducts = snap.docs.filter(item => {
                const product = item.data();
                return product.sellerId === currentUser.uid && product.status === "approved" && product.active === true && !product.sellerState;
            });
            await Promise.all(oldApprovedProducts.map(item => updateDoc(doc(db, "products", item.id), {
                sellerState: accountState,
                updatedAt: serverTimestamp()
            })));
        }
        sellerProductCount = snap.size;
        if (featuredProductLimit) featuredProductLimit.textContent = featuredAccessActive
            ? `Featured product slots: ${sellerProductCount} of 5 used · ${Math.max(0, 5 - sellerProductCount)} remaining. Submit each product separately below.`
            : "Your five featured product slots unlock after featured payment approval.";
        const productSubmit = form?.querySelector("[type=submit]");
        if (productSubmit && featuredAccessActive && sellerProductCount >= 5) { productSubmit.disabled = true; productSubmit.textContent = "5-product limit reached"; }
        else if (productSubmit) { productSubmit.disabled = false; productSubmit.textContent = "Add product to my featured listing"; }

        list.innerHTML = "";

        if (snap.empty) {

            list.textContent =
                "You have not submitted any products yet.";

            return;
        }

        snap.forEach((productDoc) => {

            const p = productDoc.data();

            const row = document.createElement("div");
            row.className = "seller-product";

            const image = document.createElement("img");

            image.src = p.imageUrl || "";
            image.alt = p.name || "Product image";
            image.loading = "lazy";

            image.style.width = "75px";
            image.style.height = "75px";
            image.style.objectFit = "cover";
            image.style.borderRadius = "10px";

            const details = document.createElement("div");
            details.className = "seller-product-details";

            const title = document.createElement("h3");
            title.textContent = p.name || "Unnamed product";

            const info = document.createElement("p");

            info.textContent =
                `${money(p.price)} · Stock: ${p.stock}`;

            const status = document.createElement("p");

            status.textContent =
                p.status === "approved"
                    ? "Approved"
                    : p.status === "rejected"
                        ? "Rejected"
                        : "Pending Approval";

            status.style.fontWeight = "bold";

            status.style.color =
                p.status === "approved"
                    ? "#22c55e"
                    : p.status === "rejected"
                        ? "#ef4444"
                        : "#eab308";

            details.append(title, info, status);

            row.append(image, details);

            if (p.status === "approved") {

                const btn = document.createElement("button");

                btn.className = "add-button";

                btn.textContent =
                    p.active ? "Hide Product" : "Show Product";

                btn.addEventListener("click", async () => {

                    try {

                        btn.disabled = true;

                        await updateDoc(
                            doc(db, "products", productDoc.id),
                            {
                                active: !p.active,
                                updatedAt: serverTimestamp()
                            }
                        );

                        showMessage(
                            "Product visibility updated.",
                            true
                        );

                        await loadProducts();

                    } catch (error) {

                        console.error(error);

                        showMessage(error.message);

                        btn.disabled = false;

                    }

                });

                row.append(btn);
            }

            list.append(row);

        });

    } catch (error) {

        console.error("Loading products error:", error);

        showMessage(
            "Unable to load products: " + error.message
        );

        list.textContent = "Could not load your products.";

    }

}
