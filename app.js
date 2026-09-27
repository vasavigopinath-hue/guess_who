// Photos are saved in the browser (IndexedDB), so the board is still there after a refresh.
const DB_NAME = "guess-who";
const STORE = "cards";
const MAX_SIDE = 900; // resize big photos so they load fast and fit in storage

const board = document.getElementById("board");
const empty = document.getElementById("empty");
const fileInput = document.getElementById("file-input");
const sizeInput = document.getElementById("size");

let db;
let cards = [];

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
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

const saveCard = (card) => tx("readwrite", (s) => s.put(card)).catch(() => {});
const deleteCard = (id) => tx("readwrite", (s) => s.delete(id)).catch(() => {});
const clearCards = () => tx("readwrite", (s) => s.clear()).catch(() => {});
const loadCards = () => tx("readonly", (s) => s.getAll());

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

function nameFromFile(file) {
  return file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
}

async function addFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith("image/"));
  for (const file of images) {
    try {
      const card = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
        src: await resizeImage(file),
        name: nameFromFile(file),
        blurred: false,
        order: Date.now() + cards.length,
      };
      cards.push(card);
      board.appendChild(renderCard(card));
      saveCard(card);
    } catch (err) {
      console.warn(err);
    }
  }
  updateEmpty();
}

function renderCard(card) {
  const el = document.createElement("div");
  el.className = "card" + (card.blurred ? " blurred" : "");
  el.dataset.id = card.id;

  const photo = document.createElement("button");
  photo.className = "photo";
  photo.type = "button";
  photo.setAttribute("aria-pressed", String(card.blurred));
  photo.title = "Click to blur / unblur";
  const img = document.createElement("img");
  img.src = card.src;
  img.alt = card.name || "Photo";
  img.draggable = false;
  photo.appendChild(img);
  photo.addEventListener("click", () => {
    card.blurred = !card.blurred;
    el.classList.toggle("blurred", card.blurred);
    photo.setAttribute("aria-pressed", String(card.blurred));
    saveCard(card);
  });

  const name = document.createElement("input");
  name.className = "name";
  name.value = card.name;
  name.placeholder = "Add a name";
  name.addEventListener("input", () => {
    card.name = name.value;
    img.alt = card.name || "Photo";
    saveCard(card);
  });

  const remove = document.createElement("button");
  remove.className = "remove";
  remove.type = "button";
  remove.textContent = "×";
  remove.title = "Remove this photo";
  remove.addEventListener("click", () => {
    cards = cards.filter((c) => c.id !== card.id);
    el.remove();
    deleteCard(card.id);
    updateEmpty();
  });

  el.append(photo, name, remove);
  return el;
}

function updateEmpty() {
  empty.hidden = cards.length > 0;
}

function setCardSize(px) {
  document.documentElement.style.setProperty("--card-size", px + "px");
  try { localStorage.setItem("guess-who-size", px); } catch {}
}

// Controls
fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});

sizeInput.addEventListener("input", () => setCardSize(sizeInput.value));

document.getElementById("reset").addEventListener("click", () => {
  for (const card of cards) {
    if (card.blurred) {
      card.blurred = false;
      saveCard(card);
    }
  }
  board.querySelectorAll(".card.blurred").forEach((el) => {
    el.classList.remove("blurred");
    el.querySelector(".photo").setAttribute("aria-pressed", "false");
  });
});

document.getElementById("clear").addEventListener("click", () => {
  if (!cards.length || !confirm("Remove all photos from the board?")) return;
  cards = [];
  board.innerHTML = "";
  clearCards();
  updateEmpty();
});

// Drag and drop photos anywhere on the page
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if (![...e.dataTransfer.types].includes("Files")) return;
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
  addFiles(e.dataTransfer.files);
});

// Start up
(async function init() {
  try {
    const saved = localStorage.getItem("guess-who-size");
    if (saved) sizeInput.value = saved;
  } catch {}
  setCardSize(sizeInput.value);

  try {
    db = await openDb();
    cards = ((await loadCards()) || []).sort((a, b) => a.order - b.order);
    cards.forEach((card) => board.appendChild(renderCard(card)));
  } catch (err) {
    console.warn("Saving is unavailable in this browser; photos will reset on refresh.", err);
  }
  updateEmpty();
})();
