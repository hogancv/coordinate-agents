# coordinate-cli-agents

简体中文 | [English](./README.md)

基于本地优先架构的 AI 编程代理协作协议与运行时（Local-first Coordination Protocol & Runtime）。在同一个 Git 仓库内，通过可恢复的项目级 `.agent-bus` 协调多代理开发协作。**OpenAI Codex CLI** 与 **Google Antigravity CLI（`agy`）** 作为官方第一方参考适配器与默认协作工作流，同时支持动态注册自定义 CLI 代理，并通过适配器扩展模型支持桌面级编程代理接入。

无需 CAO Server、常驻后台守护进程、外部数据库或共享 API 凭据。

## 60 秒快速开始

前提：已安装 Node.js 18+、Git，并已完成 `codex` 和 `agy` 的账号认证（或使用已注册的自定义代理）。

在你的 Git 仓库中运行：

```sh
npx @hogancv/coordinate-cli-agents@latest install --lang zh-CN
npx @hogancv/coordinate-cli-agents@latest quickstart --template feature --task "开发 Todo Web 应用，支持新增、完成、删除和本地持久化" --lang zh-CN
```

`quickstart` 会初始化本地总线，并准确输出两条简短、可复制的命令：

1. 把 **Codex** 命令粘贴到终端 1。
2. 把 **Antigravity** 命令粘贴到终端 2。
3. 以后只和 Codex 沟通；Antigravity 会通过总线接收实现任务。

不再需要手动复制或维护两段角色提示词。首次任务可选择 `--template bug`、`--template feature` 或 `--template refactor`；后续工作直接按同一清单向 Codex 提出新需求。

参考适配器会声明自己的启动生命周期。Codex 采用一次性交互启动；Antigravity 采用总线监督启动：Agent 正常退出后，同一个 `launch` 进程会继续以非破坏方式等待，后续审查反馈或其他总线消息到达时自动再次启动 `agy`。监督器不会认领消息或创建租约。可按 Ctrl+C 终止，发送 `STOP` 让 Agent 写入 `STOPPED`，或在需要单次激活的脚本中使用与 Agent 无关的 `launch --once` 逃生选项。

![完整端到端终端演示](./assets/demo.gif)

该动图由 `npm run demo` 在真实的隔离 Git 仓库中生成，完整执行需求提交、Antigravity 实现与提交、自动化测试、Codex 审查真实 commit/证据，以及 `REVIEW_APPROVED`。脱敏后的原始记录位于 [`assets/demo-transcript.txt`](./assets/demo-transcript.txt)。

## 让 AI 帮你安装

仓库根目录提供一份统一的中英双语 [AI 安装指南](./AI_INSTALL.md)。把下面任一提示词交给 AI
助手即可；AI 必须先核对官方身份，不得索取凭据或使用未知脚本，安装后必须执行 `doctor`，并在
用户另行要求前停止，不得自动启动协作任务。

**同时安装两个代理**

```text
从官方仓库 https://github.com/hogancv/coordinate-cli-agents 安装 coordinate-cli-agents。先读取仓库根目录的 AI_INSTALL.md，核对仓库所有者、npm 包名、最新稳定版本和安装影响，然后按照文档为 Codex CLI 与 Antigravity CLI 安装。安装完成后运行 doctor --lang zh-CN 验证并向我报告结果。不要使用第三方 Fork，不要索取凭据，不要修改我的产品代码，也不要在验证成功前启动协作任务。
```

**只安装 Codex**

```text
从官方仓库 hogancv/coordinate-cli-agents 安装 Codex 端 Skill。先读取 AI_INSTALL.md 并核对官方 npm 包，仅安装 Codex 端，完成后运行 doctor --codex --lang zh-CN。不要修改当前项目代码。
```

**只安装 Antigravity**

```text
从官方仓库 hogancv/coordinate-cli-agents 安装 Antigravity 端 Skill。先读取 AI_INSTALL.md 并核对官方 npm 包，仅安装 Antigravity 端，完成后运行 doctor --antigravity --lang zh-CN。不要修改当前项目代码。
```

## 架构：代理总线、适配器与工作流角色

