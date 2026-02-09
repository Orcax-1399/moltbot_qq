import {
  type ChannelAccountSnapshot,
  type ChannelPlugin,
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  normalizeAccountId,
  type ReplyPayload,
} from "openclaw/plugin-sdk";
import { OneBotClient } from "./client.js";
import { QQConfigSchema, type QQConfig } from "./config.js";
import { getQQRuntime } from "./runtime.js";
import { InboundMessageHandler } from "./handlers/inbound.js";
import { OutboundMessageHandler } from "./handlers/outbound.js";
import { MessageLogger } from "./utils/logger.js";

export type ResolvedQQAccount = ChannelAccountSnapshot & {
  config: QQConfig;
  client?: OneBotClient;
};

function normalizeTarget(raw: string): string {
  return raw.replace(/^(qq:)/i, "");
}

const clients = new Map<string, OneBotClient>();

// Track whether a numeric ID is a group based on inbound message context
const numericTargetIsGroup = new Map<string, boolean>();

function getClientForAccount(accountId: string): OneBotClient | undefined {
  return clients.get(accountId);
}

function recordTargetContext(to: string, isGroup: boolean): void {
  // Strip group: prefix if present to store the raw numeric ID
  const numericId = to.replace(/^group:/, "");
  if (/^\d+$/.test(numericId)) {
    numericTargetIsGroup.set(numericId, isGroup);
    // Also store with group: prefix for lookup
    numericTargetIsGroup.set(to, isGroup);
  }
}

function isGroupTarget(to: string): boolean | undefined {
  return numericTargetIsGroup.get(to);
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

      const runtime = getQQRuntime();
      const logger = new MessageLogger();
      const inboundHandler = new InboundMessageHandler({
        client,
        config,
        accountId: account.accountId,
        runtime,
        logger,
      });

      client.on("connect", () => {
        console.log(`[QQ] Connected account ${account.accountId}`);
        try {
          runtime.channel.activity.record({
            channel: "qq",
            accountId: account.accountId,
            direction: "inbound",
          });
        } catch {
          // ignore
        }
      });

      const outboundHandler = new OutboundMessageHandler(getClientForAccount);

      client.on("message", async (event) => {
        const inbound = await inboundHandler.handle(event);
        if (!inbound) return;

        const { isGroup, userId, groupId, ctxPayload } = inbound;

        // Record target context for outbound routing
        const targetId = isGroup ? `group:${groupId}` : String(userId);
        recordTargetContext(targetId, isGroup);
        if (isGroup && groupId) {
          // Also record the group ID itself as a group target
          recordTargetContext(String(groupId), true);
        }

        const deliver = async (payload: ReplyPayload) => {
          if (isGroup && groupId === undefined) return;
          const to = isGroup ? `group:${groupId}` : String(userId);

          // Important: route bot replies through the same preprocessing logic as outbound.sendText
          // so action/quote chunking works for normal replies too.
          if (payload.text) {
            await outboundHandler.sendText({
              to,
              text: payload.text,
              accountId: account.accountId,
            });
          }

          if (payload.files) {
            for (const file of payload.files) {
              if (file.url) {
                // Keep current behavior: just send CQ image marker.
                await outboundHandler.sendText({
                  to,
                  text: `[CQ:image,file=${file.url}]`,
                  accountId: account.accountId,
                });
              }
            }
          }
        };

        const { dispatcher, replyOptions } = runtime.channel.reply.createReplyDispatcherWithTyping({
          deliver,
        });

        await runtime.channel.session.recordInboundSession({
          storePath: runtime.channel.session.resolveStorePath(cfg.session?.store, { agentId: "default" }),
          sessionKey: ctxPayload.SessionKey!,
          ctx: ctxPayload,
          updateLastRoute: {
            sessionKey: ctxPayload.SessionKey!,
            channel: "qq",
            to: ctxPayload.From,
            accountId: account.accountId,
          },
          onRecordError: (err) => console.error("QQ Session Error:", err),
        });

        await runtime.channel.reply.dispatchReplyFromConfig({
          ctx: ctxPayload,
          cfg,
          dispatcher,
          replyOptions,
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
      const handler = new OutboundMessageHandler(getClientForAccount);
      // Trim whitespace and route based on group: prefix
      const fixedTo = to.trim();
      if (fixedTo !== to) {
        console.log(`[QQ] Trimmed target: "${to}" -> "${fixedTo}"`);
      }
      return handler.sendText({ to: fixedTo, text, accountId, replyTo });
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, replyTo }) => {
      const handler = new OutboundMessageHandler(getClientForAccount);
      // Trim whitespace and route based on group: prefix
      const fixedTo = to.trim();
      if (fixedTo !== to) {
        console.log(`[QQ] Trimmed target: "${to}" -> "${fixedTo}"`);
      }
      return handler.sendMedia({ to: fixedTo, text, mediaUrl, accountId, replyTo });
    },
  },
  messaging: {
    normalizeTarget,
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
  },
};
