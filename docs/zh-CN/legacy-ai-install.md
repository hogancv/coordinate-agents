---
title: Legacy Skill 安装
description: 保留的 npm 2.4.0 Skill 安装、验证、更新、卸载和备份流程；与 npm 3 Web Workspace 分开。
---

<div id="legacy-skill-installation-guide" class="doc-anchor" aria-hidden="true"></div>
<div id="legacy-skill-installation-guide--旧版-skill-安装指南" class="doc-anchor" aria-hidden="true"></div>
<div id="contents--目录" class="doc-anchor" aria-hidden="true"></div>
<div id="architecture--scope-host-skill-vs-project-agent--架构与范围宿主技能与项目代理" class="doc-anchor" aria-hidden="true"></div>

# Legacy Skill 安装指南

::: tip 结构化工作流（v2.4 路线）
本文参考保留的 Plugin / 源码 Legacy runtime，可能包含后续修复，并非冻结的 v2.4.0 快照。npm 3.x Web 不提供这些结构化 API。
[v2.4.0 原始文档与迁移](./v2.4.html) · [当前 Web 指南](./getting-started.html)。
:::

::: warning 分发边界
npm 3.0 以 Web 为主：使用 `npx @hogancv/coordinate-agents@latest web`。下文所有结构化安装/doctor/setup/SDK 指令均针对 GitHub Plugin/源码或 npm **2.4.0**。npm 3.x 不安装 Skill，也不提供 Legacy runtime。Plugin 版本独立；当前 Plugin 版本为 **2.4.0**，其解析器选择 `bin/coordinate-agents-legacy.mjs`。
:::

