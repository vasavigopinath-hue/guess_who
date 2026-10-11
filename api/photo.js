// GET  /api/photo?name=<sha256>.jpg   serves a saved photo
// POST /api/photo?name=<sha256>.jpg   stores a photo (body: the JPEG bytes)
import { Readable } from "node:stream";
import { allowedToSave, getBlob, putBlob, rawBody, storageConnected } from "./_store.js";

const NAME = /^[0-9a-f]{64}\.jpg$/;
const MAX_BYTES = 4 * 1024 * 1024;

export default async function handler(req, res) {
  const name = String(req.query.name || "");
  if (!NAME.test(name)) return res.status(400).json({ error: "bad-name" });
  if (!storageConnected()) return res.status(503).json({ error: "storage-not-connected" });

  try {
    if (req.method === "GET") {
      const found = await getBlob(`photos/${name}`);
      if (!found || !found.stream) return res.status(404).json({ error: "not-found" });
      // The name is the photo's fingerprint, so its contents never change.
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      Readable.fromWeb(found.stream).pipe(res);
      return;
    }

    if (req.method === "POST") {
      if (!allowedToSave(req)) return res.status(401).json({ error: "wrong-password" });
      const body = await rawBody(req, MAX_BYTES);
      if (!body.length) return res.status(400).json({ error: "empty" });
      if (body[0] !== 0xff || body[1] !== 0xd8) return res.status(415).json({ error: "not-a-jpeg" });
      await putBlob(`photos/${name}`, body, {
        contentType: "image/jpeg",
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return res.status(200).json({ url: `/api/photo?name=${name}` });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method-not-allowed" });
  } catch (err) {
    console.error(err);
    return res.status(err.status || 500).json({ error: err.status === 413 ? "too-large" : "server-error" });
  }
}
