# coordinate-cli-agents

通过项目内的 `.agent-bus` 文件总线，让 **Codex CLI** 与 **Google Antigravity CLI（agy）** 在同一 Git 仓库中进入可恢复的双代理协作状态。

这套工作流不依赖 CAO、常驻服务或额外账号体系。两个 CLI 保留各自原生登录与订阅，共享项目目录，但职责严格分离：

- **Codex**：澄清需求、编写规格、验收、代码审查、发布计划与发布后检查；不修改产品代码。
- **Antigravity**：唯一的代码实现者，负责源码、测试、UI、构建修复与浏览器验证；不执行发布。

## 工作原理

```text
用户需求
   │
   ▼
Codex ── IMPLEMENT ──▶ .agent-bus ──▶ Antigravity
  ▲                                      │
  └── IMPLEMENTATION_DONE + commit ──────┘
   │
   ├── CHANGES_REQUESTED ───────────────▶ 继续修改
   └── REVIEW_APPROVED ─────────────────▶ 等待下一任务
```

消息采用临时文件写入后原子移动的方式投递。接收方把消息依次从 `new` 移到 `processing` 和 `processed`，因此终端中断后可以恢复，不会仅凭聊天文本声称任务已经完成。

## 环境要求

- Windows PowerShell 5.1 或 PowerShell 7+
- Git
- Codex CLI，且已完成登录
- Antigravity CLI（`agy`），且已完成登录
- 一个已经初始化的 Git 项目

## 安装

### Codex

```powershell
git clone https://github.com/hogancv/coordinate-cli-agents.git `
  "$HOME\.codex\skills\coordinate-cli-agents"
```

如果仓库是私有的，请先执行 `gh auth login`，然后使用：

```powershell
gh repo clone hogancv/coordinate-cli-agents `
  "$HOME\.codex\skills\coordinate-cli-agents"
```

### Antigravity

推荐创建目录联接，让两个 CLI 使用同一份技能，后续只需更新一次：

```powershell
New-Item -ItemType Directory -Force "$HOME\.gemini\skills" | Out-Null
New-Item -ItemType Junction `
  -Path "$HOME\.gemini\skills\coordinate-cli-agents" `
  -Target "$HOME\.codex\skills\coordinate-cli-agents"
```

安装后重新启动两个 CLI，使其重新发现技能。

## 30 秒开始协作

### 1. 准备项目

```powershell
mkdir todo-app
cd todo-app
git init
git commit --allow-empty -m "Initial commit"
```

### 2. 打开两个终端

两个终端都进入同一个项目目录：

```powershell
cd C:\path\to\todo-app
```

- 终端 A 启动 `codex`
- 终端 B 启动 `agy`

### 3. 给 Codex 的提示词

```text
调用 $coordinate-cli-agents 进入协同模式。你是 Codex，只负责需求澄清、规格、验收、review 和发布门禁，不得修改产品代码。

需求：开发一个 Todo List Web 应用，支持新增、完成、删除和本地持久化。先澄清真正影响实现的决策；形成可执行规格后通过 agent bus 交给 Antigravity；等待它提交实现，再验证提交、测试、构建和证据。发现问题就发 CHANGES_REQUESTED 并继续等待；通过后给出 REVIEW_APPROVED 和发布计划，但没有收到我输入的 RELEASE_APPROVED 之前不得发布。
```

### 4. 给 Antigravity 的提示词

```text
调用 $coordinate-cli-agents 进入协同模式。你是 Antigravity，是唯一允许修改产品代码的代理。立即检查 agent bus 并等待 Codex 的 IMPLEMENT 或 CHANGES_REQUESTED；收到后完成全部实现、测试、构建和必要的浏览器验证，提交 Git commit，保存验证证据，发送 IMPLEMENTATION_DONE，然后继续等待 review 结果。不得执行发布。
```

之后只需要继续在 **Codex 终端**提出需求或回答澄清问题。Antigravity 会从文件总线读取规格并完成编码。

## 发布门禁

`REVIEW_APPROVED` 只表示代码审查通过，不等于允许发布。Codex 只有在用户明确输入下面这条授权后，才能执行已经描述清楚的 merge、tag、push、deploy 或 publish：

```text
RELEASE_APPROVED
```

## 手动诊断

正常使用时由技能自动调用脚本；排障时可以手动查看状态：

```powershell
$BusTool = "$HOME\.codex\skills\coordinate-cli-agents\scripts\agent-bus.ps1"
$Repo = (git rev-parse --show-toplevel)

powershell -NoProfile -ExecutionPolicy Bypass -File $BusTool init -Root $Repo
powershell -NoProfile -ExecutionPolicy Bypass -File $BusTool status -Root $Repo
```

手动等待 Codex 的下一条消息：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File $BusTool wait `
  -Root $Repo -Role codex -TimeoutMinutes 120 -PollSeconds 5
```

支持的子命令：`init`、`send`、`wait`、`complete`、`state`、`status`。

## 目录结构

```text
.agent-bus/
├── inbox/
│   ├── codex/{new,processing,processed}/
│   └── antigravity/{new,processing,processed}/
├── specs/       # Codex 编写的实现规格
├── reviews/     # Codex 的审查记录
├── evidence/    # Antigravity 的测试、构建和浏览器验证证据
├── releases/    # 发布计划与发布结果
├── state/       # 两个角色的当前状态
├── logs/
└── tmp/
```

初始化时，脚本会把 `.agent-bus/` 加入当前仓库的 `.git/info/exclude`，不会修改项目的 `.gitignore`，也不会把运行时消息提交到业务仓库。

## 恢复与限制

- 轮询等待是支持的，但仅在对应 CLI 会话及其 PowerShell 进程仍然运行时有效。
- 默认等待 120 分钟，每 5 秒检查一次；超时不会丢失状态，再次调用技能即可恢复。
- CLI 或终端意外退出后，重新调用技能；它会检查 `new`、当前角色拥有的 `processing` 消息以及角色状态。
- 不要让两个角色同时执行 Git 写操作。正常合同下只有 Antigravity 写实现提交；Codex 仅在发布获批且 Antigravity 空闲、工作树干净时执行发布相关 Git 操作。
- 两个终端必须指向同一个 Git 仓库和同一个可见文件系统。

## 更新

```powershell
git -C "$HOME\.codex\skills\coordinate-cli-agents" pull --ff-only
```

## 仓库内容

- [`SKILL.md`](./SKILL.md)：代理执行合同与协作循环
- [`scripts/agent-bus.ps1`](./scripts/agent-bus.ps1)：文件总线实现
- [`references/protocol.md`](./references/protocol.md)：消息类型、恢复规则与发布门禁
- [`agents/openai.yaml`](./agents/openai.yaml)：Codex 技能界面元数据