本指南保留可选的 Legacy Skill 安装生命周期。Web Workspace 请使用 [AI 安装指南](./install-with-ai.html)。面向用户的使用说明仍见 [README.md](https://github.com/hogancv/coordinate-agents/blob/main/README.md) 和 [README.zh-CN.md](https://github.com/hogancv/coordinate-agents/blob/main/README.zh-CN.md)。

<div id="contents" class="doc-anchor" aria-hidden="true"></div>

## 目录

- [官方身份](#canonical-identity)
- [架构与范围：宿主 Skill 与项目智能体](#architecture--scope-host-skill-vs-project-agent)
- [优先通过 Plugin 首次使用](#plugin-first-onboarding)
- [按目标宿主选择安装策略](#installation-strategy-by-target-host)
- [安全规则](#security-rules)
- [安装前检查](#preflight-checks)
- [安装两个智能体](#install-both-agents)
- [只安装 Codex](#install-codex-only)
- [只安装 Antigravity](#install-antigravity-only)
- [验证安装](#verify-installation)
- [在 Codex App 中使用](#use-in-codex-app)
- [配置可执行命令](#configure-executable-commands)
- [开始首个任务](#start-the-first-task)
- [更新](#upgrade)
- [卸载](#uninstall)
- [恢复备份](#restore-a-backup)
- [故障排查](#troubleshooting)

<a id="architecture--scope-host-skill-vs-project-agent--架构与范围-宿主技能与项目代理"></a>

<div id="architecture-scope-host-skill-vs-project-agent" class="doc-anchor" aria-hidden="true"></div>

## 架构与范围：宿主 Skill 与项目智能体 {#architecture--scope-host-skill-vs-project-agent}

`coordinate-agents` 提供两个不同层级：

1. **宿主 Skill 安装（用户环境）**：
   - 为 OpenAI Codex App/CLI 安装协调 Skill（Codex CLI 独立安装路径为 `~/.codex/skills/coordinate-agents`），和/或为 Google Antigravity CLI 安装到 `~/.gemini/skills/coordinate-agents`。
   - 这些第一方 App/CLI 宿主是交互式 AI 工作流的默认参考适配器。
2. **项目级智能体注册与协议运行时（Git 仓库）**：
   - 每个 Git 项目中都有持久、无服务器的 `.agent-bus` 协议引擎。
   - 可通过 `npx @hogancv/coordinate-agents@2.4.0 agent add <id> --adapter <adapter>` 向项目注册动态智能体和自定义工具。
   - Contract v1 适配器模块是受信任的本地代码，必须使用 `npx @hogancv/coordinate-agents@2.4.0 adapter register <local-file>` 显式注册；加载器从不扫描目录或导入 URL。
   - 适配器作者可从离线的[外部适配器编写指南（英文技术参考）](../adapter-author-guide.html)及其附带的最小示例入手。
   - `quickstart` 会将灵活的工作流角色（`planner`、`implementer`、`reviewer`）映射到已注册的智能体。

<a id="plugin-first-onboarding--插件优先的首次使用"></a>

## 优先通过 Plugin 首次使用 {#plugin-first-onboarding}

Codex Plugin 是可选结构化工作流的入口。它发现本地编码 CLI，配置 Implementer，并在现有 Agent Bus 之上提供持久化 Task API。专用 Skill 包括 `coordinate-agents`、`coordinate-setup`、`coordinate-task`、`coordinate-review` 和 `coordinate-recover`。npm CLI 仍作为 Runtime/回退和高级调试接口。

Plugin 首页提示按“发现 → 配置 → 尝试”的顺序排列。“尝试”提示对 Todo Web 应用使用普通 Task 工作流，不会创建特殊演示路径。正常的 Plugin 机器操作使用结构化 MCP 工具，并返回现有 JSON Runtime 契约。Task 调度会打开或复用持久化 Execution Session，并保存不具有所有权的 `sessionId`；它不会自动操作 Codex App Terminal 界面。

**Codex Plugin 用户无需运行 `npm install -g @hogancv/coordinate-agents`。**五个 Skill 都优先使用内置 Coordinate Agents MCP 服务器，绝不假定 PATH 中存在命令。只有 MCP 不可用，或用户明确要求调试时，才使用回退解析器。以下 shell 语法仅用于回退/调试/独立使用，不是正常的 Plugin 机器调用路径：

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" <command> ...
```

当前 Skill 提供绝对路径 `<skill-dir>`。解析器支持当前 Plugin 载荷、个人本地 marketplace 源、缓存的 Git marketplace 根目录、Node/npm 包回退，以及包含空格的 Windows 路径。npm CLI 仍是独立 Runtime、兼容和调试接口，并非 Plugin 的前置条件。不要在 MCP 和回退路径之间静默重试。

以下示例仅用于回退/调试：

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" setup --root "<repository>" --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task status --root "<repository>" --json
```

例如，用户选择原生 `agy` 后：

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" setup configure --agent antigravity --command agy --adapter antigravity-cli --root "<repository>" --json
```

发现完成后，Skill 必须使用一次高层 `setup configure` 事务。该事务写入机器命令、为项目 Agent 注册其 Adapter、分配 Implementer 工作流角色、检查 Adapter 兼容性和可执行文件、执行等价的 doctor 检查，之后才返回 `READY`。不得手动组合低层配置操作。

如果用户已显式注册受信任的本地 Contract v1 模块，同一发现响应会在新增的 `adapters` 快照中列出其标识和能力。Setup 可以选择该确切的 Adapter ID；发现阶段不会执行启动计划，已配置的外部 Agent 只会通过 Adapter 声明的检测操作进行检查。现有 MCP 工具名称和输入保持兼容，同时选中的 Agent、Adapter、可执行文件标识，以及“项目 > 用户 > Adapter 默认值”的优先级保持各自独立。

不要根据角色名称推断 Implementer 可用。请解析实际的本地可执行文件，并将用户配置保存在已安装 Skill 之外。

<a id="installation-strategy-by-target-host--按目标环境选择安装策略"></a>

## 按目标宿主选择安装策略 {#installation-strategy-by-target-host}

当 AI 助手被要求安装 `coordinate-agents` 时：

- **目标为 OpenAI Codex**：
  - **推荐（GitHub Plugin Marketplace）**：
    ```sh
    codex plugin marketplace add hogancv/coordinate-agents
    codex plugin add coordinate-agents@coordinate-agents
    ```
  - **回退（独立使用/不支持 Plugin 的环境）**：使用 `npx --yes @hogancv/coordinate-agents@2.4.0 install --codex`。
- **目标为 Google Antigravity**：
  - 使用 `npx --yes @hogancv/coordinate-agents@2.4.0 install --antigravity`。
- **通过 npm 为两个 CLI 宿主安装**：
  - 使用 `npx --yes @hogancv/coordinate-agents@2.4.0 install`。

<a id="canonical-identity--官方身份"></a>

## 官方身份 {#canonical-identity}

只接受以下身份：

| 字段 | 官方值 |
| --- | --- |
| GitHub owner | `hogancv` |
| GitHub 仓库 | `coordinate-agents` |
| 官方仓库 | `https://github.com/hogancv/coordinate-agents` |
| 官方 npm 包 | `@hogancv/coordinate-agents` |
| 所需 Node.js 版本 | 18 或更新版本 |

安装前查询 npm，确认 `name` 严格等于 `@hogancv/coordinate-agents`，`repository.url` 指向 `github.com/hogancv/coordinate-agents`，且所选 Legacy 版本严格为 `2.4.0`。不要在此检查中使用 Web 的 `dist-tags.latest`：

```sh
npm view @hogancv/coordinate-agents@2.4.0 name version repository.url --json
```

还应确认安装文档来自官方 GitHub 仓库，而非 fork。如果 owner、仓库、包名或元数据有任何不同，必须停止并报告不一致，不得安装。

<a id="security-rules--安全规则"></a>

## 安全规则 {#security-rules}

执行安装的 AI 必须遵守以下所有规则：

1. 只使用上方官方 GitHub 仓库和 npm 包。不使用第三方镜像、fork、重新打包的归档或未知安装脚本。
2. 绝不使用 `curl | sh`、`wget | sh` 或等价的下载脚本管道。
3. 绝不索取、打印、复制或存储令牌、Cookie、密码、恢复码、私钥或浏览器配置文件。原生 `codex` 和 `agy` 身份验证仍由各自 CLI 管理。
4. 运行 `npx` 前检查 npm 身份和稳定版本。在安装命令中固定已验证版本，不得静默替换为其他包。
5. 除非向用户报告确切路径和备份计划后，用户明确授权替换无法识别的目录或移除已修改的安装，否则不要使用 `--force`。正常更新可以备份并替换已识别、由包管理的副本。
6. 安装过程中不得修改产品源码、项目依赖、全局 Git 身份或现有 CLI 凭据。
7. 除非安装通过验证后，用户另行要求，否则不得运行 `quickstart`、启动任一智能体、创建 `.agent-bus` 或开始协作任务。
8. 安装后运行 `doctor`。非零退出、缺少前置条件、身份不一致或检查失败，均表示安装失败；绝不能报告成功。

<a id="preflight-checks--安装前检查"></a>

## 安装前检查 {#preflight-checks}

在不暴露凭据的情况下运行并记录以下检查：

```sh
node --version
npm --version
git --version
codex --version
agy --version
npm view @hogancv/coordinate-agents@2.4.0 name version repository.url --json
```

要求：

- `node --version` 必须报告 Node.js 18 或更新版本。
- `npm` 和 `git` 必须成功运行。
- 安装两个智能体时，`codex` 和 `agy` 都必须成功运行。仅安装单个智能体时，所选 CLI 是必需条件；仍需报告另一个 CLI 是存在还是缺失。
- 必须通过[官方身份](#canonical-identity)中的 npm 身份检查。

如果缺少前置条件，请在修改 Skill 目录前停止，报告确切的失败检查，并且只使用前置软件厂商的官方文档或平台可信的包管理器。不要临时拼凑下载 shell 脚本。身份验证可能需要用户完成 CLI 自身的浏览器流程；不要要求用户提供由此产生的凭据。

<a id="install-both-agents--安装两个代理"></a>

## 安装两个智能体 {#install-both-agents}

本指南的每条命令都使用已验证的 Legacy 版本 `2.4.0`：

```sh
npx --yes @hogancv/coordinate-agents@2.4.0 install
npx --yes @hogancv/coordinate-agents@2.4.0 doctor --lang zh-CN
```

对于这些结构化安装器，使用 `npm view @hogancv/coordinate-agents@2.4.0 name version repository.url --json` 验证固定的 Legacy 版本。`dist-tags.latest` 现已选择 Web，不要用它安装 Skill。第二条命令是必需的。

<a id="install-codex-only--只安装-codex"></a>

## 只安装 Codex {#install-codex-only}

```sh
npx --yes @hogancv/coordinate-agents@2.4.0 install --codex
npx --yes @hogancv/coordinate-agents@2.4.0 doctor --codex --lang zh-CN
```

这只安装 Codex Skill 副本，不会安装 Codex CLI 本身，也不会为其完成身份验证。

<a id="install-antigravity-only--只安装-antigravity"></a>

## 只安装 Antigravity {#install-antigravity-only}

```sh
npx --yes @hogancv/coordinate-agents@2.4.0 install --antigravity
npx --yes @hogancv/coordinate-agents@2.4.0 doctor --antigravity --lang zh-CN
```

这只安装 Antigravity Skill 副本，不会安装 `agy` 本身，也不会为其完成身份验证。

<a id="verify-installation--验证安装"></a>

## 验证安装 {#verify-installation}

所选 `doctor` 命令必须以状态 0 退出，并报告每项前置条件和所选 Skill 均健康。至少报告：

- 已验证的确切 npm 版本；
- 检测到的 Node.js、Git、`codex` 和 `agy` 版本；
- 安装了哪些智能体 Skill 副本；
- 解析后的安装目录；
- `doctor` 退出状态，以及尚存的警告。

默认写入位置为：

```text
~/.codex/skills/coordinate-agents
~/.gemini/skills/coordinate-agents
```

`CODEX_HOME`、`GEMINI_HOME`、`--codex-home` 和 `--antigravity-home` 可以改变这些根目录。安装器在目标旁写入暂存目录，然后重命名到目标位置。更新由包管理的副本时，之前的目录会保留为同级备份，其名称形如：

```text
coordinate-agents.backup-YYYY-MM-DDTHH-MM-SS-mmmZ
```

`npx` 还可能使用用户的 npm 缓存。单独安装不会写入 `.agent-bus`、修改当前产品仓库或启动智能体。安装后重启所选 CLI，或新建 Codex App 对话，使其重新发现 Skill。

<a id="use-in-codex-app--在-codex-app-中使用"></a>

## 在 Codex App 中使用 {#use-in-codex-app}

Codex Plugin 安装通过验证后，Codex App 可以直接使用本 Skill。对于使用 Codex App 的用户，这是推荐的交互方式：不需要手动打开两个 CLI 窗口，也不需要复制两条启动命令。

1. 在 Codex App 中添加或打开目标 Git 仓库。
2. 将对话的项目/工作区路径设为仓库根目录，即包含 `.git` 的目录。
3. 新建对话并调用 `$coordinate-agents`。
4. 让 Codex 在该项目中初始化或协调任务。

App 对话仍负责 Planner/Reviewer 侧。Runtime 会为配置的 Implementer CLI 打开或复用以项目/Agent 为作用域的持久化 PTY Execution Session，因此，即使用户不手动打开第二个 CLI 窗口，Implementer 命令仍必须已安装且正确。Session 独立于 Codex App Terminal 界面。Plugin Runtime 已随载荷提供；不要要求用户安装全局 npm CLI。请使用实际的可执行命令，例如 `agy` 或 `claude`，而非角色标签或只在另一台机器上存在的命令。对于高级 npm 兼容或调试，仍可使用旧有低层命令：

```sh
# 默认使用 Antigravity 作为 Implementer

npx --yes @hogancv/coordinate-agents@2.4.0 config set agent.antigravity.command agy

# 使用 Claude Code 作为自定义 Implementer
npx --yes @hogancv/coordinate-agents@2.4.0 agent add claude \
  --adapter generic-cli --command claude \
  --args '["--print", "{prompt}"]'
```

App 项目路径和 Implementer 命令是两项独立检查：路径错误会选错仓库，命令错误会导致 Implementer 无法启动。安装期间不得启动协作任务；只有用户另行要求在选定项目中工作后，才使用此流程。

对于其他 CLI，推荐通过 AI 辅助配置对话，先检查已安装的可执行文件及其真实帮助输出，再保存参数。例如，在当前 Codex App 对话中提出：

```text
使用 $coordinate-agents 将 Claude Code 配置为此项目的 Implementer。检查已安装的
`claude` 可执行文件和 `claude --help`，使用 `generic-cli` 注册，只选择当前安装版本
支持的提示和项目根目录参数，运行 `doctor` 并展示最终解析配置。在我确认之前不要启动协作任务。
```

`generic-cli` 支持 `{prompt}`、`{root}`、`{agent}` 和 `{lang}` 占位符。运行时也会将所选项目根目录设为子进程工作目录，因此不要假定存在厂商专用的 `--dir` 参数。只有检查所选 CLI 自身的帮助输出后，才保留 AI 生成的确切 `args`。

对于实现公开 Contract v1 的适配器，使用其 adapter ID 前必须先注册一个确切的本地模块。注册会在写入用户配置前验证 descriptor，不会修改项目 Bus：

```sh
npx --yes @hogancv/coordinate-agents@2.4.0 adapter register "<absolute-local-adapter.mjs>" --json
npx --yes @hogancv/coordinate-agents@2.4.0 adapter list --json
```

只接受路径中不包含符号链接/junction/硬链接的普通 `.mjs`、`.js` 或 `.cjs` 文件。模块以当前 Node.js 权限运行；这是信任边界，而非 JavaScript 沙箱。注册失败时，用户配置和项目 `.agent-bus` 均保持不变。

::: warning 权限版本边界
下文权限示例描述已发布的 npm 2.4.0。Web 3.0.2 和当前源码允许在 Workspace 设置中选择 Antigravity 提示模式或自动批准；适配器默认值为 `--dangerously-skip-permissions`，显式保存的参数会覆盖默认值。
:::

<a id="configure-executable-commands--配置可执行命令"></a>

## 配置可执行命令 {#configure-executable-commands}

机器相关的 CLI 命令应写入下面的用户级文件，而非已安装的 Skill 或 Plugin 目录：

```text
~/.coordinate-agents/config.json
```

例如，使用原生 Antigravity 并检查结果：

```sh
npx --yes @hogancv/coordinate-agents@2.4.0 config set agent.antigravity.command agy
npx --yes @hogancv/coordinate-agents@2.4.0 config get agent.antigravity.command
npx --yes @hogancv/coordinate-agents@2.4.0 config list
```

解析优先级为**项目级显式命令 > 用户级命令 > Adapter 默认值**。已配置的命令若缺失或未通过可执行文件检查，会使当前启动失败；绝不会静默替换为 `agy` 或其他默认值。`doctor` 报告最终命令。运行时检查可执行文件是否就绪，但不探测登录状态、提供方健康状况或模型可用性；这些错误会在启动后作为运行时失败处理。用户文件位于 `skills/`、`.codex-plugin/` 和 npm 包更新载荷之外，因此安装和更新会保留它。

权限和沙箱参数因厂商而异，必须显式配置。Legacy 单次执行的 `antigravity-cli` 启动会传入配置的 `args`，再追加 `--prompt-interactive <prompt>`。对于持久 Session，适配器会先以 `--prompt-interactive ""` 启动，让当前 `agy` 解析器收到必需的空初始提示值，再通过 PTY 写入第一条指令，除非配置的参数中显式包含 `{prompt}`。Adapter 不会自动添加 `--dangerously-skip-permissions` 或其他完全权限参数。如果本地 `agy` 自身配置已启用完全权限，该配置仍然生效。如果已安装的 `agy --help` 确认需要显式参数，且用户要求使用它，请写入用户文件：

```sh
npx --yes @hogancv/coordinate-agents@2.4.0 config set agent.antigravity.args '["--dangerously-skip-permissions"]'
npx --yes @hogancv/coordinate-agents@2.4.0 config list
```

`config list` 显示配置的用户参数；`doctor` 验证可执行文件/版本是否就绪，不验证提供方的实际权限状态。未检查对应 CLI 的帮助输出前，绝不要在 CLI 厂商或版本之间复制权限参数。

<a id="start-the-first-task--开始首个任务"></a>

## 开始首个任务 {#start-the-first-task}

只有验证成功，**且用户明确要求开始协作**后，才可从用户的 Git 仓库使用以下流程。Codex 仍负责 Planner/Reviewer；不得绕过已配置的 Implementer，也不得自动操作 Codex App Terminal 面板。持久 Session 的状态、输出、输入和关闭都是具有有界 I/O 的 Runtime 操作，并非 UI 自动化。

对于 Codex App，添加或打开仓库作为项目，将对话的项目/工作区路径设为包含 `.git` 的仓库根目录，新建对话并调用 `$coordinate-agents`。不要手动打开第二个 CLI 窗口。Runtime 会打开或复用配置的 Implementer Session，因此请验证命令是真实存在的本地命令，例如 `agy` 或 `claude`。

对于仅使用 CLI 的宿主，运行 `quickstart`：

```sh
npx --yes @hogancv/coordinate-agents@2.4.0 quickstart --root . --template feature --task "<USER_TASK>"
```

此操作会创建项目级 `.agent-bus/` 数据，并将 `.agent-bus/` 加入仓库本地的 `.git/info/exclude`。它会打印两条命令，但不会自行启动。Codex App 路径不需要手动运行这两条命令。除非用户要求这些操作，否则不要编造任务、运行打印的命令或修改产品代码。

<a id="upgrade--更新"></a>

## 更新 {#upgrade}

针对 Legacy `2.4.0` 重复官方身份检查，再运行其 update 和匹配的 doctor 命令。不要将 Skill 安装更新为仅提供 Web 的 npm latest：

```sh
# 两个智能体
npx --yes @hogancv/coordinate-agents@2.4.0 update
npx --yes @hogancv/coordinate-agents@2.4.0 doctor --lang zh-CN

# 也可在两条命令中都添加 --codex / --antigravity，只更新一个智能体。
```

更新器会先备份已识别、由包管理的副本（包括已修改的受管副本），然后替换。除非已明确授权 `--force`，否则拒绝替换无法识别的目录。

<a id="uninstall--卸载"></a>

## 卸载 {#uninstall}

只卸载由包管理的副本，然后验证所选目标已不存在：

```sh
# 两个智能体
npx --yes @hogancv/coordinate-agents@2.4.0 uninstall

# 只卸载一个智能体
npx --yes @hogancv/coordinate-agents@2.4.0 uninstall --codex
npx --yes @hogancv/coordinate-agents@2.4.0 uninstall --antigravity
```

除非用户明确授权 `--force`，否则命令拒绝删除无法识别或已修改的目录。卸载 Skill 不会移除 Node.js、Git、Codex CLI、Antigravity CLI、原生账户、npm 缓存数据、之前的同级备份、产品代码或项目级 `.agent-bus`。不要自动删除其中任何内容。

<a id="restore-a-backup--恢复备份"></a>

## 恢复备份 {#restore-a-backup}

1. 在相关 `skills` 目录下列出匹配 `coordinate-agents.backup-*` 的同级目录。
2. 向用户展示候选备份的确切路径、时间戳和当前目标状态。
3. 获得用户对所选备份的明确确认。
4. 如果当前目标由包管理，请正常卸载。绝不覆盖无法识别的目标。
5. 在同一卷上，将已确认的备份目录重命名为严格的 `coordinate-agents`。
6. 运行所选 `doctor` 命令。恢复的旧副本可能需要调用其 `.coordinate-agents.json` 元数据中记录的匹配包版本。

不要猜测该恢复哪份备份，也不要在未获得用户另行批准时删除未使用的备份。

<a id="troubleshooting--故障排查"></a>

## 故障排查 {#troubleshooting}

| 症状 | 必需响应 |
| --- | --- |
| 身份元数据不同 | 停止。报告不一致的字段；不得安装。 |
| Node.js 低于 18 | 停止，并从官方/厂商或可信平台来源更新 Node.js。 |
| 缺少 `codex` 或 `agy` | 报告问题并使用 CLI 厂商的官方安装文档；不要使用未知脚本。 |
| 需要浏览器登录 | 只请用户完成 CLI 原生浏览器流程，然后重新检查；绝不索取凭据。 |
| npm/网络错误 | 保留现有安装，报告命令和脱敏后的错误，仅在验证连接或 registry 身份后才重试。 |
| 无法识别的 Skill 目录 | 保留它。报告确切路径并提出备份/移动方案；不要自动添加 `--force`。 |
| `doctor` 非零退出 | 将安装视为失败，适用时运行打印的非破坏性修复，然后重新运行 `doctor`。 |
| 由包管理的更新失败 | 安装器会尝试恢复备份。验证目标和备份路径，再报告实际状态。 |
| 未发现 Skill | 确认解析后的主目录，重启 CLI，并重新运行所选 `doctor` 命令。 |

每次失败报告都应区分已完成与仅尝试的变更，脱敏秘密信息，并指出确切的剩余问题。绝不能仅凭文件存在就推断成功。
