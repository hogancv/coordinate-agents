# coordinate-cli-agents

简体中文 | [English](./README.md)

为 **OpenAI Codex CLI** 和 **Google Antigravity CLI（`agy`）**安装一套可持久化、可恢复的协作工作流。两个代理通过项目内的 `.agent-bus` 通信，并保留各自原生账号、订阅和模型权限。

不需要 CAO Server、常驻服务、数据库或共享 API 凭据。

![完整端到端终端演示](./assets/demo.gif)

该动图由 `npm run demo` 在真实的隔离 Git 仓库中生成，完整执行需求提交、Antigravity 实现与提交、自动化测试、Codex 审查真实 commit/证据，以及 `REVIEW_APPROVED`。脱敏后的原始记录位于 [`assets/demo-transcript.txt`](./assets/demo-transcript.txt)。

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

消息认领默认带有 4 小时租约。进程中断后，先确认没有对应的实现、commit 或回复，再恢复遗留消息：

```sh
BUS_TOOL="$HOME/.codex/skills/coordinate-cli-agents/scripts/agent-bus.mjs"
REPO="$(git rev-parse --show-toplevel)"
node "$BUS_TOOL" recover --root "$REPO" --role antigravity --stale-after-seconds 14400
```

重试发送时使用 `--dedupe-key <稳定轮次标识>`。相同发送方、接收方和去重键的并发发送只会产生一条消息。消息先写入同卷临时文件，刷新并关闭后再原子重命名；认领也使用原子重命名；重复完成操作是幂等的。损坏消息会被隔离而不会交给代理，状态文件损坏时会回退到最新的有效追加式状态记录。

## 安全边界与数据清理

`.agent-bus/` 是**本地明文工作数据**，不是密钥保险库，其中可能保存：

- 完整提示词、需求、规格、问题和 review 意见；
- commit hash、文件路径、验证日志，以及证据中主动加入的 diff 或源码片段；
- 角色状态、进程/主机信息、消息租约、去重记录和队列历史。

不要写入访问令牌、Cookie、密码、私钥或非必要生产数据。本包不会加密该目录，它只继承仓库目录的操作系统权限。`.git/info/exclude` 只能避免普通 Git 跟踪，**不能**阻止本机管理员、备份工具、云同步客户端、恶意软件或以同一用户运行的其他进程读取。分享诊断信息前，应先检查并脱敏 `.agent-bus/`。

正常恢复不会删除历史。协作结束且不再需要审计记录后，可使用明确确认永久删除总线数据：

```sh
node "$BUS_TOOL" clean --root "$REPO" --confirm DELETE_AGENT_BUS
```

该命令只删除 `.agent-bus/` 下的规格、消息、证据、review、发布记录、日志、状态、租约和去重记录，不删除产品文件或 Git commit。

## 手动诊断

正常使用时由技能自动调用脚本。需要排障时：

```sh
BUS_TOOL="$HOME/.codex/skills/coordinate-cli-agents/scripts/agent-bus.mjs"
REPO="$(git rev-parse --show-toplevel)"

node "$BUS_TOOL" init --root "$REPO"
node "$BUS_TOOL" status --root "$REPO"
```

支持的总线命令：`init`、`send`、`wait`、`complete`、`recover`、`state`、`status` 和 `clean`。

## 开发与发布前检查

```sh
npm test
npm run check
npm run demo
npm pack --dry-run
```

## 发布可信度

- CI 在 Linux、Windows 和 macOS 上测试 Node.js 18、22。
- 只有 GitHub Release 的 `vX.Y.Z` 标签与 `package.json` 完全一致时才允许发布。
- 正式版本使用 npm 标签 `latest`，GitHub 预发布版本使用 `next`。
- `.github/workflows/release.yml` 使用 npm Trusted Publishing（OIDC），不保存长期发布 Token；`publishConfig` 已启用 npm provenance。
- 首次自动发布前，维护者必须在 npm 中为 `hogancv/coordinate-cli-agents` 配置 Trusted Publisher：仓库 `coordinate-cli-agents`、工作流 `release.yml`、允许操作 `npm publish`。

## 许可证

[MIT](./LICENSE)
