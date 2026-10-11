// Photos are saved in the browser (IndexedDB), so the board is still there after a refresh.
const DB_NAME = "guess-who";
const STORE = "slots";
const MAX_SIDE = 900; // resize big photos so they load fast and fit in storage
const MIN_SLOTS = 4;
const MAX_SLOTS = 120;
const STEP = 4;

const board = document.getElementById("board");
const bulkInput = document.getElementById("bulk-input");
const slotInput = document.getElementById("slot-input");
const sizeInput = document.getElementById("size");
const countOut = document.getElementById("slot-count");
const menu = document.getElementById("menu");
const menuBtn = document.getElementById("menu-btn");

let db;
let slotCount = 24;
let photos = new Map(); // slot index -> { slot, src, blurred }
let pickingSlot = null;

// ---------- storage ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const d = req.result;
      const store = d.createObjectStore(STORE, { keyPath: "slot" });
      // Bring photos over from the first version of the board.
      if (e.oldVersion === 1 && d.objectStoreNames.contains("cards")) {
        const old = req.transaction.objectStore("cards");
        old.getAll().onsuccess = (ev) => {
          ev.target.result
            .sort((a, b) => a.order - b.order)
            .forEach((c, i) => store.put({ slot: i, src: c.src, blurred: c.blurred }));
          d.deleteObjectStore("cards");
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  if (!db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && result.result);
    t.onerror = () => reject(t.error);
  });
}

const savePhoto = (p) => tx("readwrite", (s) => s.put(p)).catch(() => {});
const deletePhoto = (slot) => tx("readwrite", (s) => s.delete(slot)).catch(() => {});
const clearPhotos = () => tx("readwrite", (s) => s.clear()).catch(() => {});
const loadPhotos = () => tx("readonly", (s) => s.getAll());

function savePref(key, value) {
  try { localStorage.setItem("guess-who-" + key, value); } catch {}
}
function loadPref(key) {
  try { return localStorage.getItem("guess-who-" + key); } catch { return null; }
}

// ---------- images ----------

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read " + file.name));
    };
    img.src = url;
  });
}

async function putPhoto(slot, file) {
  try {
    const p = { slot, src: await resizeImage(file), blurred: false };
    photos.set(slot, p);
    savePhoto(p);
    renderSlot(slot);
  } catch (err) {
    console.warn(err);
  }
}

// Fill empty slots in order, adding more slots if needed.
async function fillEmpty(files, startAt = 0) {
  const images = [...files].filter((f) => f.type.startsWith("image/"));
  let slot = startAt;
  for (const file of images) {
    while (photos.has(slot)) slot++;
    if (slot >= slotCount) setSlotCount(Math.ceil((slot + 1) / STEP) * STEP);
    await putPhoto(slot, file);
    slot++;
  }
}

// ---------- rendering ----------

function slotEl(i) {
  return board.children[i];
}

function renderBoard() {
  board.innerHTML = "";
  for (let i = 0; i < slotCount; i++) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "slot";
    el.dataset.slot = i;
    board.appendChild(el);
    renderSlot(i);
  }
}

function renderSlot(i) {
  const el = slotEl(i);
  if (!el) return;
  const p = photos.get(i);
  el.innerHTML = "";
  el.classList.toggle("empty", !p);
  el.classList.toggle("blurred", !!(p && p.blurred));

  if (!p) {
    el.setAttribute("aria-label", "Empty slot " + (i + 1) + ": add a photo");
    el.removeAttribute("aria-pressed");
    return;
  }

  el.setAttribute("aria-label", "Photo " + (i + 1) + (p.blurred ? " (blurred)" : ""));
  el.setAttribute("aria-pressed", String(p.blurred));
  const img = document.createElement("img");
  img.src = p.src;
  img.alt = "";
  img.draggable = false;

  const remove = document.createElement("span");
  remove.className = "remove";
  remove.setAttribute("role", "button");
  remove.setAttribute("aria-label", "Remove photo");
  remove.textContent = "×";

  el.append(img, remove);
}

board.addEventListener("click", (e) => {
  const el = e.target.closest(".slot");
  if (!el) return;
  const i = Number(el.dataset.slot);
  const p = photos.get(i);

  if (e.target.closest(".remove")) {
    photos.delete(i);
    deletePhoto(i);
    renderSlot(i);
    return;
  }
  if (!p) {
    pickingSlot = i;
    slotInput.click();
    return;
  }
  p.blurred = !p.blurred;
  savePhoto(p);
  renderSlot(i);
});

slotInput.addEventListener("change", () => {
  if (pickingSlot !== null && slotInput.files[0]) putPhoto(pickingSlot, slotInput.files[0]);
  pickingSlot = null;
  slotInput.value = "";
});

// ---------- menu ----------

function setSlotCount(n) {
  const lastPhoto = Math.max(-1, ...photos.keys());
  slotCount = Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, n, lastPhoto + 1));
  countOut.textContent = slotCount;
  savePref("slots", slotCount);
  renderBoard();
}

function setCardSize(px) {
  document.documentElement.style.setProperty("--card-size", px + "px");
  savePref("size", px);
}

function toggleMenu(open = menu.hidden) {
  menu.hidden = !open;
  menuBtn.setAttribute("aria-expanded", String(open));
}

menuBtn.addEventListener("click", () => toggleMenu());
document.addEventListener("click", (e) => {
  if (!menu.hidden && !menu.contains(e.target) && !menuBtn.contains(e.target)) toggleMenu(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") toggleMenu(false);
});

bulkInput.addEventListener("change", () => {
  fillEmpty(bulkInput.files);
  bulkInput.value = "";
  toggleMenu(false);
});

document.getElementById("fewer").addEventListener("click", () => setSlotCount(slotCount - STEP));
document.getElementById("more").addEventListener("click", () => setSlotCount(slotCount + STEP));
sizeInput.addEventListener("input", () => setCardSize(sizeInput.value));

document.getElementById("reset").addEventListener("click", () => {
  for (const p of photos.values()) {
    if (p.blurred) {
      p.blurred = false;
      savePhoto(p);
      renderSlot(p.slot);
    }
  }
});

document.getElementById("clear").addEventListener("click", () => {
  if (!photos.size || !confirm("Remove all photos from the board?")) return;
  photos.clear();
  clearPhotos();
  renderBoard();
});

// ---------- drag and drop ----------

let dragDepth = 0;
const hasFiles = (e) => [...e.dataTransfer.types].includes("Files");

window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  document.body.classList.add("dragging");
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove("dragging");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  // Dropping on a slot starts filling from that slot.
  const target = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.classList && n.classList.contains("slot"));
  fillEmpty(e.dataTransfer.files, target ? Number(target.dataset.slot) : 0);
});

// ---------- start up ----------

(async function init() {
  const size = loadPref("size");
  if (size) sizeInput.value = size;
  setCardSize(sizeInput.value);

  try {
    db = await openDb();
    for (const p of (await loadPhotos()) || []) photos.set(p.slot, p);
  } catch (err) {
    console.warn("Saving is unavailable in this browser; photos will reset on refresh.", err);
  }
  setSlotCount(Number(loadPref("slots")) || 24);
})();
