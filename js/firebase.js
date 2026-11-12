import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

import { getFirestore } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

import { getStorage } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-storage.js";

import { getFunctions } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-functions.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// IMPORTANT: Must match your Cloud Function region
const functions = getFunctions(app, "africa-south1");

export { app, auth, db, storage, functions };