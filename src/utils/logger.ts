import { promises as fs, existsSync } from "fs";
import path from "path";
import type { OneBotMessage } from "../types.js";
import { CONSTANTS } from "./constants.js";

export type MessageLogData = {
  messageId: number;
  userId: number | undefined;
  groupId?: number | null;
  rawMessage: string;
  parsedMessage: OneBotMessage | string | undefined;
  processedBody?: string;
  hasFileTag?: boolean;
  hasFileSegment?: boolean;
};

export class MessageLogger {
  private logsDir: string;

  constructor(logsDir: string = CONSTANTS.LOGS_DIR) {
    this.logsDir = logsDir;
  }

  private getLogDateString(): string {
    return new Date().toISOString().split("T")[0];
  }

  private async ensureLogsDir(): Promise<void> {
    if (existsSync(this.logsDir)) return;
    try {
      await fs.mkdir(this.logsDir, { recursive: true });
    } catch (err) {
      console.error("[QQ] Failed to create logs directory:", err);
    }
  }

  async logMessageToFile(logData: MessageLogData): Promise<void> {
    try {
      await this.ensureLogsDir();

      const logFile = path.join(this.logsDir, `qq-messages-${this.getLogDateString()}.jsonl`);

      let rawMessage = logData.rawMessage || "";
      if (rawMessage.length > CONSTANTS.MAX_LOG_MESSAGE_LENGTH) {
        rawMessage = rawMessage.substring(0, CONSTANTS.MAX_LOG_MESSAGE_LENGTH) + "[truncated]";
      }

      const logEntry = {
        timestamp: new Date().toISOString(),
        messageId: logData.messageId,
        userId: logData.userId,
        groupId: logData.groupId ?? null,
        rawMessage,
        parsedMessage: logData.parsedMessage,
        processedBody: logData.processedBody,
        hasFileTag: logData.hasFileTag ?? false,
        hasFileSegment: logData.hasFileSegment ?? false,
      };

      await fs.appendFile(logFile, JSON.stringify(logEntry) + "\n", "utf-8");
    } catch (err) {
      console.error("[QQ] Failed to write message log:", err);
    }
  }
}