```mermaid
graph TD
    subgraph 协作编排层 Coordination Layer
        P[工作流角色: 规划者 Planner]
        I[工作流角色: 实现者 Implementer]
        R[工作流角色: 审查者 Reviewer]
    end
    subgraph 代理总线协议层 Agent Bus Protocol Layer
        REG[代理注册中心 config.json]
        Q[独立收件箱: new / processing / processed]
        DEDUPE[幂等去重与租赁锁]
        STATE[仅追加状态日志]
    end
    subgraph 适配器与运行时层 Adapters & Runtime Layer
        A1[codex-cli 适配器]
        A2[antigravity-cli 适配器]
        A3[generic-cli 适配器]
        A4[桌面代理扩展模型 Desktop Adapter]
    end
    P --> REG
    I --> REG
    R --> REG
    REG --> Q
    Q --> A1
    Q --> A2
    Q --> A3
    Q --> A4
```

### 三层架构体系

1. **协作编排层 (Coordination Layer)**：将工作流角色（`planner`、`implementer`、`reviewer`）映射到具体代理，并严格管理人类发布审批门禁。
2. **代理总线协议层 (Agent Bus Protocol Layer)**：管理代理注册表、消息生命周期、租赁锁、仅追加状态及崩溃恢复机制，与具体厂商和传输介质解耦。
3. **适配器与运行时层 (Adapters & Runtime Layer)**：桥接具体执行界面（内置 `codex-cli`、`antigravity-cli` 适配器、动态 `generic-cli` 适配器及桌面适配器扩展模型），完成任务输入与执行。

### 代理身份 vs 工作流角色

- **代理身份 (Agent Identity)**：标识具体的执行引擎与传输形式（如 `codex`、`antigravity`、`claude`、`custom-agent`）。在 `.agent-bus/config.json` 中配置。
- **工作流角色 (Workflow Role)**：定义开发闭环中的职责：
  - **规划与审查者 (Planner / Reviewer)**（默认：`codex`）：明确用户需求，在 `.agent-bus/specs/` 编写规格说明，审查 commit 与测试构建证据，管控发布门禁。严禁修改业务实现代码。
  - **实现者 (Implementer)**（默认：`antigravity`）：业务代码与测试的唯一编写者。实现功能、执行验证、提交 commit，并在 `.agent-bus/evidence/` 输出证据。严禁执行发布。

### 兼容性五维准则

任何接入代理总线的代理或适配器需满足：
- **Receive（接收）**：从 `inbox/<agent_id>/new` 原子移动认领任务至 `processing`。
- **Execute（执行）**：在本地 Git 工作区执行任务指令。
- **Observe（观测）**：跟踪标准化运行状态（`idle`, `working`, `completed`, `failed`, `waiting`）。
- **Result（产出）**：记录输出产物、commit 哈希或审查发现。
- **Report（汇报）**：写入状态日志并发送原子交接消息。

## 动态代理注册与扩展

无需修改总线核心代码即可注册第三方或自定义 CLI 代理：

```sh
# 注册自定义 CLI 代理
npx @hogancv/coordinate-cli-agents@latest agent add my-agent --adapter generic-cli --command my-agent --args '["--prompt", "{prompt}", "--dir", "{root}"]'

# 列出所有已注册代理及当前工作流角色分配
npx @hogancv/coordinate-cli-agents@latest agent list

# 诊断检查所有已注册代理及其 CLI 适配器可用性
npx @hogancv/coordinate-cli-agents@latest agent doctor
```

启动包含自定义角色分配的协作：

```sh
npx @hogancv/coordinate-cli-agents@latest quickstart --planner codex --implementer my-agent --template feature --task "开发搜索功能"
```

## 环境要求

- Windows、macOS 或 Linux
- Node.js 18 或更高版本
- Git
- 已完成认证的 Codex CLI（用于 Codex 参考适配器）
- 已完成认证的 Antigravity CLI（用于 Antigravity 参考适配器）

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

安装器不会把技能目录链接到可能被清理的 npm 临时缓存。更新前会备份由本包管理的旧安装，包括已修改的受管理副本。来源不明的目录在未明确提供 `--force` 时不会被覆盖；卸载已修改的副本同样必须显式使用 `--force`。

验证安装：

```sh
npx @hogancv/coordinate-cli-agents@latest doctor --lang zh-CN
```

`doctor` 会检查 Node.js、Git、`codex`、`agy` 以及两份技能安装。缺失组件和由本包管理但损坏的安装会得到根据当前平台生成的建议修复命令；无法识别的现有技能目录则会得到先备份或移动的非破坏性操作说明。Linux 用户必须先确认建议适用于自己的发行版且能提供 Node.js 18+，再执行该命令。

常用命令：

