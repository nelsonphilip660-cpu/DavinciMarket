import { sellerProfiles } from "./seller-data.js";
import { db } from "./firebase.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
const slider=document.getElementById("aboutSlider"),track=document.getElementById("aboutSliderTrack"),dots=document.getElementById("aboutSliderDots"),count=document.getElementById("aboutSlideCount");
let currentSlide=0;
function addFeaturedSlide(profile){
  if(!profile?.uid||!profile.profilePhoto)return;
  const slide=document.createElement("a");slide.className="about-slide featured-seller-slide";slide.href=`seller-profile.html?id=featured-${encodeURIComponent(profile.uid)}`;
  const img=document.createElement("img");img.src=profile.profilePhoto;img.alt=`${profile.name||"Seller"} from ${profile.businessName||""}`;img.loading="lazy";
  const caption=document.createElement("span");caption.className="about-slide-caption";
  const label=document.createElement("small");label.className="profile-demo-label";label.textContent="FEATURED SELLER";
  const name=document.createElement("strong");name.className="creator-name";name.textContent=profile.businessName||profile.name||"DavinciMarket seller";
  const handle=document.createElement("span");handle.className="profile-handle";
  const handleText=document.createElement("span");handleText.className="profile-handle-at";handleText.textContent=profile.handle||profile.businessName||"View business";
  const arrow=document.createElement("span");arrow.className="profile-handle-arrow";arrow.setAttribute("aria-hidden","true");arrow.textContent="↗";
  handle.append(handleText,arrow);caption.append(label,name,handle);slide.append(img,caption);track.append(slide);
}
function setupSlider(){
  const slides=Array.from(track.children);if(!slider||!track||!dots||!count||!slides.length)return;dots.replaceChildren();
  slides.forEach((slide,index)=>{
    const destination=new URL(slide.getAttribute("href"),window.location.href),id=destination.searchParams.get("id"),profile=sellerProfiles[id],image=slide.querySelector("img");
    if(profile){if(profile.name)slide.querySelector(".creator-name").textContent=profile.name;if(profile.handle)slide.querySelector(".profile-handle-at").textContent=profile.handle;slide.querySelector(".profile-demo-label").textContent=profile.verified?"VERIFIED SELLER":"FEATURED SELLER";if(image&&profile.portrait)image.src=profile.portrait;}
    if(image){destination.searchParams.set("photo",new URL(image.getAttribute("src")||image.src,window.location.href).href);slide.href=destination.href;}
    const dot=document.createElement("button");dot.type="button";dot.className="about-slider-dot";dot.setAttribute("aria-label",`Show seller ${index+1}`);dot.addEventListener("click",()=>goToSlide(index));dots.append(dot);
  });
  const dotButtons=Array.from(dots.children);
  function goToSlide(index){currentSlide=(index+slides.length)%slides.length;slides.forEach((slide,i)=>slide.classList.toggle("is-active",i===currentSlide));track.style.transform=`translateX(-${currentSlide*100}%)`;dotButtons.forEach((dot,i)=>dot.setAttribute("aria-current",String(i===currentSlide)));count.textContent=`${String(currentSlide+1).padStart(2,"0")} / ${String(slides.length).padStart(2,"0")}`;}
  document.getElementById("aboutSlidePrev").onclick=()=>goToSlide(currentSlide-1);document.getElementById("aboutSlideNext").onclick=()=>goToSlide(currentSlide+1);
  slider.onkeydown=event=>{if(event.key==="ArrowLeft")goToSlide(currentSlide-1);if(event.key==="ArrowRight")goToSlide(currentSlide+1);};goToSlide(0);
}
if(slider&&track&&dots&&count){
  setupSlider();
  getDocs(query(collection(db,"featuredSellerProfiles"),where("status","==","published")))
    .then(snapshot=>{const profiles=snapshot.docs.map(item=>item.data()).filter(profile=>profile.expiresAt?.toDate?.().getTime()>Date.now());profiles.forEach(addFeaturedSlide);if(profiles.length)setupSlider();})
    .catch(error=>console.warn("Unable to load featured seller profiles:",error));
}
