// GET /api/board   the saved boards everyone sees
// PUT /api/board   save boards (photos must already be uploaded through /api/photo)
import { allowedToSave, del, getBlob, listAll, putBlob, storageConnected, streamToText } from "./_store.js";

const STATE = "state/boards.json";
const PHOTO = /^\/api\/photo\?name=([0-9a-f]{64}\.jpg)$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const MAX_BOARDS = 50;
const MAX_SLOTS = 240;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!storageConnected()) return res.status(503).json({ error: "storage-not-connected" });

  try {
    if (req.method === "GET") {
      const found = await getBlob(STATE, { useCache: false });
      if (!found || !found.stream) return res.status(200).json({ savedAt: null, boards: [] });
      return res.status(200).json(JSON.parse(await streamToText(found.stream)));
    }

    if (req.method === "PUT") {
      if (!allowedToSave(req)) return res.status(401).json({ error: "wrong-password" });
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const boards = clean(body && body.boards);
      if (!boards) return res.status(400).json({ error: "bad-boards" });

      const savedAt = new Date().toISOString();
      await putBlob(STATE, JSON.stringify({ savedAt, boards }), {
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
      await removeUnusedPhotos(boards);
      return res.status(200).json({ savedAt });
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "method-not-allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "server-error" });
  }
}

// Keep only the fields the game uses, and reject anything malformed.
function clean(boards) {
  if (!Array.isArray(boards) || !boards.length || boards.length > MAX_BOARDS) return null;
  const out = [];
  for (const b of boards) {
    if (!b || typeof b.id !== "string" || b.id.length > 100) return null;
    if (!Array.isArray(b.slots) || b.slots.length > MAX_SLOTS) return null;
    const slots = [];
    for (const s of b.slots) {
      if (s === null) slots.push(null);
      else if (s && typeof s.photo === "string" && PHOTO.test(s.photo)) slots.push({ photo: s.photo });
      else return null;
    }
    out.push({
      id: b.id,
      name: String(b.name || "Board").slice(0, 60),
      bg: b.bg === "scene" || COLOR.test(String(b.bg)) ? b.bg : "scene",
      created: Number(b.created) || 0,
      slots,
    });
  }
  return out;
}

// Photos no board uses any more. Recent uploads are kept in case another save is mid-way.
async function removeUnusedPhotos(boards) {
  const used = new Set();
  for (const b of boards) for (const s of b.slots) if (s) used.add("photos/" + s.photo.match(PHOTO)[1]);
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const unused = (await listAll("photos/")).filter(
    (blob) => !used.has(blob.pathname) && new Date(blob.uploadedAt).getTime() < hourAgo
  );
  if (unused.length) await del(unused.map((blob) => blob.url));
}
