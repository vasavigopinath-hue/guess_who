// Everything is saved in the browser (IndexedDB), so boards are still there after a refresh.
//   boards: { id, name, bg, slots: [ null | { photo, blurred } ] }   one record per board
//   photos: { id, src }                                               the actual images
// A fresh database name, so opening it never has to wait for an old tab that still
// has the previous version's database open. Old boards are copied over once.
const DB_NAME = "guess-who-boards";
const DB_VERSION = 1;
const OLD_DB_NAME = "guess-who";
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
      if (!d.objectStoreNames.contains("boards")) d.createObjectStore("boards", { keyPath: "id" });
      if (!d.objectStoreNames.contains("photos")) d.createObjectStore("photos", { keyPath: "id" });
    };
    req.onsuccess = () => {
      const d = req.result;
      // If a future version of the game needs to upgrade, step aside instead of blocking it.
      d.onversionchange = () => {
        d.close();
        location.reload();
      };
      resolve(d);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Database is busy in another tab"));
  });
}

// Read what an older version of the game saved, without changing it. Resolves to
// { boards, photos } in the current format, or null if there's nothing to bring over.
function readOldData() {
  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(OLD_DB_NAME); // no version: never triggers an upgrade
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => req.transaction.abort(); // it didn't exist; don't create it
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
    req.onsuccess = () => {
      const d = req.result;
      const names = ["boards", "photos", "slots", "cards"].filter((n) => d.objectStoreNames.contains(n));
      if (!names.length) {
        d.close();
        return resolve(null);
      }
      const t = d.transaction(names);
      const got = {};
      names.forEach((n) => (t.objectStore(n).getAll().onsuccess = (e) => (got[n] = e.target.result)));
      t.onerror = () => {
        d.close();
        resolve(null);
      };
      t.oncomplete = () => {
        d.close();
        resolve(convertOld(got));
      };
    };
  });
}

function convertOld(got) {
  // The short-lived multi-board version already used the current format.
  if (got.boards && got.boards.length) return { boards: got.boards, photos: got.photos || [] };

  // Single-board versions: one photo per slot.
  let slots = [];
  if (got.slots) got.slots.forEach((r) => (slots[r.slot] = r));
  else if (got.cards) slots = got.cards.sort((a, b) => a.order - b.order);
  if (!slots.length) return null;

  let count = 0;
  try { count = Number(localStorage.getItem("guess-who-slots")) || 0; } catch {}
  const b = makeBoard("My Board");
  const photos = [];
  b.slots = Array.from({ length: Math.max(count || DEFAULT_SLOTS, slots.length) }, (_, i) => {
    const p = slots[i];
    if (!p || !p.src) return null;
    const id = newId();
    photos.push({ id, src: p.src });
    return { photo: id, blurred: !!p.blurred };
  });
  return { boards: [b], photos };
}

// Runs until it has finished once, so a slow first try is retried on the next visit.
async function importOldData() {
  try {
    if (localStorage.getItem("guess-who-imported")) return [];
  } catch {}
  const done = () => {
    try { localStorage.setItem("guess-who-imported", "1"); } catch {}
  };
  const old = await readOldData();
  if (!old) {
    done();
    return [];
  }
  await write("photos", (s) => old.photos.forEach((p) => s.put(p)));
  await write("boards", (s) => old.boards.forEach((b) => s.put(b)));
  done();
  old.photos.forEach((p) => photoSrc.set(p.id, p.src));
  return old.boards;
}

// Give up waiting on storage after a few seconds so the board always shows.
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out")), ms))]);
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
    markDirty();
    if (b === current) render();
  } catch (err) {
    console.warn(err);
  }
}

// Fill blank slots in order (starting at startAt), adding more slots if needed.
async function fillBlank(files, startAt = 0) {
  if (!editing) return;
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
  if (!editing || current.slots.length >= MAX_SLOTS) return;
  current.slots.push(null);
  saveBoard();
  markDirty();
  render();
}

// Delete one slot; the ones after it slide back to fill the gap.
function deleteSlot(i) {
  if (!editing) return;
  const [gone] = current.slots.splice(i, 1);
  if (gone) deletePhotos([gone.photo]);
  saveBoard();
  markDirty();
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
  if (!editing) return;
  const name = prompt("Name your new board", `Board ${boards.length + 1}`);
  if (name === null) return;
  const b = makeBoard(name.trim() || `Board ${boards.length + 1}`);
  boards.push(b);
  saveBoard(b);
  markDirty();
  switchTo(b);
  toggleMenu(false);
}

