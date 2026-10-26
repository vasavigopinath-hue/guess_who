// Shared helpers for the save/load functions. Files starting with "_" are not routes.
import { get, put, list, del } from "@vercel/blob";

// A Blob store is either public or private (newer stores default to private).
// Try the last mode that worked for a write, then the other. Only successful
// writes decide this: a read can look fine in the wrong mode.
let access = process.env.BLOB_ACCESS || null;
const modes = () => {
  const first = access || "private";
  return [first, first === "private" ? "public" : "private"];
};

export const storageConnected = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

// If SAVE_PASSWORD is set in Vercel, saving needs it. Loading never does.
export function allowedToSave(req) {
  const pw = process.env.SAVE_PASSWORD;
  return !pw || req.headers["x-save-password"] === pw;
}

// "Cannot use public access on a private store" (or the reverse) just means we
// guessed the wrong mode; any other error is the real problem worth reporting.
const wrongMode = (err) => /cannot use (public|private) access/i.test(String(err && err.message));

export async function putBlob(pathname, body, options) {
  const errors = [];
  for (const mode of modes()) {
    try {
      const result = await put(pathname, body, { ...options, access: mode });
      access = mode;
      return result;
    } catch (err) {
      errors.push(err);
    }
  }
  throw errors.find((e) => !wrongMode(e)) || errors[0];
}

// Returns the get() result, or null if the blob doesn't exist.
export async function getBlob(pathname, options = {}) {
  const errors = [];
  for (const mode of modes()) {
    try {
      const result = await get(pathname, { ...options, access: mode });
      if (!result || result.statusCode === 200) return result;
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length) throw errors.find((e) => !wrongMode(e)) || errors[0];
  return null;
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
export function describe(err) {
  return `${(err && err.name) || "Error"}: ${String((err && err.message) || err).slice(0, 200)}`;
}
