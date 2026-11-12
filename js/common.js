import { auth } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
const toggle=document.getElementById("menuToggle"),nav=document.getElementById("mainNav");
if(toggle&&nav)toggle.addEventListener("click",()=>nav.classList.toggle("open"));
const year=document.getElementById("year");if(year)year.textContent=new Date().getFullYear();
const logout=document.getElementById("logoutBtn");if(logout)logout.addEventListener("click",async()=>{await signOut(auth);location.href="index.html";});
onAuthStateChanged(auth,user=>{const login=document.getElementById("navLogin"),register=document.getElementById("navRegister");if(user){login?.classList.add("hidden");register?.classList.add("hidden");}else{login?.classList.remove("hidden");register?.classList.remove("hidden");}});