import { auth, db } from "./firebase.js";

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    deleteUser
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
    doc,
    setDoc,
    getDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const loginForm = document.getElementById("sellerLoginForm");
const registerForm = document.getElementById("sellerRegisterForm");

const message = document.getElementById("message");

function sellerRedirectTarget() {
    const next = new URLSearchParams(window.location.search).get("next");
    return ["seller-featured.html", "seller.html"].includes(next) ? next : "seller.html";
}

function showMessage(text, success = false) {
    if (!message) return;

    message.textContent = text;
    message.style.color = success ? "#16a34a" : "#dc2626";
}

// =================================
// SELLER REGISTRATION
// =================================

if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const fullName = document.getElementById("fullName").value.trim();
        const businessName = document.getElementById("businessName").value.trim();
        const email = document.getElementById("email").value.trim();
        const phone = document.getElementById("phone").value.trim();
        const location = document.getElementById("location").value.trim();
        const password = document.getElementById("password").value;
        const confirmPassword = document.getElementById("confirmPassword").value;

        const button = document.getElementById("registerBtn");

        if (password !== confirmPassword) {
            showMessage("Passwords do not match.");
            return;
        }

        if (password.length < 6) {
            showMessage("Password must be at least 6 characters.");
            return;
        }

        button.disabled = true;
        button.textContent = "Creating account...";

        let newUser = null;

        try {
            // CREATE FIREBASE AUTH ACCOUNT
            const result = await createUserWithEmailAndPassword(
                auth,
                email,
                password
            );

            newUser = result.user;

            // SAVE SELLER PROFILE IN EXISTING USERS COLLECTION
            await setDoc(doc(db, "users", newUser.uid), {
                uid: newUser.uid,
                name: fullName,
                fullName: fullName,
                businessName: businessName,
                email: newUser.email,
                phone: phone,
                location: location,
                role: "seller",
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            showMessage("Seller account created successfully!", true);

            window.location.href = sellerRedirectTarget();

        } catch (error) {
            console.error("Seller registration error:", error);

            // Roll back Auth account if profile creation failed
            if (newUser && auth.currentUser?.uid === newUser.uid) {
                try {
                    await deleteUser(newUser);
                } catch (rollbackError) {
                    console.error("Account rollback failed:", rollbackError);
                    await signOut(auth);
                }
            }

            const errors = {
                "auth/email-already-in-use": "This email is already registered.",
                "auth/invalid-email": "Enter a valid email address.",
                "auth/weak-password": "Choose a stronger password.",
                "permission-denied": "Firestore permission denied. Check your rules."
            };

            showMessage(errors[error.code] || error.message);

            button.disabled = false;
            button.textContent = "Create Seller Account";
        }
    });
}

// =================================
// SELLER LOGIN
// =================================

if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;

        const button = document.getElementById("loginBtn");

        button.disabled = true;
        button.textContent = "Signing in...";

        try {
            const result = await signInWithEmailAndPassword(
                auth,
                email,
                password
            );

            const user = result.user;

            // CHECK EXISTING USERS COLLECTION
            const userRef = doc(db, "users", user.uid);
            const userSnapshot = await getDoc(userRef);

            if (
                !userSnapshot.exists() ||
                userSnapshot.data().role !== "seller"
            ) {
                await signOut(auth);

                showMessage(
                    "This account is not registered as a seller. Please use your seller registration account."
                );

                button.disabled = false;
                button.textContent = "Sign In";
                return;
            }

            window.location.href = sellerRedirectTarget();

        } catch (error) {
            console.error("Seller login error:", error);

            const errors = {
                "auth/invalid-credential": "Incorrect email or password.",
                "auth/user-not-found": "Account not found.",
                "auth/wrong-password": "Incorrect password.",
                "auth/too-many-requests": "Too many attempts. Try again later.",
                "permission-denied": "Unable to access seller profile. Check Firestore rules."
            };

            showMessage(errors[error.code] || error.message);

            button.disabled = false;
            button.textContent = "Sign In";
        }
    });
}