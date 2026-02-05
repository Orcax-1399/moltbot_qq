import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { OneBotClient } from "../client.js";
import type { OneBotMessage } from "../types.js";
import { CONSTANTS } from "../utils/constants.js";
import { downloadImageToBase64 } from "../media/base64.js";

type SendResult = { channel: string; sent: boolean; error?: string };

export class OutboundMessageHandler {
  private getClientForAccount: (accountId: string) => OneBotClient | undefined;

  constructor(getClientForAccount: (accountId: string) => OneBotClient | undefined) {
    this.getClientForAccount = getClientForAccount;
  }

  async sendText(opts: {
    to: string;
    text: string;
    accountId?: string;
    replyTo?: string;
  }): Promise<SendResult> {
    const client = this.getClientForAccount(opts.accountId || DEFAULT_ACCOUNT_ID);
    if (!client) {
      console.warn(`[QQ] No client for account ${opts.accountId}, cannot send text`);
      return { channel: "qq", sent: false, error: "Client not connected" };
    }

    await this.preprocessAndSend(client, opts.to, opts.text, opts.replyTo);
    return { channel: "qq", sent: true };
  }

  async sendMedia(opts: {
    to: string;
    text?: string;
    mediaUrl: string;
    accountId?: string;
    replyTo?: string;
  }): Promise<SendResult> {
    const client = this.getClientForAccount(opts.accountId || DEFAULT_ACCOUNT_ID);
    if (!client) {
      console.warn(`[QQ] No client for account ${opts.accountId}, cannot send media`);
      return { channel: "qq", sent: false, error: "Client not connected" };
    }

    const message: OneBotMessage = [];

    if (opts.replyTo) {
      message.push({ type: "reply", data: { id: String(opts.replyTo) } });
    }

    if (opts.text) {
      message.push({ type: "text", data: { text: opts.text } });
    }

    let imageFile = opts.mediaUrl;
    if (imageFile && (imageFile.startsWith("http://") || imageFile.startsWith("https://"))) {
      const isQQUrl = imageFile.includes("qq.com") || imageFile.includes("multimedia.nt.qq.com.cn");
      if (!isQQUrl) {
        try {
          console.log(`[QQ] Converting external image to base64: ${imageFile.substring(0, 50)}...`);
          const base64Data = await downloadImageToBase64(imageFile);
          if (base64Data) {
            imageFile = `base64://${base64Data}`;
            console.log("[QQ] Successfully converted to base64");
          } else {
            console.warn("[QQ] Failed to convert image to base64, using original URL");
          }
        } catch (err) {
          console.error("[QQ] Error converting image to base64:", err);
        }
      }
    }

    message.push({ type: "image", data: { file: imageFile } });

    this.sendToTarget(client, opts.to, message);
    return { channel: "qq", sent: true };
  }

  private async preprocessAndSend(
    client: OneBotClient,
    to: string,
    text: string,
    replyTo?: string
  ): Promise<void> {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

    // Build a flat stream of text/action segments (line breaks preserved via textBuf joins).
    const segments: Array<{ kind: "text" | "action"; value: string }> = [];

    for (const line of lines) {
      // If the whole line is an action marker, keep it as a standalone action segment.
      if (this.isActionLine(line)) {
        segments.push({ kind: "action", value: line.trim() });
        continue;
      }

      // Otherwise, split inline *...* action markers conservatively.
      const parts = this.splitLineByInlineActions(line);
      const lineTextParts: string[] = [];

      for (const part of parts) {
        if (part.kind === "action") {
          if (lineTextParts.length > 0) {
            segments.push({ kind: "text", value: lineTextParts.join(" ").trim() });
            lineTextParts.length = 0;
          }
          segments.push({ kind: "action", value: part.value.trim() });
          continue;
        }

        const v = part.value.trim();
        if (v) lineTextParts.push(v);
      }

      if (lineTextParts.length > 0) {
        segments.push({ kind: "text", value: lineTextParts.join(" ").trim() });
      }
    }

    // Convert segments into chunks:
    // - accumulate adjacent text
    // - pair each action with the immediately following text (if any)
    const chunks: string[] = [];
    const textBuf: string[] = [];

    const flushText = () => {
      const t = textBuf.join("\n").trim();
      if (t) chunks.push(t);
      textBuf.length = 0;
    };

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      if (seg.kind === "text") {
        textBuf.push(seg.value);
        continue;
      }

      flushText();

      const next = segments[i + 1];
      if (next && next.kind === "text") {
        chunks.push(`${seg.value}\n${next.value}`);
        i++; // consume next text
      } else {
        chunks.push(seg.value);
      }
    }

    flushText();

    for (let j = 0; j < chunks.length; j++) {
      const chunk = chunks[j];

      let message: OneBotMessage | string;
      if (replyTo && j === 0) {
        message = [
          { type: "reply", data: { id: String(replyTo) } },
          { type: "text", data: { text: chunk } },
        ];
      } else {
        message = chunk;
      }

      this.sendToTarget(client, to, message);

      if (j < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, CONSTANTS.MESSAGE_CHUNK_DELAY_MS));
      }
    }
  }

  private isActionLine(line: string): boolean {
    const t = line.trim();
    return t.startsWith("*") && t.endsWith("*");
  }

  private isQuoteLine(line: string): boolean {
    return line.trim().startsWith('"');
  }

  private splitLineByInlineActions(
    line: string
  ): Array<{ kind: "text" | "action"; value: string }> {
    const parts: Array<{ kind: "text" | "action"; value: string }> = [];

    const re = /\*[^*\n]{1,200}\*/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = re.exec(line)) !== null) {
      const token = m[0];
      const start = m.index;
      const end = start + token.length;

      if (!this.isLikelyActionToken(line, token, start, end)) {
        continue;
      }

      if (start > lastIndex) {
        parts.push({ kind: "text", value: line.slice(lastIndex, start) });
      }

      parts.push({ kind: "action", value: token });
      lastIndex = end;
    }

    if (lastIndex === 0) {
      return [{ kind: "text", value: line }];
    }

    if (lastIndex < line.length) {
      parts.push({ kind: "text", value: line.slice(lastIndex) });
    }

    return parts;
  }

  private isLikelyActionToken(line: string, token: string, start: number, end: number): boolean {
    const t = token.trim();
    if (!(t.startsWith("*") && t.endsWith("*"))) return false;

    const inner = t.slice(1, -1).trim();
    if (!inner) return false;

    // Require token boundaries so we don't split "foo*bar*baz"-style cases.
    const before = start > 0 ? line[start - 1] : "";
    const after = end < line.length ? line[end] : "";
    const isBoundary = (ch: string) => !ch || /\s|[\(\)\[\]\{\}<>"'“”‘’，。！？、；：,.!?;:]/.test(ch);
    if (!isBoundary(before) || !isBoundary(after)) return false;

    // Avoid breaking common markdown emphasis like "I *really* like it".
    // If it's a single short ASCII word, treat it as emphasis, not an action.
    if (/^[A-Za-z0-9_]+$/.test(inner) && inner.length <= 20) return false;

    return true;
  }

  private sendToTarget(client: OneBotClient, to: string, message: OneBotMessage | string): void {
    if (to.startsWith("group:")) {
      const groupId = parseInt(to.replace("group:", ""), 10);
      client.sendGroupMsg(groupId, message);
    } else {
      const userId = parseInt(to, 10);
      client.sendPrivateMsg(userId, message);
    }
  }
}