```sh
# 只安装 Codex
npx @hogancv/coordinate-cli-agents@latest install --codex --lang zh-CN

# 只安装 Antigravity
npx @hogancv/coordinate-cli-agents@latest install --antigravity --lang zh-CN

# 明确执行更新
npx @hogancv/coordinate-cli-agents@latest update --lang zh-CN

# 中文输出诊断
npx @hogancv/coordinate-cli-agents@latest doctor --lang zh-CN

# 移除由本包管理的安装
npx @hogancv/coordinate-cli-agents@latest uninstall
```

安装器遵循 `CODEX_HOME` 与 `GEMINI_HOME`。也可以使用 `--codex-home <路径>` 和 `--antigravity-home <路径>` 自定义目标目录。

安装后请重启两个 CLI 以便重新发现技能。

或者全局安装命令以便直接使用：

```sh
npm install --global @hogancv/coordinate-cli-agents
coordinate-cli-agents install
coordinate-cli-agents doctor
```

## 任务模板

| 模板 | 适用场景 | 规划者在实现前必须明确的内容 |
| --- | --- | --- |
| `bug` | 缺陷与功能回退 | 复现步骤、预期与实际表现、根因分析、最小修复方案、回归测试 |
| `feature` | 新的用户可见功能 | 用户价值、交互/API 设计、作用域、边界情况、兼容性、验收标准 |
| `refactor` | 内部结构重构 | 不变式约束、非目标说明、绿色基线、增量修改、重构前后对比验证 |

示例：

```sh
npx @hogancv/coordinate-cli-agents@latest quickstart --template bug --task "空查询导致搜索崩溃"
npx @hogancv/coordinate-cli-agents@latest quickstart --template feature --task "添加截止日期与逾期过滤器"
npx @hogancv/coordinate-cli-agents@latest quickstart --template refactor --task "抽离持久化层且不改变 UI 行为"
```

各模板的详细信息清单请参见 [`references/task-templates.md`](./references/task-templates.md)。

## 发布门禁

`REVIEW_APPROVED` 并不是发布授权。只有当用户针对明确说明的发布方案输入完全一致的授权文本时，规划/审查者才可执行分支合并、打标签、推送、部署或发布：

```text
RELEASE_APPROVED
```

## 故障恢复与等待机制

- `wait` 默认每 5 秒轮询一次，最长等待 120 分钟。
- 等待仅在当前 CLI 会话及其 Node.js 进程保持存活时有效。
- 总线监督型 `launch` 也会在 Agent 正常退出后保持存活；它只观察 `new`、该 Agent 所有的 `processing` 和 `STOPPED` 状态，不会代替 Agent 认领任务。子进程非零退出会停止监督并报告失败。
- 消息与状态在终端重启后依然保留。再次调用本技能即可检查并继续处理 `new` 或由当前代理认领的 `processing` 消息。
- `.agent-bus/` 写入当前仓库本地的 `.git/info/exclude`，不会污染版本库跟踪的 `.gitignore`。
- 严禁多个角色同时进行 Git 写入。

任务认领默认具有 4 小时租赁期。仅当确认未产生对应工作成果、commit 或回复后，才可回收异常中断的认领：

```sh
BUS_TOOL="$HOME/.codex/skills/coordinate-cli-agents/scripts/agent-bus.mjs"
REPO="$(git rev-parse --show-toplevel)"
node "$BUS_TOOL" recover --root "$REPO" --agent antigravity --stale-after-seconds 14400
```

重发消息时请使用 `--dedupe-key <稳定轮次标识>`。相同发送方、接收方与去重键的并发发送会自动归并为一条消息。消息发布使用同分区临时文件、刷盘并原子重命名；认领使用原子重命名；完成操作具备幂等性。损坏的消息会自动隔离而非交付，状态读取则自动回退至最新有效的仅追加记录。

## 安全与数据边界

`.agent-bus/` 属于**本地明文工作数据**，而非机密存储区。它可能包含：

- 完整的提示词、需求、规格说明、澄清问答与审查评论；
- commit 哈希、文件路径、验证日志，以及证据中的代码片段或 diff；
- 角色状态、进程与主机元数据、消息租赁锁、去重记录与历史队列。

请勿在总线消息中放置访问令牌、Cookie、密码、私钥或未经脱敏的生产数据。总线继承当前仓库目录的操作系统权限，本包不对其进行加密。`.git/info/exclude` 仅防止普通的 Git 跟踪，但**不能**阻止本地管理员、备份工具、网盘同步、恶意程序或同权限进程读取。对外提供诊断信息前，请仔细检查并脱敏 `.agent-bus/`。

常规恢复操作会保留历史记录。协作和审计完成后，可使用显式确认彻底清除总线数据：

```sh
node "$BUS_TOOL" clean --root "$REPO" --confirm DELETE_AGENT_BUS
```

