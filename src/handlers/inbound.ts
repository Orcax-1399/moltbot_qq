import type { PluginRuntime } from "openclaw/plugin-sdk";
import type { OneBotClient, OneBotForwardMsg } from "../client.js";
import type { QQConfig } from "../config.js";
import type { OneBotEvent, OneBotMessage } from "../types.js";
import { CONSTANTS } from "../utils/constants.js";
import { MessageLogger } from "../utils/logger.js";
import { extractImageUrls, hasFileSegment, hasFileTag } from "../message/extractor.js";
import { cleanCQCodes, flattenOneBotMessage, getForwardId, getReplyMessageId } from "../message/parser.js";
import { downloadUrlToTempFile } from "../media/downloader.js";

export type InboundHandleResult = {
  isGroup: boolean;
  userId: number;
  groupId: number | undefined;
  ctxPayload: any;
};

export class InboundMessageHandler {
  private client: OneBotClient;
  private config: QQConfig;
  private accountId: string;
  private runtime: PluginRuntime;
  private logger: MessageLogger;

  constructor(opts: {
    client: OneBotClient;
    config: QQConfig;
    accountId: string;
    runtime: PluginRuntime;
    logger?: MessageLogger;
  }) {
    this.client = opts.client;
    this.config = opts.config;
    this.accountId = opts.accountId;
    this.runtime = opts.runtime;
    this.logger = opts.logger ?? new MessageLogger();
  }

  async handle(event: OneBotEvent): Promise<InboundHandleResult | null> {
    // Record bot self id on lifecycle connect.
    if (
      event.post_type === "meta_event" &&
      event.meta_event_type === "lifecycle" &&
      event.sub_type === "connect"
    ) {
      if (event.self_id) this.client.setSelfId(event.self_id);
      return null;
    }

    if (event.post_type !== "message") return null;

    const isGroup = event.message_type === "group";
    const messageId = event.message_id;
    const userId = event.user_id;
    if (!messageId || !userId) return null;

    const groupId = event.group_id;
    const rawText = event.raw_message || "";

    const fileSegment = hasFileSegment(event.message);
    const fileTag = hasFileTag(rawText);

    // Always log raw inbound for debugging postmortems.
    await this.logger.logMessageToFile({
      messageId,
      userId,
      groupId,
      rawMessage: rawText,
      parsedMessage: event.message,
      hasFileTag: fileTag,
      hasFileSegment: fileSegment,
    });

    // Admin whitelist.
    if (this.config.admins && this.config.admins.length > 0) {
      if (!this.config.admins.includes(userId)) return null;
    }

    const replyMsgId = getReplyMessageId(event.message, rawText);
    const forwardId = getForwardId(event.message, rawText);

    let repliedMsg: any = null;
    if (replyMsgId) {
      try {
        repliedMsg = await this.client.getMsg(replyMsgId);
      } catch (err) {
        console.log("[QQ] Failed to get replied message:", err);
      }
    }

    if (isGroup && this.config.requireMention) {
      const effectiveSelfId = this.client.getSelfId() ?? event.self_id;
      if (!effectiveSelfId) {
        console.log("[QQ] Cannot check mention: selfId not available yet");
        return null;
      }

      const mentioned = this.isMentioned(event.message, rawText, effectiveSelfId);
      const repliedToBot = Boolean(repliedMsg && repliedMsg?.sender?.user_id === effectiveSelfId);

      if (!mentioned && !repliedToBot) return null;
    }

    // Extract images (up to MAX) from current msg, replied msg, and forwarded nodes.
    const mediaUrls: string[] = [];
    const seenUrls = new Set<string>();
    const pushUrl = (url: string | undefined) => {
      if (!url) return;
      if (seenUrls.has(url)) return;
      seenUrls.add(url);
      mediaUrls.push(url);
    };

    for (const url of extractImageUrls(event.message, CONSTANTS.MAX_IMAGES_PER_MESSAGE)) {
      pushUrl(url);
      if (mediaUrls.length >= CONSTANTS.MAX_IMAGES_PER_MESSAGE) break;
    }

    if (mediaUrls.length < CONSTANTS.MAX_IMAGES_PER_MESSAGE && repliedMsg?.message) {
      const remaining = CONSTANTS.MAX_IMAGES_PER_MESSAGE - mediaUrls.length;
      for (const url of extractImageUrls(repliedMsg.message, remaining)) {
        pushUrl(url);
        if (mediaUrls.length >= CONSTANTS.MAX_IMAGES_PER_MESSAGE) break;
      }
    }

    const { forwardBlock, forwardNodes } = await this.expandForward(forwardId);
    if (forwardNodes.length > 0 && mediaUrls.length < CONSTANTS.MAX_IMAGES_PER_MESSAGE) {
      for (const node of forwardNodes) {
        if (mediaUrls.length >= CONSTANTS.MAX_IMAGES_PER_MESSAGE) break;
        const remaining = CONSTANTS.MAX_IMAGES_PER_MESSAGE - mediaUrls.length;
        for (const url of extractImageUrls(node.content, remaining)) {
          pushUrl(url);
          if (mediaUrls.length >= CONSTANTS.MAX_IMAGES_PER_MESSAGE) break;
        }
      }
    }

    const mediaPaths = (await Promise.all(mediaUrls.map((url, i) => downloadUrlToTempFile(url, messageId, i)))).filter(
      (p): p is string => Boolean(p)
    );

    // Build reply context.
    let replyToBody: string | null = null;
    let replyToSender: string | null = null;
    if (replyMsgId && repliedMsg) {
      if (typeof repliedMsg.message !== "string" && Array.isArray(repliedMsg.message)) {
        replyToBody = flattenOneBotMessage(repliedMsg.message);
      } else if (typeof repliedMsg.message === "string") {
        replyToBody = cleanCQCodes(repliedMsg.message);
      } else if (repliedMsg.raw_message) {
        replyToBody = cleanCQCodes(repliedMsg.raw_message);
      } else {
        replyToBody = "[无法获取消息内容]";
      }

      replyToSender =
        repliedMsg.sender?.nickname ||
        repliedMsg.sender?.card ||
        String(repliedMsg.sender?.user_id || "");
    }

    const replySuffix = replyToBody
      ? `\n\n[Replying to ${replyToSender || "unknown"}]\n${replyToBody}\n[/Replying]`
      : "";

    let bodyText: string;
    if (typeof event.message !== "string" && Array.isArray(event.message)) {
      bodyText = flattenOneBotMessage(event.message);
    } else {
      bodyText = cleanCQCodes(rawText);
    }

    const chatPrefix = isGroup ? `[group:${groupId ?? "unknown"}]` : "[private]";
    const bodyWithReply = chatPrefix + bodyText + replySuffix + forwardBlock;

    await this.logger.logMessageToFile({
      messageId,
      userId,
      groupId,
      rawMessage: rawText,
      parsedMessage: event.message,
      processedBody: bodyWithReply,
      hasFileTag: fileTag,
      hasFileSegment: fileSegment,
    });

    const fromId = isGroup ? `group:${groupId}` : String(userId);
    const conversationLabel = isGroup ? `QQ Group ${groupId}` : `QQ User ${userId}`;
    const senderName = event.sender?.nickname || "Unknown";

    const ctxPayload = this.runtime.channel.reply.finalizeInboundContext({
      Provider: "qq",
      Channel: "qq",
      From: fromId,
      To: fromId,
      Body: bodyWithReply,
      RawBody: bodyText,
      SenderId: String(userId),
      MessageSid: String(messageId),
      SenderName: senderName,
      ConversationLabel: conversationLabel,
      SessionKey: `qq:${fromId}`,
      AccountId: this.accountId,
      ChatType: isGroup ? "group" : "direct",
      Timestamp: event.time * 1000,
      OriginatingChannel: "qq",
      OriginatingTo: fromId,
      CommandAuthorized: true,
      ...(mediaPaths.length > 0 && { MediaPaths: mediaPaths }),
      ...(mediaUrls.length > 0 && { MediaUrls: mediaUrls }),
      ...(replyMsgId && { ReplyToId: replyMsgId }),
      ...(replyToBody && { ReplyToBody: replyToBody }),
      ...(replyToSender && { ReplyToSender: replyToSender }),
    });

    return {
      isGroup,
      userId,
      groupId,
      ctxPayload,
    };
  }