function renameBoard() {
  if (!editing) return;
  const name = prompt("Rename this board", current.name);
  if (name === null || !name.trim()) return;
  current.name = name.trim();
  saveBoard();
  markDirty();
  render();
}

function deleteBoard() {
  if (!editing) return;
  if (!confirm(`Delete "${current.name}" and all its photos?`)) return;
  const gone = current;
  deletePhotos(gone.slots.filter(Boolean).map((s) => s.photo));
  write("boards", (s) => s.delete(gone.id));
  boards = boards.filter((b) => b !== gone);
  if (!boards.length) {
    boards.push(makeBoard("My Board"));
    saveBoard(boards[0]);
  }
  markDirty();
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
  if (editing && current.slots.length < MAX_SLOTS) board.appendChild(addTile());

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
      if (!editing) return;
      current.bg = bg.id;
      saveBoard();
      markDirty();
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
    el.setAttribute("aria-label", editing ? `Blank slot ${i + 1}: add a photo` : `Blank slot ${i + 1}`);
    if (editing) el.append(remove);
    else el.disabled = true;
    return el;
  }

  el.setAttribute("aria-label", `Person ${i + 1}${s.blurred ? " (knocked out)" : ""}`);
  el.setAttribute("aria-pressed", String(s.blurred));

  const img = document.createElement("img");
  img.src = photoSrc.get(s.photo) || (s.photo.startsWith("/api/") ? s.photo : "");
  img.alt = "";
  img.draggable = false;
  el.append(img);
  if (editing) el.append(remove);
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
    if (!editing) return;
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
  if (!hasFiles(e) || !editing) return;
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

// ---------- saving to the website ----------
// Save uploads every board and photo, so the site shows them on any device.
// Blur state isn't saved: each device plays its own round.

const saveBtn = document.getElementById("save-btn");
const saveLabel = document.getElementById("save-label");
const pref = (key, value) => {
  try {
    if (value === undefined) return localStorage.getItem("guess-who-" + key);
    if (value === null) localStorage.removeItem("guess-who-" + key);
    else localStorage.setItem("guess-who-" + key, value);
  } catch {}
  return null;
};
let dirty = pref("dirty") === "1";
let saving = false;

// After saving, the board is locked: you can still knock people out and switch
// boards, but adding, deleting and changing things waits until you press Edit.
// A device that has never saved starts in edit mode so you can build a board.
let editing = pref("editing") !== null ? pref("editing") === "1" : !pref("synced");
document.body.classList.toggle("locked", !editing);

function setEditing(on) {
  editing = on;
  pref("editing", on ? "1" : "0");
  document.body.classList.toggle("locked", !on);
  toggleMenu(false);
  render();
  showSaveState();
}

function markDirty() {
  dirty = true;
  pref("dirty", "1");
  showSaveState();
}

function showSaveState(text) {
  saveLabel.textContent = text || (saving ? "Saving…" : !editing ? "Edit" : "Save");
  saveBtn.classList.toggle("unsaved", editing && dirty && !saving);
  saveBtn.title = editing ? "Save your boards to the website and lock them" : "Unlock the board to add, delete or change things";
  saveBtn.disabled = saving;
}

