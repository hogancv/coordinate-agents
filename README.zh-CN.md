# coordinate-cli-agents

简体中文 | [English](./README.md)

为 **OpenAI Codex CLI** 和 **Google Antigravity CLI（`agy`）**安装一套可持久化、可恢复的协作工作流。两个代理通过项目内的 `.agent-bus` 通信，并保留各自原生账号、订阅和模型权限。

不需要 CAO Server、常驻服务、数据库或共享 API 凭据。

## 角色合同

- **Codex**：澄清需求、编写实现规格、审查真实提交和验证证据、规划发布，并执行获得批准的发布操作；不修改产品代码。
- **Antigravity**：唯一的实现代码编写者，负责源码、测试、UI、构建修复和浏览器验证；不执行发布。

```text
用户需求
   │
   ▼
Codex ── IMPLEMENT ──▶ .agent-bus ──▶ Antigravity
  ▲                                      │
  └── IMPLEMENTATION_DONE + commit ──────┘
   │
   ├── CHANGES_REQUESTED ───────────────▶ 继续修改
   └── REVIEW_APPROVED ─────────────────▶ 等待
```

## 环境要求

- Windows、macOS 或 Linux
- Node.js 18 或更高版本
- Git
- 已完成认证的 Codex CLI
- 已完成认证的 Antigravity CLI

## 通过 npm 安装

无需向业务项目添加依赖，即可安装或更新两个 CLI 的技能：

```sh
npx @hogancv/coordinate-cli-agents@latest install
```

安装器会把永久技能副本复制到：

```text
~/.codex/skills/coordinate-cli-agents
~/.gemini/skills/coordinate-cli-agents
```

安装器不会把技能目录链接到可能被清理的 npm 临时缓存。更新前会备份由本包管理的旧安装；对于来源不明或被本地修改的目录，除非明确提供 `--force`，否则不会覆盖。

验证安装：

```sh
npx @hogancv/coordinate-cli-agents@latest doctor --lang zh-CN
```

常用命令：

```sh
# 只安装 Codex
npx @hogancv/coordinate-cli-agents@latest install --codex --lang zh-CN

# 只安装 Antigravity
npx @hogancv/coordinate-cli-agents@latest install --antigravity --lang zh-CN

# 明确执行更新
npx @hogancv/coordinate-cli-agents@latest update --lang zh-CN

# 卸载由 npm 包管理的技能
npx @hogancv/coordinate-cli-agents@latest uninstall --lang zh-CN
```

安装器支持 `CODEX_HOME` 和 `GEMINI_HOME` 环境变量，也可以使用 `--codex-home <路径>` 和 `--antigravity-home <路径>`指定自定义根目录。

安装后重新启动两个 CLI，使其重新发现技能。

也可以全局安装命令，以后不再通过 `npx` 调用：

```sh
npm install --global @hogancv/coordinate-cli-agents
coordinate-cli-agents install --lang zh-CN
coordinate-cli-agents doctor --lang zh-CN
```

## 开始协作

打开两个终端，并让它们进入**同一个 Git 仓库**。

### Codex 终端

```text
调用 $coordinate-cli-agents 进入协同模式。你是 Codex，只负责需求澄清、规格、验收标准、真实提交与验证证据的 review，以及发布门禁，不得修改产品代码。把可直接实施的规格通过 agent bus 发给 Antigravity；等待 IMPLEMENTATION_DONE；验证提交、测试、构建和证据；然后发送 CHANGES_REQUESTED 或 REVIEW_APPROVED。没有收到我输入的精确授权 RELEASE_APPROVED 之前不得发布。

需求：开发一个 Todo List Web 应用，支持新增、完成、删除和本地持久化。
```

### Antigravity 终端

```text
调用 $coordinate-cli-agents 进入协同模式。你是 Antigravity，是唯一允许修改产品代码的代理。立即检查 agent bus 并等待 Codex 的 IMPLEMENT 或 CHANGES_REQUESTED；收到后完成实现，运行适用的格式化、lint、类型检查、测试、生产构建和浏览器验证；提交本轮实现；保存验证证据；发送包含 commit hash 的 IMPLEMENTATION_DONE；然后继续等待 review。不得执行发布。
```

以后只需要继续在 Codex 终端提出需求或回答澄清问题，Antigravity 会从文件总线接收实现任务。

## 发布门禁

`REVIEW_APPROVED` 只表示审查通过，不等于允许发布。Codex 只有在用户针对已描述的发布计划输入以下精确授权后，才能执行 merge、tag、push、deploy 或 publish：

```text
RELEASE_APPROVED
```

## 恢复与轮询

- `wait` 默认每 5 秒轮询一次，最长等待 120 分钟。
- 只有对应 CLI 会话及其 Node.js 进程仍在运行时，等待才会继续。
- 消息和状态会跨终端重启保留；重新调用技能即可检查并恢复 `new` 或当前角色拥有的 `processing` 消息。
- `.agent-bus/` 只会写入当前仓库本地的 `.git/info/exclude`，不会修改受版本控制的 `.gitignore`。
- 不要让两个角色同时执行 Git 写操作。

## 手动诊断

正常使用时由技能自动调用脚本。需要排障时：

```sh
BUS_TOOL="$HOME/.codex/skills/coordinate-cli-agents/scripts/agent-bus.mjs"
REPO="$(git rev-parse --show-toplevel)"

node "$BUS_TOOL" init --root "$REPO"
node "$BUS_TOOL" status --root "$REPO"
```

支持的总线命令：`init`、`send`、`wait`、`complete`、`state` 和 `status`。

## 开发与发布前检查

```sh
npm test
npm run check
npm pack --dry-run
```

## 许可证

[MIT](./LICENSE)