  private isMentioned(
    message: OneBotMessage | string | undefined,
    rawMessage: string,
    selfId: number
  ): boolean {
    if (Array.isArray(message)) {
      for (const segment of message) {
        if (segment.type === "at") {
          const targetId = String(segment.data?.qq);
          if (targetId === String(selfId) || targetId === "all") return true;
        }
      }
      return false;
    }

    return rawMessage.includes(`[CQ:at,qq=${selfId}]`);
  }

  private async expandForward(
    forwardId: string | null
  ): Promise<{
    forwardBlock: string;
    forwardNodes: Array<{ sender: string; content: OneBotMessage | string }>;
  }> {
    if (!forwardId) return { forwardBlock: "", forwardNodes: [] };

    try {
      const forwardData = (await this.client.getForwardMsg(forwardId)) as OneBotForwardMsg;

      const nodes: Array<{ sender: string; content: OneBotMessage | string }> = [];

      if (Array.isArray((forwardData as any)?.messages)) {
        for (const msg of (forwardData as any).messages) {
          const sender =
            msg?.sender?.nickname || msg?.sender?.card || String(msg?.sender?.user_id || "unknown");
          const content = (msg?.content ?? msg?.message ?? "") as OneBotMessage | string;
          nodes.push({ sender, content });
        }
      }

      if (nodes.length === 0 && Array.isArray((forwardData as any)?.message)) {
        for (const seg of (forwardData as any).message) {
          if (seg?.type !== "node") continue;
          const sender = seg?.data?.name || seg?.data?.uin || "unknown";
          const content = (seg?.data?.content ?? "") as OneBotMessage | string;
          nodes.push({ sender, content });
        }
      }

      const limitedNodes = nodes.slice(0, CONSTANTS.MAX_FORWARD_NODES);
      const lines: string[] = [];

      for (let i = 0; i < limitedNodes.length; i++) {
        const n = limitedNodes[i];
        const msgText = flattenOneBotMessage(n.content);
        lines.push(`[${i + 1}] ${n.sender}: ${msgText}`);
      }

      const forwardBlock = `\n\n[Forwarded]\n${lines.join("\n") || "[Empty forward]"}\n[/Forwarded]`;
      return { forwardBlock, forwardNodes: limitedNodes };
    } catch (err) {
      console.log("[QQ] Failed to get forward msg:", err);
      const forwardBlock = `\n\n[Forwarded]\n[ForwardId: ${forwardId}]\n[Failed to fetch forwarded messages]\n[/Forwarded]`;
      return { forwardBlock, forwardNodes: [] };
    }
  }
}
