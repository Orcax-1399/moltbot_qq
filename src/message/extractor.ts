import type { OneBotMessage } from "../types.js";

/**
 * Extract image URLs from message segments.
 * Limited to maxImages, de-duplicated, and only returns valid HTTP(S) URLs.
 */
export function extractImageUrls(message: OneBotMessage | string | undefined, maxImages = 3): string[] {
  if (!message) return [];

  const urls: string[] = [];
  const seen = new Set<string>();

  const pushUrl = (url: string | undefined) => {
    if (!url) return;
    if (!(url.startsWith("http://") || url.startsWith("https://"))) return;
    if (seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  if (typeof message === "string") {
    const urlRegex = /\[CQ:image,[^\]]*url=([^,\]]+)[^\]]*\]/g;
    const fileRegex = /\[CQ:image,[^\]]*file=([^,\]]+)[^\]]*\]/g;

    let match: RegExpExecArray | null;
    while ((match = urlRegex.exec(message)) !== null) {
      pushUrl(match[1].replace(/&amp;/g, "&"));
      if (urls.length >= maxImages) break;
    }

    while (urls.length < maxImages && (match = fileRegex.exec(message)) !== null) {
      pushUrl(match[1].replace(/&amp;/g, "&"));
      if (urls.length >= maxImages) break;
    }

    return urls;
  }

  for (const segment of message) {
    if (segment.type === "image") {
      const url = segment.data?.url || segment.data?.file;
      pushUrl(url);
      if (urls.length >= maxImages) break;
    }
  }

  return urls;
}

export function hasFileSegment(message: OneBotMessage | string | undefined): boolean {
  if (!message || typeof message === "string") return false;
  return message.some((seg) => seg.type === "file");
}

export function hasFileTag(rawMessage: string | undefined): boolean {
  return Boolean(rawMessage && rawMessage.includes("<file"));
}
