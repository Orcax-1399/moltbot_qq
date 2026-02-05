import {
  type ChannelPlugin,
  type ChannelAccountSnapshot,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  type ReplyPayload,
} from "openclaw/plugin-sdk";
import { OneBotClient } from "./client.js";
import { QQConfigSchema, type QQConfig } from "./config.js";
import { getQQRuntime } from "./runtime.js";
import type { OneBotMessage, OneBotMessageSegment } from "./types.js";

export type ResolvedQQAccount = ChannelAccountSnapshot & {
  config: QQConfig;
  client?: OneBotClient;
};

/**
 * Extract image URLs from message segments
 * Returns images from newest to oldest (as they appear in the array)
 * Limited to max 3 images
 * Only returns valid HTTP(S) URLs (filters out local file:// paths)
 */
function extractImageUrls(message: OneBotMessage | string | undefined, maxImages = 3): string[] {
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

  // If message is a raw string, try to parse CQ:image codes.
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
      // Prefer url, fallback to file if it's a valid URL
      const url = segment.data?.url || segment.data?.file;
      pushUrl(url);
      if (urls.length >= maxImages) break;
    }
  }

  return urls;
}

/**
 * Check if message contains a reply segment
 */
function hasReplySegment(message: OneBotMessage | string | undefined): boolean {
  if (!message || typeof message === "string") return false;
  return message.some(seg => seg.type === "reply");
}

/**
 * Clean CQ codes from message text
 * Removes [CQ:xxx,...] format and normalizes whitespace
 * Preserves image URLs by extracting them from [CQ:image,url=...] format
 */
function cleanCQCodes(text: string | undefined): string {
  if (!text) return "";
  
  // Extract image URLs from CQ:image codes and replace with a placeholder
  let result = text;
  const imageUrls: string[] = [];
  
  // Match [CQ:image,...url=xxx...] and extract URL
  const imageRegex = /\[CQ:image,[^\]]*url=([^,\]]+)[^\]]*\]/g;
  let match;
  while ((match = imageRegex.exec(text)) !== null) {
    const url = match[1].replace(/&amp;/g, "&");  // Decode HTML entities
    imageUrls.push(url);
  }
  
  // Replace all CQ codes
  result = result.replace(/\[CQ:[^\]]+\]/g, (match) => {
    // If it's an image with URL, return placeholder
    if (match.startsWith("[CQ:image") && match.includes("url=")) {
      return "[图片]";
    }
    // Otherwise remove it
    return "";
  });
  
  result = result.replace(/\s+/g, " ").trim();
  
  // Append image URLs at the end if any were found
  if (imageUrls.length > 0) {
    result = result ? `${result} [图片: ${imageUrls.join(", ")}]` : `[图片: ${imageUrls.join(", ")}]`;
  }
  
  return result;
}

/**
 * Get reply message ID from message segments or raw message string
 * Returns string to avoid type conversion issues
 */
function getReplyMessageId(message: OneBotMessage | string | undefined, rawMessage?: string): string | null {
  // First try to get from parsed message array
  if (message && typeof message !== "string") {
    for (const segment of message) {
      if (segment.type === "reply" && segment.data?.id) {
        const id = String(segment.data.id).trim();
        if (id && /^-?\d+$/.test(id)) {
          return id;
        }
      }
    }
  }
  
  // Fallback: parse from raw_message CQ code
  if (rawMessage) {
    const match = rawMessage.match(/\[CQ:reply,id=(\d+)\]/);
    if (match) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Get forward message ID from message segments or raw message string
 */
function getForwardId(message: OneBotMessage | string | undefined, rawMessage?: string): string | null {
  // First try to get from parsed message array
  if (message && typeof message !== "string") {
    for (const segment of message) {
      if (segment.type === "forward" && segment.data?.id) {
        const id = String(segment.data.id).trim();
        if (id) return id;
      }
    }
  }

  // Fallback: parse from raw_message CQ code
  if (rawMessage) {
    const match = rawMessage.match(/\[CQ:forward,id=([^,\]]+)\]/);
    if (match) return match[1];
  }

  return null;
}

/**
 * Flatten OneBot message segments into plain text.
 * Similar to cleanCQCodes for raw strings, but preserves segment content.
 */
function flattenOneBotMessage(message: OneBotMessage | string | undefined): string {
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

    if (seg.type === "node") {
      parts.push(flattenOneBotMessage(seg.data?.content));
      continue;
    }

    // Skip reply / forward markers in plain-text flatten.
  }

  return parts.join("").replace(/\s+/g, " ").trim();
}

