import type { OneBotMessage } from "../types.js";

/**
 * Clean CQ codes from message text.
 * - Removes [CQ:xxx,...] segments.
 * - Normalizes whitespace.
 * - Extracts CQ:image url=... and appends them at the end.
 * - Replaces <file>...</file> blocks to avoid binary/XML leakage.
 */
export function cleanCQCodes(text: string | undefined): string {
  if (!text) return "";

  let result = text;
  const imageUrls: string[] = [];

  const imageRegex = /\[CQ:image,[^\]]*url=([^,\]]+)[^\]]*\]/g;
  let match: RegExpExecArray | null;
  while ((match = imageRegex.exec(text)) !== null) {
    imageUrls.push(match[1].replace(/&amp;/g, "&"));
  }

  result = result.replace(/\[CQ:[^\]]+\]/g, (m) => {
    if (m.startsWith("[CQ:image") && m.includes("url=")) return "[图片]";
    return "";
  });

  result = result.replace(/<file\b[^>]*>[\s\S]*?<\/file>/gi, "[文件]");
  result = result.replace(/\s+/g, " ").trim();

  if (imageUrls.length > 0) {
    result = result ? `${result} [图片: ${imageUrls.join(", ")}]` : `[图片: ${imageUrls.join(", ")}]`;
  }

  return result;
}

export function getReplyMessageId(message: OneBotMessage | string | undefined, rawMessage?: string): string | null {
  if (message && typeof message !== "string") {
    for (const segment of message) {
      if (segment.type === "reply" && segment.data?.id) {
        const id = String(segment.data.id).trim();
        if (id && /^-?\d+$/.test(id)) return id;
      }
    }
  }

  if (rawMessage) {
    const match = rawMessage.match(/\[CQ:reply,id=(\d+)\]/);
    if (match) return match[1];
  }

  return null;
}

export function getForwardId(message: OneBotMessage | string | undefined, rawMessage?: string): string | null {
  if (message && typeof message !== "string") {
    for (const segment of message) {
      if (segment.type === "forward" && segment.data?.id) {
        const id = String(segment.data.id).trim();
        if (id) return id;
      }
    }
  }

  if (rawMessage) {
    const match = rawMessage.match(/\[CQ:forward,id=([^,\]]+)\]/);
    if (match) return match[1];
  }

  return null;
}

export function hasReplySegment(message: OneBotMessage | string | undefined): boolean {
  if (!message || typeof message === "string") return false;
  return message.some((seg) => seg.type === "reply");
}

/** Flatten OneBot message segments into plain text. */
export function flattenOneBotMessage(message: OneBotMessage | string | undefined): string {
  if (!message) return "";
  if (typeof message === "string") return cleanCQCodes(message);

  const parts: string[] = [];
  for (const seg of message) {
    if (seg.type === "text") {
      parts.push(seg.data?.text ?? "");
      continue;
    }

    if (seg.type === "at") {
      const qq = seg.data?.qq ? String(seg.data.qq) : "";
      parts.push(qq ? `@${qq}` : "@");
      continue;
    }

    if (seg.type === "image") {
      parts.push("[图片]");
      continue;
    }

    if (seg.type === "file") {
      const fileName = seg.data?.name;
      parts.push(fileName ? `[文件: ${fileName}]` : "[文件]");
      continue;
    }

    if (seg.type === "node") {
      parts.push(flattenOneBotMessage(seg.data?.content));
      continue;
    }
  }

  return parts.join("").replace(/\s+/g, " ").trim();
}
