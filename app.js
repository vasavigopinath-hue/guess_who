// Everything is saved in the browser (IndexedDB), so boards are still there after a refresh.
//   boards: { id, name, bg, slots: [ null | { photo, blurred } ] }   one record per board
//   photos: { id, src }                                               the actual images
const DB_NAME = "guess-who";
const DB_VERSION = 3;
const MAX_SIDE = 900; // resize big photos so they load fast and fit in storage
const DEFAULT_SLOTS = 24; // two full rows of 12
const MAX_SLOTS = 240;

const BACKGROUNDS = [
  { id: "scene", label: "Cartoon sky", css: 'url("bg.svg")' },
  { id: "#1e3a8a", label: "Navy" },
  { id: "#6d28d9", label: "Purple" },
  { id: "#be185d", label: "Pink" },
  { id: "#15803d", label: "Green" },
  { id: "#c2410c", label: "Orange" },
  { id: "#111827", label: "Black" },
];

const board = document.getElementById("board");
const bulkInput = document.getElementById("bulk-input");
const slotInput = document.getElementById("slot-input");
const remainingOut = document.getElementById("remaining");
const menu = document.getElementById("menu");
const menuBtn = document.getElementById("menu-btn");
const boardList = document.getElementById("board-list");
const swatches = document.getElementById("swatches");
const bgBtn = document.getElementById("bg-btn");

let db;
let boards = [];
let current; // the board on screen
const photoSrc = new Map(); // photo id -> data URL
let pickingSlot = null;

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

// ---------- storage ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      const t = req.transaction;
      const boardStore = d.objectStoreNames.contains("boards") ? t.objectStore("boards") : d.createObjectStore("boards", { keyPath: "id" });
      const photoStore = d.objectStoreNames.contains("photos") ? t.objectStore("photos") : d.createObjectStore("photos", { keyPath: "id" });

      // Move a board saved by an older version of the game into the new format.
      const migrate = (storeName, toSlots) => {
        if (!d.objectStoreNames.contains(storeName)) return;
        t.objectStore(storeName).getAll().onsuccess = (e) => {
          const old = toSlots(e.target.result);
          let count = 0;
          try { count = Number(localStorage.getItem("guess-who-slots")) || 0; } catch {}
          const slots = Array.from({ length: Math.max(count || DEFAULT_SLOTS, old.length) }, () => null);
          old.forEach((p, i) => {
            if (!p) return;
            const id = newId();
            photoStore.put({ id, src: p.src });
            slots[i] = { photo: id, blurred: !!p.blurred };
          });
          boardStore.put({ id: newId(), name: "My Board", bg: "scene", slots, created: Date.now() });
          d.deleteObjectStore(storeName);
        };
      };
      migrate("slots", (rows) => {
        const out = [];
        rows.forEach((r) => (out[r.slot] = r));
        return out;
      });
      migrate("cards", (rows) => rows.sort((a, b) => a.order - b.order));
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function write(storeName, fn) {
  if (!db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, "readwrite");
    fn(t.objectStore(storeName));
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  }).catch((err) => console.warn(err));
}

function readAll(storeName) {
  if (!db) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName).objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const saveBoard = (b = current) => write("boards", (s) => s.put(b));
const savePhoto = (id, src) => write("photos", (s) => s.put({ id, src }));
const deletePhotos = (ids) => ids.length && write("photos", (s) => ids.forEach((id) => s.delete(id)));

function rememberCurrent() {
  try { localStorage.setItem("guess-who-board", current.id); } catch {}
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

async function putPhoto(b, i, file) {
  try {
    const src = await resizeImage(file);
    const id = newId();
    photoSrc.set(id, src);
    savePhoto(id, src);
    while (b.slots.length <= i) b.slots.push(null);
    if (b.slots[i]) deletePhotos([b.slots[i].photo]);
    b.slots[i] = { photo: id, blurred: false };
    saveBoard(b);
    if (b === current) render();
  } catch (err) {
    console.warn(err);
  }
}

// Fill blank slots in order (starting at startAt), adding more slots if needed.
async function fillBlank(files, startAt = 0) {
  const b = current;
  const images = [...files].filter((f) => f.type.startsWith("image/"));
  let i = startAt;
  for (const file of images) {
    while (b.slots[i]) i++;
    if (i >= MAX_SLOTS) break;
    await putPhoto(b, i, file);
    i++;
  }
}

// ---------- slots ----------

function addSlot() {
  if (current.slots.length >= MAX_SLOTS) return;
  current.slots.push(null);
  saveBoard();
  render();
}

// Delete one slot; the ones after it slide back to fill the gap.
function deleteSlot(i) {
  const [gone] = current.slots.splice(i, 1);
  if (gone) deletePhotos([gone.photo]);
  saveBoard();
  render();
}

// ---------- boards ----------

function makeBoard(name) {
  return { id: newId(), name, bg: "scene", slots: Array.from({ length: DEFAULT_SLOTS }, () => null), created: Date.now() };
}

function switchTo(b) {
  current = b;
  rememberCurrent();
  applyBackground();
  render();
}

function addBoard() {
  const name = prompt("Name your new board", `Board ${boards.length + 1}`);
  if (name === null) return;
  const b = makeBoard(name.trim() || `Board ${boards.length + 1}`);
  boards.push(b);
  saveBoard(b);
  switchTo(b);
  toggleMenu(false);
}

function renameBoard() {
  const name = prompt("Rename this board", current.name);
  if (name === null || !name.trim()) return;
  current.name = name.trim();
  saveBoard();
  render();
}

function deleteBoard() {
  if (!confirm(`Delete "${current.name}" and all its photos?`)) return;
  const gone = current;
  deletePhotos(gone.slots.filter(Boolean).map((s) => s.photo));
  write("boards", (s) => s.delete(gone.id));
  boards = boards.filter((b) => b !== gone);
  if (!boards.length) {
    boards.push(makeBoard("My Board"));
    saveBoard(boards[0]);
  }
  switchTo(boards[0]);
  toggleMenu(false);
}

function applyBackground() {
  const bg = current.bg || "scene";
  const solid = bg !== "scene";
  document.body.classList.toggle("solid-bg", solid);
  document.body.style.background = solid ? bg : "";
}

// ---------- rendering ----------

function render() {
  document.title = boards.length > 1 ? `${current.name} · Guess Who` : "Guess Who";
  board.innerHTML = "";
  current.slots.forEach((s, i) => board.appendChild(slotEl(s, i)));
  if (current.slots.length < MAX_SLOTS) board.appendChild(addTile());

  // Every slot counts; blurring one knocks it out.
  const left = current.slots.filter((s) => !(s && s.blurred)).length;
  remainingOut.textContent = `${left} of ${current.slots.length} remaining`;
  renderMenu();
}

function renderMenu() {
  boardList.innerHTML = "";
  for (const b of boards) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "menu-item";
    item.textContent = b.name;
    if (b === current) {
      item.disabled = true;
      item.setAttribute("aria-current", "true");
    } else {
      item.addEventListener("click", () => {
        switchTo(b);
        toggleMenu(false);
      });
    }
    boardList.appendChild(item);
  }

  swatches.innerHTML = "";
  for (const bg of BACKGROUNDS) {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "swatch";
    sw.title = bg.label;
    sw.setAttribute("aria-label", bg.label);
    sw.setAttribute("aria-pressed", String((current.bg || "scene") === bg.id));
    sw.style.background = bg.css ? `${bg.css} center / cover` : bg.id;
    sw.addEventListener("click", () => {
      current.bg = bg.id;
      saveBoard();
      applyBackground();
      renderMenu();
    });
    swatches.appendChild(sw);
  }
}

