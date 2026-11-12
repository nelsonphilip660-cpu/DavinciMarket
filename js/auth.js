import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");
const message = document.getElementById("formMessage");

// ===================================
// USER REGISTRATION
// ===================================

if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    message.textContent = "Creating your account…";

    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const password = document.getElementById("password").value;
    const role = document.getElementById("role").value;

    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      await updateProfile(cred.user, {
        displayName: name
      });

      await setDoc(doc(db, "users", cred.user.uid), {
        name,
        email,
        phone,
        role,
        createdAt: serverTimestamp()
      });

      if (role === "seller") {
        window.location.replace("seller.html");
      } else {
        window.location.replace("index.html");
      }

    } catch (err) {
      message.textContent = err.message;
    }
  });
}

// ===================================
// PASSWORD RECOVERY
// ===================================

const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
const resetMessage = document.getElementById("resetMessage");

if (forgotPasswordBtn && loginForm) {

  forgotPasswordBtn.addEventListener("click", async () => {

    const email = document.getElementById("email").value.trim();

    if (!email) {
      resetMessage.style.color = "#e74c3c";
      resetMessage.textContent =
        "Please enter your email address first.";
      document.getElementById("email").focus();
      return;
    }

    forgotPasswordBtn.disabled = true;
    forgotPasswordBtn.textContent = "Sending email...";

    resetMessage.textContent = "";

    try {
      await sendPasswordResetEmail(auth, email);

      resetMessage.style.color = "#16a34a";
      resetMessage.textContent =
        "Password reset email sent! Check your inbox and spam folder.";

    } catch (err) {
      console.error("Password recovery error:", err);

      resetMessage.style.color = "#e74c3c";

      if (err.code === "auth/invalid-email") {
        resetMessage.textContent = "Please enter a valid email address.";
      } else if (err.code === "auth/too-many-requests") {
        resetMessage.textContent =
          "Too many attempts. Please try again later.";
      } else {
        resetMessage.textContent =
          "Unable to send reset email. Please try again.";
      }

    } finally {
      forgotPasswordBtn.disabled = false;
      forgotPasswordBtn.textContent = "Forgot Password?";
    }
  });
}

// ===================================
// USER AND ADMIN LOGIN
// ===================================

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    message.textContent = "Signing you in…";

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    try {
      const cred = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      const user = cred.user;

      message.textContent = "Checking account permissions…";

      // Check administrator
      const adminRef = doc(db, "admins", user.uid);
      const adminSnap = await getDoc(adminRef);

      if (adminSnap.exists()) {
        window.location.replace("admin.html");
        return;
      }

      // Check seller
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists() && userSnap.data().role === "seller") {
        window.location.replace("seller.html");
        return;
      }

      // Normal customer
      window.location.replace("index.html");

    } catch (err) {
      console.error("Login error:", err);
      message.textContent = err.message;
    }
  });
}