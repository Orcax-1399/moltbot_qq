import { CONSTANTS } from "../utils/constants.js";
import { parseContentLength, readResponseBodyWithLimit } from "./downloader.js";

/**
 * Download image from URL and convert to base64 string.
 * Returns base64 data without the data URI prefix (just the base64 content).
 */
export async function downloadImageToBase64(rawUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONSTANTS.IMAGE_TIMEOUT_MS);

  try {
    const res = await fetch(rawUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!res.ok) {
      console.error(
        `[QQ] Failed to download image for base64 (${res.status} ${res.statusText}):`,
        rawUrl
      );
      return null;
    }

    const len = parseContentLength(res.headers);
    if (len !== null && len > CONSTANTS.MAX_IMAGE_BYTES) {
      console.error(`[QQ] Image too large for base64 (${len} bytes), skipping:`, rawUrl);
      return null;
    }

    const buffer = await readResponseBodyWithLimit(res, CONSTANTS.MAX_IMAGE_BYTES, controller);
    if (!buffer) {
      console.error(
        `[QQ] Image exceeded ${CONSTANTS.MAX_IMAGE_BYTES} bytes while downloading for base64, skipping:`,
        rawUrl
      );
      return null;
    }

    return buffer.toString("base64");
  } catch (err) {
    console.error("[QQ] Failed to download image for base64:", rawUrl, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
