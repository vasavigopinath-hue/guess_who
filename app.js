// The board is saved in the browser (IndexedDB), so it's still there after a refresh.
const DB_NAME = "guess-who";
const STORE = "slots";
const MAX_SIDE = 900; // resize big photos so they load fast and fit in storage
const DEFAULT_SLOTS = 24; // two full rows of 12
const MAX_SLOTS = 240;

const board = document.getElementById("board");
const bulkInput = document.getElementById("bulk-input");
const slotInput = document.getElementById("slot-input");
const remainingOut = document.getElementById("remaining");
const menu = document.getElementById("menu");
const menuBtn = document.getElementById("menu-btn");

let db;
// One entry per slot: null for a blank slot, or { src, blurred } for a photo.
let slots = [];
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

function tx(fn) {
  if (!db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && result.result);
    t.onerror = () => reject(t.error);
  }).catch((err) => console.warn(err));
}

function saveSlot(i) {
  const p = slots[i];
  return tx((s) => (p ? s.put({ slot: i, src: p.src, blurred: p.blurred }) : s.delete(i)));
}

// Used when slots shift position (a slot was deleted in the middle).
function saveAll() {
  return tx((s) => {
    s.clear();
    slots.forEach((p, i) => p && s.put({ slot: i, src: p.src, blurred: p.blurred }));
  });
}

function loadPhotos() {
  if (!db) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function saveCount() {
  try { localStorage.setItem("guess-who-slots", slots.length); } catch {}
}
function loadCount() {
  try {
    const v = localStorage.getItem("guess-who-slots");
    return v === null ? null : Number(v);
  } catch { return null; }
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

async function putPhoto(i, file) {
  try {
    const src = await resizeImage(file);
    while (slots.length <= i) slots.push(null);
    slots[i] = { src, blurred: false };
    saveSlot(i);
    saveCount();
    render();
  } catch (err) {
    console.warn(err);
  }
}

// Fill blank slots in order (starting at startAt), adding more slots if needed.
async function fillBlank(files, startAt = 0) {
  const images = [...files].filter((f) => f.type.startsWith("image/"));
  let i = startAt;
  for (const file of images) {
    while (slots[i]) i++;
    if (i >= MAX_SLOTS) break;
    await putPhoto(i, file);
    i++;
  }
}

// ---------- slots ----------

function addSlot() {
  if (slots.length >= MAX_SLOTS) return;
  slots.push(null);
  saveCount();
  render();
}

// Delete one specific slot; the ones after it slide back to fill the gap.
function deleteSlot(i) {
  slots.splice(i, 1);
  saveAll();
  saveCount();
  render();
}

// ---------- rendering ----------

function render() {
  board.innerHTML = "";
  slots.forEach((p, i) => board.appendChild(slotEl(p, i)));
  if (slots.length < MAX_SLOTS) board.appendChild(addTile());

  // Every slot counts; blurring one knocks it out.
  const left = slots.filter((p) => !(p && p.blurred)).length;
  remainingOut.textContent = `${left} of ${slots.length} remaining`;
}

function addTile() {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "add-slot";
  el.innerHTML = '<span aria-hidden="true">+</span>Add slot';
  el.addEventListener("click", addSlot);
  return el;
}

function slotEl(p, i) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "slot" + (p ? (p.blurred ? " blurred" : "") : " empty");
  el.dataset.slot = i;

  const remove = document.createElement("span");
  remove.className = "remove";
  remove.setAttribute("role", "button");
  remove.textContent = "×";

  remove.title = "Delete this slot";
  remove.setAttribute("aria-label", "Delete this slot");

  if (!p) {
    el.setAttribute("aria-label", `Blank slot ${i + 1}: add a photo`);
    el.append(remove);
    return el;
  }

  el.setAttribute("aria-label", `Person ${i + 1}${p.blurred ? " (knocked out)" : ""}`);
  el.setAttribute("aria-pressed", String(p.blurred));

  const img = document.createElement("img");
  img.src = p.src;
  img.alt = "";
  img.draggable = false;
  el.append(img, remove);
  return el;
}

board.addEventListener("click", (e) => {
  const el = e.target.closest(".slot");
  if (!el) return;
  const i = Number(el.dataset.slot);
  const p = slots[i];

  if (e.target.closest(".remove")) {
    deleteSlot(i);
    return;
  }
  if (!p) {
    pickingSlot = i;
    slotInput.click();
    return;
  }
  p.blurred = !p.blurred;
  saveSlot(i);
  render();
});

slotInput.addEventListener("change", () => {
  if (pickingSlot !== null && slotInput.files[0]) putPhoto(pickingSlot, slotInput.files[0]);
  pickingSlot = null;
  slotInput.value = "";
});

// ---------- controls ----------

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
  fillBlank(bulkInput.files);
  bulkInput.value = "";
  toggleMenu(false);
});

document.getElementById("reset").addEventListener("click", () => {
  slots.forEach((p, i) => {
    if (p && p.blurred) {
      p.blurred = false;
      saveSlot(i);
    }
  });
  render();
});

document.getElementById("clear").addEventListener("click", () => {
  if (!slots.some(Boolean) || !confirm("Remove all photos from the board?")) return;
  slots = slots.map(() => null);
  saveAll();
  render();
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
  fillBlank(e.dataTransfer.files, target ? Number(target.dataset.slot) : 0);
});

// ---------- start up ----------

(async function init() {
  let saved = [];
  try {
    db = await openDb();
    saved = (await loadPhotos()) || [];
  } catch (err) {
    console.warn("Saving is unavailable in this browser; photos will reset on refresh.", err);
  }
  const lastPhoto = Math.max(-1, ...saved.map((p) => p.slot));
  const storedCount = loadCount();
  const count = Math.max(storedCount ?? DEFAULT_SLOTS, lastPhoto + 1);
  slots = Array.from({ length: count }, () => null);
  for (const p of saved) slots[p.slot] = { src: p.src, blurred: p.blurred };
  render();
})();