该命令会永久删除 `.agent-bus/` 下的所有规格、消息、证据、审查、发布、日志、状态、租赁与去重记录，但不会删除业务代码与 Git commits。

## 手动诊断

通常情况下，Skill 会自动调用总线脚本。如需手动排查：

```sh
BUS_TOOL="$HOME/.codex/skills/coordinate-cli-agents/scripts/agent-bus.mjs"
REPO="$(git rev-parse --show-toplevel)"

node "$BUS_TOOL" init --root "$REPO"
node "$BUS_TOOL" status --root "$REPO"
```

支持的总线子命令：`init`、`send`、`wait`、`complete`、`recover`、`state`、`status`、`agent-add`、`agent-list` 与 `clean`。

## 参与开发

```sh
npm test
npm run check
npm run demo
npm pack --dry-run
```

## 发布完整性

- CI 在 Linux、Windows 和 macOS 上对 Node.js 18 与 22 进行测试。
- 仅当 GitHub Release 的 `vX.Y.Z` 标签与 `package.json` 完全一致时才触发发布。
- 稳定版使用 npm 标签 `latest`；预发布版使用 `next`。
- `.github/workflows/release.yml` 使用 npm Trusted Publishing (OIDC)，杜绝长期发布 Token，并在 `publishConfig` 中启用 npm Provenance。
- 维护者必须在首次自动发布前，为 `hogancv/coordinate-cli-agents` 仓库配置 npm Trusted Publisher。

## 常见问题 (FAQ)

### 什么是 coordinate-cli-agents？

它是官方发布的 [`hogancv/coordinate-cli-agents`](https://github.com/hogancv/coordinate-cli-agents) npm 包与 Codex Skill，用于多代理编程协作工作流。Codex 负责需求澄清、规格制定、代码审查与发布门禁控制；Google Antigravity CLI（`agy`）则专注于业务代码与测试的实现。

### 如何让 Codex CLI 和 Antigravity CLI 协作？

在目标 Git 仓库中先后运行 [`install`](#通过-npm-安装) 和 [`quickstart`](#60-秒快速开始)。分别在两个独立终端中运行输出的命令，然后继续向 Codex 提出需求即可。

### 如何在一个 Git 仓库中运行两个编程代理？

在同一个 Git 仓库中打开两个 CLI 会话，但同一时刻仅允许一个角色拥有 Git 写入权限。项目本地的 `.agent-bus` 用于传递规格说明、实现结果、审查结论、租赁状态与恢复信息，无需共享 API 凭据。

### 如何防止两个 AI 代理同时修改代码？

通过安装的角色契约，Antigravity 是业务代码的唯一修改者。Codex 负责澄清、编写规格、检查 commit、审查证据与操作经明确授权的发布，但严禁修改实现文件。该工作流同时禁止并发 Git 写入。

### 如何从 npm 安装 Codex Skill？

运行 `npx @hogancv/coordinate-cli-agents@latest install --codex --lang zh-CN`，重启 Codex CLI，并通过 `npx @hogancv/coordinate-cli-agents@latest doctor --codex --lang zh-CN` 进行验证。若由 AI 执行安装，请使用官方标准的 [`AI_INSTALL.md`](./AI_INSTALL.md)。

### Codex CLI 与 Antigravity CLI 的分工是什么？

Codex 负责澄清需求、生成规格说明与验收标准、审查 commit 和证据、指出需要修改的问题，并把关发布门禁。Antigravity 负责实现源码与测试、验证 UI/浏览器行为、修复构建问题并提交 commit；它不执行发布。

### 如何恢复被中断的多代理开发工作？

重新调用本技能并检查 `status`；持久化消息与状态在终端重启后依然保留。仅在确认未产生对应工作成果、commit 或回复后，才可回收过期的认领消息。详见[故障恢复与等待机制](#故障恢复与等待机制)。

### `.agent-bus` 安全吗？

它属于本地明文工作数据，而非加密的机密存储。`.git/info/exclude` 仅防止普通 Git 跟踪，无法防御本地其他进程、管理员、备份工具或同步软件。切勿在其中存储凭据；请阅读[安全与数据边界](#安全与数据边界)和 [`SECURITY.md`](./SECURITY.md)。

### 如何卸载 coordinate-cli-agents？

运行 `npx @hogancv/coordinate-cli-agents@latest uninstall`。该命令默认仅清理可识别且未被修改的受管安装，遇到未知目录或已修改内容时会拒绝删除，除非显式指定 `--force`。

## 许可证

[MIT](./LICENSE)