async function sha256(buffer) {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// fetch() that asks for the save password once if the site has one set.
async function sendWithPassword(url, options) {
  for (let tries = 0; tries < 3; tries++) {
    const res = await fetch(url, { ...options, headers: { ...options.headers, "X-Save-Password": pref("pw") || "" } });
    if (res.status !== 401) return res;
    const pw = prompt(tries ? "That password didn't work. Try again:" : "Enter the save password:");
    if (pw === null) throw new Error("cancelled");
    pref("pw", pw);
  }
  throw new Error("wrong-password");
}

async function uploadPhoto(src) {
  const bytes = await (await fetch(src)).arrayBuffer();
  const name = (await sha256(bytes)) + ".jpg";
  const res = await sendWithPassword(`/api/photo?name=${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  if (!res.ok) throw Object.assign(new Error("upload failed"), { status: res.status });
  return (await res.json()).url;
}

async function saveToSite() {
  if (saving) return;
  // Nothing new since the last save: just lock.
  if (!dirty && pref("synced")) return setEditing(false);
  saving = true;
  showSaveState();
  try {
    // 1. Upload photos that only exist on this device.
    const local = new Set();
    for (const b of boards) for (const s of b.slots) if (s && (photoSrc.get(s.photo) || "").startsWith("data:")) local.add(s.photo);
    let done = 0;
    for (const id of local) {
      showSaveState(`Saving ${++done}/${local.size}…`);
      const url = await uploadPhoto(photoSrc.get(id));
      for (const b of boards) for (const s of b.slots) if (s && s.photo === id) s.photo = url;
      photoSrc.set(url, url);
      photoSrc.delete(id);
      await write("photos", (st) => {
        st.delete(id);
        st.put({ id: url, src: url });
      });
    }
    await write("boards", (st) => boards.forEach((b) => st.put(b)));

    // 2. Save the boards themselves.
    showSaveState("Saving…");
    const res = await sendWithPassword("/api/board", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        boards: boards.map((b) => ({ id: b.id, name: b.name, bg: b.bg, created: b.created, slots: b.slots.map((s) => s && { photo: s.photo }) })),
      }),
    });
    if (!res.ok) throw Object.assign(new Error("save failed"), { status: res.status });
    pref("synced", (await res.json()).savedAt);
    dirty = false;
    pref("dirty", null);
    editing = false; // locked until Edit is pressed (setEditing runs below, after rendering)
  } catch (err) {
    console.warn(err);
    if (err.message !== "cancelled") alert(saveErrorMessage(err));
  } finally {
    saving = false;
    setEditing(editing); // re-renders: photos may now point at their saved copies
  }
}

function saveErrorMessage(err) {
  if (err.status === 503) return "Saving isn't set up yet: connect a Blob store to this project in Vercel (Storage → Blob), then redeploy.";
  if (err.status === 404) return "Saving only works on the Vercel site, not on a local copy.";
  if (err.message === "wrong-password") return "Wrong save password, so nothing was saved.";
  return "Couldn't save right now. Check your internet connection and try again.";
}

// Load the boards saved on the site if they're newer than what this device has.
async function loadFromSite() {
  let data;
  try {
    const res = await withTimeout(fetch("/api/board", { cache: "no-store" }), 6000);
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return; // offline or not on Vercel: keep using what's on this device
  }
  if (!data.savedAt || !Array.isArray(data.boards) || !data.boards.length) return;
  if (data.savedAt === pref("synced")) return;
  if (dirty && !confirm("There's a newer saved version of the boards on the website. Load it?\n\nChanges on this device that weren't saved will be replaced.")) {
    pref("synced", data.savedAt); // don't ask again for this version; saving will overwrite it
    return;
  }

  // Keep this device's blur state for photos that are still in the same spot.
  const blurredBefore = new Set();
  for (const b of boards) b.slots.forEach((s, i) => s && s.blurred && blurredBefore.add(`${b.id}|${i}|${s.photo}`));
  boards = data.boards.map((b) => ({
    ...b,
    slots: b.slots.map((s, i) => s && { photo: s.photo, blurred: blurredBefore.has(`${b.id}|${i}|${s.photo}`) }),
  }));
  photoSrc.clear();
  for (const b of boards) for (const s of b.slots) if (s) photoSrc.set(s.photo, s.photo);
  await write("photos", (st) => {
    st.clear();
    for (const id of photoSrc.keys()) st.put({ id, src: id });
  });
  await write("boards", (st) => {
    st.clear();
    boards.forEach((b) => st.put(b));
  });
  pref("synced", data.savedAt);
  dirty = false;
  pref("dirty", null);
  editing = false;
  pref("editing", "0");
  document.body.classList.add("locked");
  switchTo(boards.find((b) => current && b.id === current.id) || boards[0]);
  showSaveState();
}

saveBtn.addEventListener("click", () => (editing ? saveToSite() : setEditing(true)));
showSaveState();

// ---------- start up ----------

(async function init() {
  try {
    db = await withTimeout(openDb(), 4000);
    boards = (await readAll("boards")).sort((a, b) => (a.created || 0) - (b.created || 0));
    for (const p of await readAll("photos")) photoSrc.set(p.id, p.src);
    const imported = await withTimeout(importOldData(), 4000).catch(() => []);
    const have = new Set(boards.map((b) => b.id));
    boards = boards.concat(imported.filter((b) => !have.has(b.id))).sort((a, b) => (a.created || 0) - (b.created || 0));
  } catch (err) {
    db = null;
    console.warn("Saving is unavailable right now; changes won't be kept after a refresh.", err);
  }
  if (!boards.length) {
    boards.push(makeBoard("My Board"));
    saveBoard(boards[0]);
  }
  let savedId = null;
  try { savedId = localStorage.getItem("guess-who-board"); } catch {}
  // Photos added before this device ever saved haven't reached the website yet.
  if (!pref("synced") && boards.some((b) => b.slots.some(Boolean))) markDirty();
  switchTo(boards.find((b) => b.id === savedId) || boards[0]);
  loadFromSite();
})();
