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

    const chunks: string[] = [];
    const remainingLines: string[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (this.isActionLine(line) && i + 1 < lines.length && this.isQuoteLine(lines[i + 1])) {
        chunks.push(`${line}\n${lines[i + 1]}`);
        i += 2;
        continue;
      }

      remainingLines.push(line);
      i++;
    }

    if (remainingLines.length > 0) chunks.push(remainingLines.join("\n"));

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
