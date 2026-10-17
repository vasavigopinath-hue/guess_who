// Shared helpers for the save/load functions. Files starting with "_" are not routes.
import { get, put, list, del } from "@vercel/blob";

// A Blob store is either public or private. Try public first and remember what works.
let access = process.env.BLOB_ACCESS || null;
const modes = () => (access ? [access] : ["public", "private"]);

// Connected stores get either a read-write token or (newer) a store id used with
// Vercel's built-in OIDC login; the Blob library handles both.
export const storageConnected = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

// If SAVE_PASSWORD is set in Vercel, saving needs it. Loading never does.
export function allowedToSave(req) {
  const pw = process.env.SAVE_PASSWORD;
  return !pw || req.headers["x-save-password"] === pw;
}

export async function putBlob(pathname, body, options) {
  let lastErr;
  for (const mode of modes()) {
    try {
      const result = await put(pathname, body, { ...options, access: mode });
      access = mode;
      return result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// Returns the get() result, or null if the blob doesn't exist.
export async function getBlob(pathname, options = {}) {
  let lastErr;
  for (const mode of modes()) {
    try {
      const result = await get(pathname, { ...options, access: mode });
      if (result) access = mode;
      return result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
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
