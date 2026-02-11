
Clawdbot (Moltbot) is a multi-functional agent. The chat demonstration below is only the most basic functionality.
<img width="1324" height="1000" alt="image" src="https://github.com/user-attachments/assets/00b0f347-be84-4fe0-94f2-456679d84f45" />
<img width="1687" height="1043" alt="PixPin_2026-01-29_16-09-58" src="https://github.com/user-attachments/assets/998a1d42-9566-4d20-8467-39dd1752a035" />
<img width="1380" height="710" alt="image" src="https://github.com/user-attachments/assets/9900b779-732a-4b3e-88a1-b10fe7d555c0" />



# Moltbot QQ Plugin (OneBot v11)

This plugin adds QQ channel support to [Moltbot](https://github.com/moltbot/moltbot) using the OneBot v11 protocol (via WebSocket).

---

<details>
<summary><b>English Guide</b></summary>

## 📋 Prerequisites
You need a running OneBot v11 server. We recommend:
- **[NapCat](https://github.com/NapCatQQ/NapCat-Docker)** (Modern, Docker-friendly)
- **Lagrange** or **Go-CQHTTP**

Ensure the **WebSocket Server** is enabled in your OneBot settings (usually on port 3001).

## 🚀 Installation

### Method A: Source / Official Installation
If you installed Moltbot by cloning the repository:

1. **Navigate to extensions folder**:
   ```bash
   cd moltbot/extensions
   ```
2. **Clone this plugin**:
   ```bash
   git clone https://github.com/constansino/moltbot_qq.git qq
   ```
3. **Install dependencies & Build**:
   Go back to the moltbot root directory:
   ```bash
   cd ..
   pnpm install
   pnpm build
   ```
4. **Restart Moltbot**.

### Method B: Docker Installation (Custom Build)
If you are running Moltbot via Docker and building from source:

1. Place the `moltbot_qq` files into your `extensions/qq` folder within your build context.
2. **Rebuild the image**:
   ```bash
   docker compose build clawdbot-gateway
   ```
3. **Restart the container**:
   ```bash
   docker compose up -d clawdbot-gateway
   ```

## ⚙️ Configuration
Edit your `clawdbot.json` (usually in `~/.clawdbot/clawdbot.json`):

Key options:
- `reply_on_mentioned`: Auto-reply when the bot is mentioned (recommended `true` for group chats).
- `strip_markdown`: Remove markdown syntax (such as `#`, `**`, `---`, list markers) before sending text to QQ.

> Compatibility note: this extension currently reads `requireMention` and `stripMarkdown` internally.
> If your OpenClaw/Moltbot runtime does not normalize snake_case keys automatically,
> use the legacy camelCase keys shown in the fallback example.

Recommended (snake_case) config:

```json
{
  "channels": {
    "qq": {
      "wsUrl": "ws://<YOUR_ONEBOT_IP>:3001",
      "accessToken": "your_token_here",
      "reply_on_mentioned": true,
      "strip_markdown": true
    }
  },
  "plugins": {
    "entries": {
      "qq": {
        "enabled": true
      }
    }
  }
}
```

Fallback (camelCase) config:

```json
{
  "channels": {
    "qq": {
      "wsUrl": "ws://<YOUR_ONEBOT_IP>:3001",
      "accessToken": "your_token_here",
      "requireMention": true,
      "stripMarkdown": true
    }
  },
  "plugins": {
    "entries": {
      "qq": {
        "enabled": true
      }
    }
  }
}
```

## 🛠 Troubleshooting
- **502 Gateway Error**: Usually means Moltbot crashed. Check logs: `docker logs -f clawdbot-gateway`.
- **Session Locked**: If the bot crashes, delete `.lock` files in your config directory: `find . -name "*.lock" -delete`.

</details>

---

<details>
<summary><b>中文使用指南</b></summary>

## 📋 前置条件
你需要一个运行中的 OneBot v11 服务端，推荐：
- **[NapCat](https://github.com/NapCatQQ/NapCat-Docker)** (现代、对 Docker 友好)
- **Lagrange** 或 **Go-CQHTTP**

请确保在 OneBot 设置中开启了 **正向 WebSocket 服务**（通常端口为 3001）。

## 🚀 安装步骤

### 方案 A：源码 / 官方安装版
如果你是通过克隆仓库安装的 Moltbot：

1. **进入扩展目录**：
   ```bash
   cd moltbot/extensions
   ```
2. **克隆此插件**：
   ```bash
   git clone https://github.com/constansino/moltbot_qq.git qq
   ```
3. **安装依赖并编译**：
   回到 Moltbot 根目录执行：
   ```bash
   cd ..
   pnpm install
   pnpm build
   ```
4. **重启 Moltbot**。

### 方案 B：Docker 安装（自定义构建）
如果你使用 Docker 且通过 `docker-compose.yml` 中的 `build` 指令运行：

1. 将 `moltbot_qq` 的文件放入构建上下文中的 `extensions/qq` 目录。
2. **重新构建镜像**：
   ```bash
   docker compose build clawdbot-gateway
   ```
3. **重新启动容器**：
   ```bash
   docker compose up -d clawdbot-gateway
   ```

## ⚙️ 配置方法
编辑您的 `clawdbot.json` 配置文件（通常位于 `~/.clawdbot/clawdbot.json`）：

关键配置项：
- `reply_on_mentioned`：被 @ 或被回复时自动响应（群聊建议开启）。
- `strip_markdown`：发送到 QQ 前去掉 Markdown 标记（如 `#`、`**`、`---`、列表符号等）。

> 兼容性说明：当前扩展内部读取的是 `requireMention` 和 `stripMarkdown`。
> 如果你的 OpenClaw/Moltbot 版本不会自动将 snake_case 映射为 camelCase，
> 请使用下面的兼容写法（camelCase 示例）。

推荐写法（snake_case）：

```json
{
  "channels": {
    "qq": {
      "wsUrl": "ws://<ONEBOT_服务器_IP>:3001",
      "accessToken": "你的安全Token",
      "reply_on_mentioned": true,
      "strip_markdown": true
    }
  },
  "plugins": {
    "entries": {
      "qq": {
        "enabled": true
      }
    }
  }
}
```

兼容写法（camelCase）：

```json
{
  "channels": {
    "qq": {
      "wsUrl": "ws://<ONEBOT_服务器_IP>:3001",
      "accessToken": "你的安全Token",
      "requireMention": true,
      "stripMarkdown": true
    }
  },
  "plugins": {
    "entries": {
      "qq": {
        "enabled": true
      }
    }
  }
}
```

## 🤖 如果你是 Bot，看这里
这个小节给 AI 助手（例如 OpenClaw）使用：读完后可以自动完成 QQ 扩展配置与自检。

### 1) Bot 自检清单
在自动改配置前，先确认以下项目：

- [ ] QQ extension 已安装并启用（`plugins.entries.qq.enabled=true`）。
- [ ] `reply_on_mentioned` 已配置（建议 `true`，方便在群里被 @ 时快速响应）。
- [ ] `strip_markdown` 已配置（建议 `true`，QQ 客户端不支持标准 Markdown 渲染）。
- [ ] OneBot v11 WebSocket 连接正常（`wsUrl` 可连接，`accessToken` 正确）。

### 2) 自动配置指引（修改 config.json）

配置文件路径（按部署方式优先尝试）：

1. `~/.clawdbot/clawdbot.json`（最常见）
2. `${CLAWDBOT_CONFIG_DIR}/clawdbot.json`（自定义配置目录）
3. 当前项目根目录的 `clawdbot.json`（源码部署场景）

最小可用配置（推荐 snake_case 写法）：

```json
{
  "channels": {
    "qq": {
      "wsUrl": "ws://127.0.0.1:3001",
      "accessToken": "your_token_here",
      "reply_on_mentioned": true,
      "strip_markdown": true
    }
  },
  "plugins": {
    "entries": {
      "qq": {
        "enabled": true
      }
    }
  }
}
```

关键配置项说明：

- `channels.qq.wsUrl`：OneBot 正向 WebSocket 地址。
- `channels.qq.accessToken`：OneBot 鉴权 Token（和 OneBot 服务端保持一致）。
- `channels.qq.reply_on_mentioned`：在群聊被 @ 或被回复时自动响应（建议开启）。
- `channels.qq.strip_markdown`：发送前去除 Markdown 标记（建议开启）。
- `plugins.entries.qq.enabled`：启用 QQ 扩展。

兼容性提示：若运行时未做 snake_case -> camelCase 映射，请写成 `requireMention` 与 `stripMarkdown`。

### 3) 常见 Bot 场景建议配置

群聊场景（推荐）：
- `reply_on_mentioned=true`
- `strip_markdown=true`
- 保持 `accessToken` 与 OneBot 一致，避免群内无响应

私聊场景（推荐）：
- `reply_on_mentioned=false` 或 `true` 均可（私聊通常无需 @）
- `strip_markdown=true`
- 若希望私聊始终即时响应，可结合上层路由策略放宽触发条件

混合场景（群聊 + 私聊）：
- `reply_on_mentioned=true`（保证群聊不刷屏）
- `strip_markdown=true`
- 若框架支持，可在上层按会话类型细分触发逻辑（群聊更严格、私聊更宽松）

### 4) 配置验证步骤（Bot 自检）

- [ ] 配置文件可解析为合法 JSON（无注释、无尾逗号）。
- [ ] `plugins.entries.qq.enabled` 为 `true`。
- [ ] `channels.qq.wsUrl` 与 OneBot 实际监听地址一致。
- [ ] `channels.qq.accessToken` 与 OneBot 配置一致。
- [ ] 发送一条测试消息：私聊可直接回复；群聊中 @Bot 能触发回复。
- [ ] 发送含 Markdown 的测试文本（如 `## 标题`、`**粗体**`），确认 QQ 中显示为纯文本。

## 🛠 常见问题排除
- **502 Gateway Error**：通常表示 Moltbot 崩溃了。请检查日志：`docker logs -f clawdbot-gateway`。
- **Session Locked (会话锁死)**：如果机器人非正常退出，请删除配置目录下的锁文件：`find . -name "*.lock" -delete`。

</details>
