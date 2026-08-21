import crypto from "crypto";
import { getJSON, setJSON, deleteKey } from "./db";

// Upstash's free tier caps a single value around 1MB; base64 adds ~33%
// overhead, so keep the raw upload well under that (recommended < 300KB).
const MAX_IMAGE_BYTES = 700 * 1024;

export function imageKey(id) {
  return `image:${id}`;
}

/**
 * Stores an uploaded image as base64 in the same KV database.
 * @param {Buffer} buffer raw image bytes
 * @param {string} contentType e.g. "image/jpeg"
 * @returns {Promise<string>} the generated image id
 */
export async function saveImage(buffer, contentType) {
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `Bild ist zu groß (${Math.round(buffer.length / 1024)} KB). Bitte auf unter ${Math.round(
        MAX_IMAGE_BYTES / 1024
      )} KB komprimieren.`
    );
  }
  const id = crypto.randomUUID();
  await setJSON(imageKey(id), {
    contentType,
    base64: buffer.toString("base64"),
    createdAt: new Date().toISOString(),
  });
  return id;
}

/**
 * Retrieves a stored image.
 * @returns {Promise<{contentType: string, base64: string} | null>}
 */
export async function getImage(id) {
  if (!id) return null;
  return getJSON(imageKey(id), null);
}

export async function deleteImage(id) {
  if (!id) return;
  await deleteKey(imageKey(id));
}
