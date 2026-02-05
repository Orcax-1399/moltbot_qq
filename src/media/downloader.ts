import { promises as fs } from "fs";
import path from "path";
import { CONSTANTS } from "../utils/constants.js";
import { processDownloadedImage } from "./processor.js";

function extFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/gif") return ".gif";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/bmp") return ".bmp";
  if (mime === "image/tiff") return ".tiff";
  return null;
}

function extFromUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const ext = path.extname(u.pathname).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tif", ".tiff"].includes(ext)) {
      return ext === ".jpeg" ? ".jpg" : ext === ".tif" ? ".tiff" : ext;
    }
  } catch {
    // ignore
  }
  return null;
}

export function parseContentLength(headers: Headers): number | null {
  const v = headers.get("content-length");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function readResponseBodyWithLimit(
  res: Response,
  maxBytes: number,
  controller?: AbortController
): Promise<Buffer | null> {
  const body = res.body;
  if (!body) return Buffer.alloc(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      received += value.byteLength;
      if (received > maxBytes) {
        controller?.abort();
        return null;
      }
      chunks.push(value);
    }

    return Buffer.concat(chunks.map((c) => Buffer.from(c)), received);
  } finally {
    reader.releaseLock();
  }
}

export async function downloadUrlToTempFile(
  rawUrl: string,
  messageId: number | string,
  index: number
): Promise<string | null> {
  const basePath = `${CONSTANTS.TEMP_FILE_PREFIX}${messageId}_${index}`;

  // HEAD: enforce size limit before downloading.
  {
    const headController = new AbortController();
    const headTimeout = setTimeout(() => headController.abort(), CONSTANTS.IMAGE_TIMEOUT_MS);

    try {
      const headRes = await fetch(rawUrl, { method: "HEAD", signal: headController.signal });
      if (headRes.ok) {
        const len = parseContentLength(headRes.headers);
        if (len !== null && len > CONSTANTS.MAX_IMAGE_BYTES) {
          console.error(`[QQ] Image too large (${len} bytes), skipping:`, rawUrl);
          return null;
        }
      }
    } catch {
      // Some hosts reject HEAD; fall back to limiting during GET.
    } finally {
      clearTimeout(headTimeout);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONSTANTS.IMAGE_TIMEOUT_MS);

  try {
    const res = await fetch(rawUrl, { signal: controller.signal });
    if (!res.ok) {
      console.error(`[QQ] Failed to download media (${res.status} ${res.statusText}):`, rawUrl);
      return null;
    }

    const len = parseContentLength(res.headers);
    if (len !== null && len > CONSTANTS.MAX_IMAGE_BYTES) {
      console.error(`[QQ] Image too large (${len} bytes), skipping:`, rawUrl);
      return null;
    }

    const buffer = await readResponseBodyWithLimit(res, CONSTANTS.MAX_IMAGE_BYTES, controller);
    if (!buffer) {
      console.error(
        `[QQ] Image exceeded ${CONSTANTS.MAX_IMAGE_BYTES} bytes while downloading, skipping:`,
        rawUrl
      );
      return null;
    }

    const ext = extFromContentType(res.headers.get("content-type")) || extFromUrl(rawUrl) || ".jpg";
    const downloadPath = `${basePath}${ext}`;

    await fs.writeFile(downloadPath, buffer);

    const processedPath = await processDownloadedImage(downloadPath, basePath);
    return processedPath;
  } catch (err) {
    console.error("[QQ] Failed to download media:", rawUrl, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