function addTile() {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "add-slot";
  el.innerHTML = '<span aria-hidden="true">+</span>Add slot';
  el.addEventListener("click", addSlot);
  return el;
}

function slotEl(s, i) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "slot" + (s ? (s.blurred ? " blurred" : "") : " empty");
  el.dataset.slot = i;

  const remove = document.createElement("span");
  remove.className = "remove";
  remove.setAttribute("role", "button");
  remove.textContent = "×";
  remove.title = "Delete this slot";
  remove.setAttribute("aria-label", "Delete this slot");

  if (!s) {
    el.setAttribute("aria-label", `Blank slot ${i + 1}: add a photo`);
    el.append(remove);
    return el;
  }

  el.setAttribute("aria-label", `Person ${i + 1}${s.blurred ? " (knocked out)" : ""}`);
  el.setAttribute("aria-pressed", String(s.blurred));

  const img = document.createElement("img");
  img.src = photoSrc.get(s.photo) || "";
  img.alt = "";
  img.draggable = false;
  el.append(img, remove);
  return el;
}

board.addEventListener("click", (e) => {
  const el = e.target.closest(".slot");
  if (!el) return;
  const i = Number(el.dataset.slot);
  const s = current.slots[i];

  if (e.target.closest(".remove")) {
    deleteSlot(i);
    return;
  }
  if (!s) {
    pickingSlot = i;
    slotInput.click();
    return;
  }
  s.blurred = !s.blurred;
  saveBoard();
  render();
});

slotInput.addEventListener("change", () => {
  if (pickingSlot !== null && slotInput.files[0]) putPhoto(current, pickingSlot, slotInput.files[0]);
  pickingSlot = null;
  slotInput.value = "";
});

// ---------- menu ----------

function toggleMenu(open = menu.hidden) {
  menu.hidden = !open;
  menuBtn.setAttribute("aria-expanded", String(open));
  if (!open) {
    swatches.hidden = true;
    bgBtn.setAttribute("aria-expanded", "false");
  }
}

menuBtn.addEventListener("click", () => toggleMenu());
document.addEventListener("click", (e) => {
  // e.target may have been re-rendered away (e.g. a swatch), so check it is still on the page
  if (!menu.hidden && e.target.isConnected && !menu.contains(e.target) && !menuBtn.contains(e.target)) toggleMenu(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") toggleMenu(false);
});

document.getElementById("new-board").addEventListener("click", addBoard);
document.getElementById("rename-board").addEventListener("click", renameBoard);
document.getElementById("delete-board").addEventListener("click", deleteBoard);

bgBtn.addEventListener("click", () => {
  swatches.hidden = !swatches.hidden;
  bgBtn.setAttribute("aria-expanded", String(!swatches.hidden));
});

bulkInput.addEventListener("change", () => {
  fillBlank(bulkInput.files);
  bulkInput.value = "";
  toggleMenu(false);
});

document.getElementById("reset").addEventListener("click", () => {
  current.slots.forEach((s) => s && (s.blurred = false));
  saveBoard();
  render();
  toggleMenu(false);
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
  try {
    db = await openDb();
    boards = (await readAll("boards")).sort((a, b) => (a.created || 0) - (b.created || 0));
    for (const p of await readAll("photos")) photoSrc.set(p.id, p.src);
  } catch (err) {
    console.warn("Saving is unavailable in this browser; boards will reset on refresh.", err);
  }
  if (!boards.length) {
    boards.push(makeBoard("My Board"));
    saveBoard(boards[0]);
  }
  let savedId = null;
  try { savedId = localStorage.getItem("guess-who-board"); } catch {}
  switchTo(boards.find((b) => b.id === savedId) || boards[0]);
})();
