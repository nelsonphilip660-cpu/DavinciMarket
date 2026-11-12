let dialog;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "product-gallery-dialog";
  dialog.innerHTML = `
    <div class="product-gallery-shell">
      <button class="product-gallery-close" type="button" aria-label="Close photo gallery">×</button>
      <h2 class="product-gallery-title"></h2>
      <div class="product-gallery-stage">
        <button class="product-gallery-prev" type="button" aria-label="Previous photo">‹</button>
        <img class="product-gallery-image" alt="">
        <button class="product-gallery-next" type="button" aria-label="Next photo">›</button>
      </div>
      <p class="product-gallery-count" aria-live="polite"></p>
    </div>`;
  document.body.appendChild(dialog);

  const image = dialog.querySelector(".product-gallery-image");
  const count = dialog.querySelector(".product-gallery-count");
  const prev = dialog.querySelector(".product-gallery-prev");
  const next = dialog.querySelector(".product-gallery-next");
  let slides = [];
  let index = 0;

  function render() {
    image.src = slides[index];
    image.alt = `Product photo ${index + 1} of ${slides.length}`;
    count.textContent = `${index + 1} / ${slides.length}`;
    prev.hidden = slides.length < 2;
    next.hidden = slides.length < 2;
  }

  dialog.openGallery = (photos, title) => {
    slides = photos;
    index = 0;
    dialog.querySelector(".product-gallery-title").textContent = title || "Product photos";
    render();
    dialog.showModal();
  };
  prev.addEventListener("click", () => { index = (index - 1 + slides.length) % slides.length; render(); });
  next.addEventListener("click", () => { index = (index + 1) % slides.length; render(); });
  dialog.querySelector(".product-gallery-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  return dialog;
}

export function openProductGallery(photos, title) {
  const slides = (Array.isArray(photos) ? photos : [photos]).filter(url => typeof url === "string" && url.trim());
  if (!slides.length) return;
  ensureDialog().openGallery(slides.slice(0, 5), title);
}
