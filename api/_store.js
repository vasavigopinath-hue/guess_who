// Shared helpers for the save/load functions. Files starting with "_" are not routes.
import { get, put, list, del } from "@vercel/blob";

// This project's Blob store is private, so every read and write uses private
// access (set BLOB_ACCESS=public in Vercel only if you switch to a public store).
const access = process.env.BLOB_ACCESS === "public" ? "public" : "private";

export const storageConnected = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

// If SAVE_PASSWORD is set in Vercel, saving needs it. Loading never does.
export function allowedToSave(req) {
  const pw = process.env.SAVE_PASSWORD;
  return !pw || req.headers["x-save-password"] === pw;
}

export function putBlob(pathname, body, options) {
  return put(pathname, body, { ...options, access });
}

// Returns the get() result, or null if the blob doesn't exist.
export async function getBlob(pathname, options = {}) {
  const result = await get(pathname, { ...options, access });
  return result && result.statusCode === 200 ? result : null;
}

export async function listAll(prefix) {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

export { del };

export async function streamToText(stream) {
  return new Response(stream).text();
}

// The raw request body as a Buffer (Vercel parses octet-stream bodies into a Buffer).
export async function rawBody(req, limit) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// A short, safe description of what went wrong, shown in the game's error popup.
// Includes which deployment answered, so an old frozen copy is easy to spot.
export function describe(err) {
  const version = (process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7);
  return `${(err && err.name) || "Error"}: ${String((err && err.message) || err).slice(0, 200)} [server ${version}]`;
}
