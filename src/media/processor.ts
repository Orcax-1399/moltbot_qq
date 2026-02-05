import { promises as fs, existsSync } from "fs";
import path from "path";
import sharp from "sharp";
import { CONSTANTS } from "../utils/constants.js";

export async function processDownloadedImage(inPath: string, basePath: string): Promise<string> {
  const ext = path.extname(inPath).toLowerCase();
  if (ext === ".gif") return inPath;

  try {
    const img = sharp(inPath).rotate();
    const meta = await img.metadata();

    if (meta.pages && meta.pages > 1) return inPath;

    const hasAlpha = Boolean(meta.hasAlpha);
    const outPath = hasAlpha ? `${basePath}.png` : `${basePath}.jpg`;
    const tmpPath = `${outPath}.tmp`;

    let pipeline = sharp(inPath)
      .rotate()
      .resize(CONSTANTS.MAX_IMAGE_DIMENSION, CONSTANTS.MAX_IMAGE_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      });

    if (hasAlpha) {
      pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
    } else {
      pipeline = pipeline.jpeg({ quality: 85, progressive: true });
    }

    await pipeline.toFile(tmpPath);
    await fs.rename(tmpPath, outPath);

    if (outPath !== inPath && existsSync(inPath)) {
      await fs.unlink(inPath).catch(() => undefined);
    }

    return outPath;
  } catch (err) {
    console.error("[QQ] Failed to process image:", inPath, err);
    return inPath;
  }
}