function normalizeTarget(raw: string): string {
  return raw.replace(/^(qq:)/i, "");
}

const clients = new Map<string, OneBotClient>();

function getClientForAccount(accountId: string) {
    return clients.get(accountId);
}

export const qqChannel: ChannelPlugin<ResolvedQQAccount> = {
  id: "qq",
  meta: {
    id: "qq",
    label: "QQ (OneBot)",
    selectionLabel: "QQ",
    docsPath: "extensions/qq",
    blurb: "Connect to QQ via OneBot v11",
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
  },
  configSchema: buildChannelConfigSchema(QQConfigSchema),
  config: {
    listAccountIds: (cfg) => {
        // @ts-ignore
        const qq = cfg.channels?.qq;
        if (!qq) return [];
        if (qq.accounts) return Object.keys(qq.accounts);
        return [DEFAULT_ACCOUNT_ID];
    },
    resolveAccount: (cfg, accountId) => {
        const id = accountId ?? DEFAULT_ACCOUNT_ID;
        // @ts-ignore
        const qq = cfg.channels?.qq;
        const accountConfig = id === DEFAULT_ACCOUNT_ID ? qq : qq?.accounts?.[id];
        
        return {
            accountId: id,
            name: accountConfig?.name ?? "QQ Default",
            enabled: true,
            configured: Boolean(accountConfig?.wsUrl),
            tokenSource: accountConfig?.accessToken ? "config" : "none",
            config: accountConfig || {},
        };
    },
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    describeAccount: (acc) => ({
        accountId: acc.accountId,
        configured: acc.configured,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
        const { account, cfg } = ctx;
        const config = account.config;

        if (!config.wsUrl) {
            throw new Error("QQ: wsUrl is required");
        }

        const client = new OneBotClient({
            wsUrl: config.wsUrl,
            accessToken: config.accessToken,
        });
        
        clients.set(account.accountId, client);

        client.on("connect", () => {
             console.log(`[QQ] Connected account ${account.accountId}`);
             try {
                getQQRuntime().channel.activity.record({
                    channel: "qq",
                    accountId: account.accountId,
                    direction: "inbound", 
                 });
             } catch (err) {
                 // ignore
             }
        });

        client.on("message", async (event) => {
            if (event.post_type === "meta_event" && event.meta_event_type === "lifecycle" && event.sub_type === "connect") {
                // Record bot's self ID when connected
                if (event.self_id) {
                    client.setSelfId(event.self_id);
                }
                return;
            }
            
            if (event.post_type !== "message") return;

            const isGroup = event.message_type === "group";
            const userId = event.user_id;
            const groupId = event.group_id;
            const text = event.raw_message || "";
            
            // Debug: log message structure for images
            if (Array.isArray(event.message)) {
                const imageSegments = event.message.filter(seg => seg.type === "image");
                if (imageSegments.length > 0) {
                    console.log("[QQ Debug] Image segments:", JSON.stringify(imageSegments, null, 2));
                }
            }
            
            // Check admin whitelist if configured
            if (config.admins && config.admins.length > 0 && userId) {
                if (!config.admins.includes(userId)) {
                    return; // Ignore non-admin messages
                }
            }
            
            // Check requireMention for group chats
            let repliedMsg: any = null;
            const replyMsgId = getReplyMessageId(event.message, text);
            const forwardId = getForwardId(event.message, text);
            
            // Pre-fetch replied message if exists (for mention check, images, and reply context)
            if (replyMsgId) {
                try {
                    console.log("[QQ Debug] Fetching replied message, ID:", replyMsgId);
                    repliedMsg = await client.getMsg(replyMsgId);
                    console.log("[QQ Debug] Got replied message:", JSON.stringify(repliedMsg, null, 2));
                } catch (err) {
                    console.log("[QQ] Failed to get replied message:", err);
                }
            }
            
            if (isGroup && config.requireMention) {
                const selfId = client.getSelfId();
                let isMentioned = false;
                
                // If we don't know selfId yet, we can't reliably check mentions
                // Try to get it from the event as fallback
                const effectiveSelfId = selfId ?? event.self_id;
                if (!effectiveSelfId) {
                    console.log("[QQ] Cannot check mention: selfId not available yet");
                    return;
                }
                
                // Check for @mention in message array
                if (Array.isArray(event.message)) {
                    for (const segment of event.message) {
                        if (segment.type === "at" && segment.data?.qq) {
                            const targetId = String(segment.data.qq);
                            if (targetId === String(effectiveSelfId) || targetId === "all") {
                                isMentioned = true;
                                break;
                            }
                        }
                    }
                } else {
                    // Fallback to raw message check for @bot or @all
                    if (text.includes(`[CQ:at,qq=${effectiveSelfId}]`)) {
                        isMentioned = true;
                    }
                }
                
                // If not mentioned by @, check if reply is to bot's message
                if (!isMentioned && repliedMsg) {
                    if (repliedMsg?.sender?.user_id === effectiveSelfId) {
                        isMentioned = true;
                    }
                }
                
                if (!isMentioned) {
                    return; // Skip this message
                }
            }

            const fromId = isGroup ? `group:${groupId}` : String(userId);
            const conversationLabel = isGroup ? `QQ Group ${groupId}` : `QQ User ${userId}`;
            const senderName = event.sender?.nickname || "Unknown";

            // Extract images from current message (max 3, newest first)
            let mediaUrls: string[] = extractImageUrls(event.message, 3);
            
            // If there's space, also extract images from replied message
            if (mediaUrls.length < 3 && replyMsgId && repliedMsg?.message) {
                const repliedImages = extractImageUrls(repliedMsg.message, 3 - mediaUrls.length);
                mediaUrls = [...mediaUrls, ...repliedImages];
            }

            const runtime = getQQRuntime();

            // Create Dispatcher
            const deliver = async (payload: ReplyPayload) => {
                 const send = (msg: string) => {
                     if (isGroup) client.sendGroupMsg(groupId, msg);
                     else client.sendPrivateMsg(userId, msg);
                 };

                 if (payload.text) {
                     send(payload.text);
                 }
                 
                 if (payload.files) {
                     for (const file of payload.files) {
                         if (file.url) {
                            send(`[CQ:image,file=${file.url}]`);
                         }
                     }
                 }
            };

            const { dispatcher, replyOptions } = runtime.channel.reply.createReplyDispatcherWithTyping({
                deliver,
            });

            // Build reply context if message is a reply
            let replyToBody: string | null = null;
            let replyToSender: string | null = null;
            if (replyMsgId && repliedMsg) {
                const rawBody = typeof repliedMsg.message === 'string'
                    ? repliedMsg.message
                    : repliedMsg.raw_message || '';
                replyToBody = cleanCQCodes(rawBody);
                replyToSender = repliedMsg.sender?.nickname || repliedMsg.sender?.card || String(repliedMsg.sender?.user_id || '');
                console.log("[QQ Debug] Reply fetched:", { replyToSender, replyToBody: replyToBody.slice(0, 100) });
            }

            // Build body with reply context inline (like Telegram)
            const replySuffix = replyToBody
                ? `\n\n[Replying to ${replyToSender || "unknown"}]\n${replyToBody}\n[/Replying]`
                : "";

            // Expand merged-forward (CQ:forward) message blocks if present.
            let forwardBlock = "";
            if (forwardId) {
                console.log("[QQ Debug] Forward detected:", forwardId);

                try {
                    const forwardData = await client.getForwardMsg(forwardId);

                    const nodes: Array<{ sender: string; content: OneBotMessage | string }> = [];

                    // Format A: data.messages
                    if (Array.isArray((forwardData as any)?.messages)) {
                        for (const msg of (forwardData as any).messages) {
                            const sender = msg?.sender?.nickname || msg?.sender?.card || String(msg?.sender?.user_id || "unknown");
                            const content = (msg?.content ?? msg?.message ?? "") as OneBotMessage | string;
                            nodes.push({ sender, content });
                        }
                    }

                    // Format B: data.message with node segments
                    if (nodes.length === 0 && Array.isArray((forwardData as any)?.message)) {
                        for (const seg of (forwardData as any).message) {
                            if (seg?.type !== "node") continue;
                            const sender = seg?.data?.name || seg?.data?.uin || "unknown";
                            const content = (seg?.data?.content ?? "") as OneBotMessage | string;
                            nodes.push({ sender, content });
                        }
                    }

                    const limitedNodes = nodes.slice(0, 20);
                    console.log("[QQ Debug] Forward nodes:", limitedNodes.length);

                    const forwardImageSeen = new Set<string>(mediaUrls);
                    const lines: string[] = [];

                    for (let i = 0; i < limitedNodes.length; i++) {
                        const n = limitedNodes[i];
                        const msgText = flattenOneBotMessage(n.content);
                        lines.push(`[${i + 1}] ${n.sender}: ${msgText}`);

                        if (mediaUrls.length < 3) {
                            const urls = extractImageUrls(n.content, 3);
                            for (const url of urls) {
                                if (mediaUrls.length >= 3) break;
                                if (forwardImageSeen.has(url)) continue;
                                forwardImageSeen.add(url);
                                mediaUrls.push(url);
                            }
                        }
                    }

                    forwardBlock = `\n\n[Forwarded]\n${lines.join("\n") || "[Empty forward]"}\n[/Forwarded]`;
                } catch (err) {
                    console.log("[QQ] Failed to get forward msg:", err);
                    forwardBlock = `\n\n[Forwarded]\n[ForwardId: ${forwardId}]\n[Failed to fetch forwarded messages]\n[/Forwarded]`;
                }
            }

            const bodyWithReply = cleanCQCodes(text) + replySuffix + forwardBlock;

            const ctxPayload = runtime.channel.reply.finalizeInboundContext({
                Provider: "qq",
                Channel: "qq",
                From: fromId,
                To: "qq:bot", 
                Body: bodyWithReply,
                RawBody: text,
                SenderId: String(userId),
                MessageSid: String(event.message_id),
                SenderName: senderName,
                ConversationLabel: conversationLabel,
                SessionKey: `qq:${fromId}`,
                AccountId: account.accountId,
                ChatType: isGroup ? "group" : "direct",
                Timestamp: event.time * 1000,
                OriginatingChannel: "qq",
                OriginatingTo: fromId,
                CommandAuthorized: true,
                ...(mediaUrls.length > 0 && { MediaUrls: mediaUrls }),
                ...(replyMsgId && { ReplyToId: replyMsgId }),
                ...(replyToBody && { ReplyToBody: replyToBody }),
                ...(replyToSender && { ReplyToSender: replyToSender }),
            });
            
            await runtime.channel.session.recordInboundSession({
                storePath: runtime.channel.session.resolveStorePath(cfg.session?.store, { agentId: "default" }),
                sessionKey: ctxPayload.SessionKey!,
                ctx: ctxPayload,
                updateLastRoute: {
                    sessionKey: ctxPayload.SessionKey!,
                    channel: "qq",
                    to: fromId,
                    accountId: account.accountId,
                },
                onRecordError: (err) => console.error("QQ Session Error:", err)
            });

            await runtime.channel.reply.dispatchReplyFromConfig({
                ctx: ctxPayload,
                cfg,
                dispatcher, // Passed dispatcher
                replyOptions, // Passed options
            });
        });

        client.connect();
        
        return () => {
            client.disconnect();
            clients.delete(account.accountId);
        };
    },
  },
  outbound: {
    sendText: async ({ to, text, accountId, replyTo }) => {
        const client = getClientForAccount(accountId || DEFAULT_ACCOUNT_ID);
        if (!client) {
            console.warn(`[QQ] No client for account ${accountId}, cannot send text`);
            return { channel: "qq", sent: false, error: "Client not connected" };
        }

        // Construct message: add reply segment if replyTo is provided
        let message: OneBotMessage | string = text;
        if (replyTo) {
            message = [
                { type: "reply", data: { id: String(replyTo) } },
                { type: "text", data: { text } }
            ];
        }

        if (to.startsWith("group:")) {
            const groupId = parseInt(to.replace("group:", ""), 10);
            client.sendGroupMsg(groupId, message);
        } else {
            const userId = parseInt(to, 10);
            client.sendPrivateMsg(userId, message);
        }
        
        return { channel: "qq", sent: true };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, replyTo }) => {
         const client = getClientForAccount(accountId || DEFAULT_ACCOUNT_ID);
         if (!client) {
            console.warn(`[QQ] No client for account ${accountId}, cannot send media`);
            return { channel: "qq", sent: false, error: "Client not connected" };
         }

         // Construct message array for proper reply support
         const message: OneBotMessage = [];
         
         // Add reply segment if replyTo is provided
         if (replyTo) {
             message.push({ type: "reply", data: { id: String(replyTo) } });
         }
         
         // Add text if provided
         if (text) {
             message.push({ type: "text", data: { text } });
         }
         
         // Add image
         message.push({ type: "image", data: { file: mediaUrl } });

         if (to.startsWith("group:")) {
             const groupId = parseInt(to.replace("group:", ""), 10);
             client.sendGroupMsg(groupId, message);
         } else {
             const userId = parseInt(to, 10);
             client.sendPrivateMsg(userId, message);
         }
         return { channel: "qq", sent: true };
    }
  },
  messaging: {
      normalizeTarget: normalizeTarget,
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
  }
};
