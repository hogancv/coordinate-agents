---
title: 故障排查
description: 排查 Web Workspace 版本、启动、终端设置、协作回执、通知，以及可选的 Legacy Plugin 或 Agent Bus 故障。
---

<div id="troubleshooting" class="doc-anchor" aria-hidden="true"></div>
<div id="structured-plugin--legacy-troubleshooting" class="doc-anchor" aria-hidden="true"></div>

# 故障排查

有关之前的产品方向，请参阅 [v2.4 原始文档与迁移](./v2.4.html)。

<div id="a-documented-feature-is-missing-or-a-command-is-unavailable" class="doc-anchor" aria-hidden="true"></div>

## 文档中的功能缺失，或命令不可用

检查已安装版本。Web 3.0.2 包含 Git Changes/审查、Custom Terminals、通知、Timeline、Health 和原生 Codex 恢复；较早的包可能缺少这些新增功能。请验证 npm dist-tags，不要假定已安装版本或 `latest` 与当前源码一致。

```sh
npx @hogancv/coordinate-agents@latest --version
# 在源码检出目录中运行 npm ci 后：
node bin/coordinate-agents.mjs web --root "/path/to/project" --port 3000
```

npm 3.x 仅提供 Web/help/version。`doctor`、`install`、`config`、`task`、`quickstart` 和 `inspector` 需要 GitHub Plugin、源码 Legacy 入口或 npm 2.4.0。不要通过安装 npm latest 来修复缺失的 Plugin runtime。

<div id="the-server-cannot-start-or-the-port-is-busy" class="doc-anchor" aria-hidden="true"></div>

## 服务器无法启动，或端口被占用

检查 Node.js >=18、Git、普通且非符号链接的项目目录，以及依赖安装情况（源码需运行 `npm ci`）。使用 `--port 0` 选择空闲端口，避免终止无关进程。检查打印的错误和选中的 `--root`；在非 Git 启动目录中，会初始化 Git 和 Workspace 存储。

<div id="an-agent-command-is-missing-or-cannot-log-in" class="doc-anchor" aria-hidden="true"></div>

## 智能体命令缺失或无法登录

在用于启动 Web 的环境中运行 `codex --version` 和 `agy --version`，或配置的两个 Custom 命令。Settings 接受可执行文件名或绝对路径，不接受内联参数或 shell 语法。修正所选项目的设置，并显式创建/重启任务；正在运行的 CLI 不会被原地重新配置。Custom 重启会保留该任务的命令快照。

可执行文件检测不验证登录、提供方访问权限、模型健康状况或配额。直接打开该 CLI，修复其自身的身份验证/配置；不要在智能体之间复制凭据。如果源码中的 Node 无法加载原生依赖，请针对当前 Node 版本重新运行 `npm ci`。

<div id="terminal-display-or-resize-is-limited" class="doc-anchor" aria-hidden="true"></div>

## 终端显示或尺寸调整受限

检查 Session 诊断中的 `backend`。原生 PTY 是否可用取决于平台和 Node 版本。Node 18 保留 owned-stdio 回退；它不是真正的终端，无法提供原生 TUI，也无法让子进程感知尺寸变化。在 Windows Node >=20 上，一次性的分离式 Session Host 会先探测真实 TTY 行为，再选择原生后端。回退需要确认所属进程已清理。实际的 Session 故障不会自动重试任务。修复原因后使用显式重启，不要盲目重发实现指令。

<div id="a-task-is-quiet-or-the-timeline-has-no-done" class="doc-anchor" aria-hidden="true"></div>

## 任务没有动静，或时间线中没有 DONE

展开时间线，检查正式回执及其关联的 Session 事实。`SENT` 表示输入已分发；普通输出或空闲并不代表完成。Health 的静默提示表示缺少可观察的进展，并非已证明失败。待处理的 `wait` 应使用返回的 cursor/revision 继续，而不是重复 `send`。未记录事件的旧版本历史无法补录。Custom 任务没有默认协作轮次或报告。

<div id="review-feedback-or-a-custom-prompt-cannot-be-sent" class="doc-anchor" aria-hidden="true"></div>

## 无法发送审查反馈或 Custom 提示

对于 Default 审查反馈，请确保 Codex 处于空白输入提示处，并为每次发送确认就绪状态。在预检期间切换文件、刷新 diff 或关闭 Changes 抽屉，会取消待发送的反馈。Custom 任务可查看和复制 diff，但不支持 Send to Codex。

对于 Custom 提示，请检查 CLI 是否支持多行 bracketed paste，然后在预览中确认就绪状态。关闭预览会取消待发送内容；不确定是否送达或已经分发的输入不会自动重试。无法确认就绪时，请手动复制粘贴。

<div id="a-desktop-notification-is-missing" class="doc-anchor" aria-hidden="true"></div>

## 没有收到桌面通知

在 Windows 10/11 或 macOS 上使用当前源码；不支持 Linux。启用并保存所选项目的通知偏好。检查选中的事件：默认选择 APPROVED 和 FAILED，DONE 为可选。使用 Send test notification，然后检查操作系统权限及专注模式/勿扰模式。操作系统命令被接受，并不能证明通知已显示在屏幕上。

只有已持久化的正式 Default 回执会触发通知。请保持后端、智能体进程和交互式操作系统会话运行。可以关闭浏览器；Custom 输出、Session 退出、归档和空闲均不是通知事件。至多一次分发意味着失败或被中断的尝试不会重试。修改摘要不会重新发送；新一轮可以再次通知。

<div id="a-closed-browser-left-agents-running-or-a-project-disappeared" class="doc-anchor" aria-hidden="true"></div>

## 关闭浏览器后智能体仍在运行，或项目消失了

独立的 Session Host 可以在浏览器和 Web 服务器退出后继续运行。重新打开 Web，并使用明确的终端关闭控件。归档会关闭关联终端并隐藏记录，同时保留源文件。已归档项目会一直隐藏，直到你显式重新添加同一个文件夹。清除已归档对话是永久操作，会删除其时间线历史。

<div id="structured-plugin-legacy-troubleshooting" class="doc-anchor" aria-hidden="true"></div>

## 结构化 Plugin / Legacy 故障排查

以下章节适用于可选的 GitHub Plugin 和 Legacy runtime，不适用于 npm 3.x Web。请从源码使用 `node bin/coordinate-agents-legacy.mjs`，或将 npm 版本固定为 **2.4.0**。参阅[结构化工作流](./structured-workflow.html)和 [Legacy 安装（英文技术参考）](../legacy-ai-install.html)。

<div id="plugin-first-diagnosis-and-structured-errors" class="doc-anchor" aria-hidden="true"></div>

## 优先通过 Plugin 诊断与结构化错误

请从面向 Plugin 的 Task 和 setup 接口入手，不要先手动检查队列文件：

Plugin 路径不需要全局 npm CLI。每个 Skill 都通过以下入口调用活动载荷：

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" <command> ...
```

如果此解析器报告 `PLUGIN_RUNTIME_NOT_FOUND`，请验证 Plugin 已在当前 Codex 安装中启用，并新建对话；不要据此推断必须将 `coordinate-agents` 加入 `PATH`。解析器接受缓存的 Git marketplace 安装、个人本地 marketplace 根目录，以及包含空格的 Windows 路径。下方 npm 命令示例是独立使用/调试时的回退方式。

```sh
npx @hogancv/coordinate-agents@2.4.0 setup --json
npx @hogancv/coordinate-agents@2.4.0 task status --json
npx @hogancv/coordinate-agents@2.4.0 status --json
npx @hogancv/coordinate-agents@2.4.0 agent doctor --json
```

JSON 契约将运行时事实与 Skill 解释分开。常见错误码包括 `EXECUTABLE_NOT_FOUND`、`EXECUTABLE_NOT_RUNNABLE`、`SPAWN_FAILED`、`AGENT_EXIT_NONZERO`、`AGENT_TIMEOUT`、`AUTH_REQUIRED`、`TASK_NOT_FOUND`、`TASK_STATE_CONFLICT` 和 `STALE_CLAIM`。只有编码 CLI 明确报告登录/身份验证失败时，才会归类为身份验证问题。非零退出或超时会停止当前激活；它们不是自动重试信号。修复报告的可执行文件或运行时问题后，只有在用户明确要求继续时，才使用 `task resume`。

`task dispatch` 是唯一会发送 `IMPLEMENT` 并启动 Implementer 的面向 Plugin 操作。它解析工作流 Agent 和最终命令，检查 Adapter 和可执行文件，并在命令不可用时于传输前拒绝执行。因此，命令缺失会产生带有 `EXECUTABLE_NOT_FOUND` 的 Task `ERROR`，不会有排队的 `IMPLEMENT`，也不会有子进程。用户修复命令后，必须先执行 `task resume`，才能再次 dispatch。

::: tip 本指南范围
本指南涵盖宿主 Skill 安装、默认 Codex 和 Antigravity 参考适配器、`.agent-bus` 恢复，以及通过 `agent doctor` 动态注册智能体的常见问题。
:::

首先使用与安装时相同的包版本和目标：

```sh
npx --yes @hogancv/coordinate-agents@2.4.0 doctor --codex
npx --yes @hogancv/coordinate-agents@2.4.0 doctor --antigravity
```

保留脱敏后的输出和退出状态。不要粘贴凭据，也不要强制执行破坏性修复。

<div id="skill-not-discovered" class="doc-anchor" aria-hidden="true"></div>

## 未发现 Skill

**观察到的行为：**提及协作时未触发 `$coordinate-agents`，或 CLI 提示 Skill 不可用。

1. 运行选定目标的 `doctor`，记下确切的 Skill 路径。
2. 确认终端使用的是安装时相同的 `CODEX_HOME` 或 Antigravity 主目录。
3. 重启 CLI，使其重新加载 Skill 元数据。
4. 显式调用一次 `$coordinate-agents`，以区分发现问题和安装失败。

如果 `doctor` 报告副本缺失或无效，只重新安装选中的目标。不要复制另一个 CLI 的凭据目录。

<div id="codex-app-selects-the-wrong-project-or-cannot-start-the-implementer" class="doc-anchor" aria-hidden="true"></div>

## Codex App 选错项目，或无法启动 Implementer

在 Codex App 中添加或打开目标 Git 仓库，并将对话的项目/工作区路径设为仓库根目录，即包含 `.git` 的目录。新建对话并调用 `$coordinate-agents`。App 路径不需要手动打开两个 CLI 窗口，但 Runtime 仍会在本地为 Implementer 打开以项目为作用域的持久 Session。请配置实际的可执行命令，而非角色标签：

```sh
# Antigravity
npx @hogancv/coordinate-agents@2.4.0 config set agent.antigravity.command agy

# 将 Claude Code 注册为自定义智能体
npx @hogancv/coordinate-agents@2.4.0 agent add claude --adapter generic-cli --command claude \
  --args '["--print", "{prompt}"]'
```

使用 `git rev-parse --show-toplevel` 比较仓库根目录与 App 项目路径。使用 `doctor` 检查最终解析出的命令和可执行文件状态。项目路径错误与可执行命令错误相互独立，必要时需同时修复。复制所选 CLI 的提示或目录参数前，请先验证其自身的 `--help` 输出；运行时已将项目根目录用作子进程工作目录。也可以在当前 Codex App 对话中提出：

```text
使用 $coordinate-agents 将 Claude Code 配置为此项目的 Implementer。检查已安装的
`claude` 可执行文件和 `claude --help`，使用 `generic-cli` 注册它，运行 `doctor`，
并向我展示解析后的配置。在我确认之前不要启动。
```

Workspace 设置支持 Antigravity 提示模式或自动批准。适配器默认值为 `--dangerously-skip-permissions`；显式保存的参数数组优先。已发布的 npm 2.4.0 runtime 需要下文所述的显式权限配置。Legacy 单次执行路径会传入配置的 `args`，再添加 `--prompt-interactive <prompt>`；持久 Session 会针对当前 `agy` 解析器，以 `--prompt-interactive=` 启动，然后通过 PTY 写入第一条指令，除非显式配置了 `{prompt}`。如果 `agy --help` 确认支持 `--dangerously-skip-permissions`，且用户明确要求使用它，请在 Workspace 设置中配置该参数，或使用 `config set` 设置 `agent.antigravity.args`；`config list` 显示已保存的用户参数，而 `doctor` 只检查可执行文件/版本。

如果 Windows PowerShell 代理报告 `flag needs an argument: -prompt-interactive`，包装程序可能丢弃了独立的空参数。持久 Antigravity Session 使用单个参数 `--prompt-interactive=`，使空值能够经过该转发步骤而保留。更新源码后重启 Web 服务器，然后显式重启失败的任务对；无需自动重试。

<div id="node-version-too-low" class="doc-anchor" aria-hidden="true"></div>

## Node 版本过低

```text
Node.js 18+: missing or requires attention
```

运行 `node --version`。从官方来源安装受支持的 Node.js LTS，打开新终端，并检查 PATH 是否解析到新的可执行文件。此包不会宣称支持低于 Node 18 的版本。

<div id="codex-or-agy-is-not-found" class="doc-anchor" aria-hidden="true"></div>

## 找不到 `codex` 或 `agy`

```text
Codex CLI: missing or requires attention
Antigravity CLI (agy): missing or requires attention
```

在 Windows 上运行 `where codex` / `where agy`，在 POSIX 上运行 `command -v codex` / `command -v agy`。从官方来源安装缺失的原生 CLI，完成身份验证，并确认其原生模型能响应，再重新运行 `doctor`。选定目标的 CLI 缺失时，该目标检查会失败；未选中的 CLI 仅提供信息。对于原生 Antigravity，直接配置 `agy`；其全局代理设置无需项目专用包装程序即可生效：

```sh
npx @hogancv/coordinate-agents@2.4.0 config set agent.antigravity.command agy
npx @hogancv/coordinate-agents@2.4.0 doctor
```

`.agent-bus/config.json` 中的项目级命令优先于此用户设置。

<div id="implementer-stops-with-error" class="doc-anchor" aria-hidden="true"></div>

## Implementer 以 `ERROR` 停止

`launch` 会在启动 Implementer 前执行可执行文件检查。命令缺失、不安全的 Windows 入口、启动失败、子进程非零退出，或对话/运行时失败，都会导致当前激活终止。检查报告的 Agent、Adapter、配置命令、错误码，以及 `.agent-bus/logs/*-ERROR.json` 产物。不要持续轮询或自动重发 `IMPLEMENT`；修复命令/运行时，准备好后再显式启动。Coordinate Agents 不会进行登录状态或提供方健康状况预检。

<div id="unknown-installation-directory" class="doc-anchor" aria-hidden="true"></div>

## 未知安装目录

```text
Codex: installation invalid (unrecognized installation), path: ...
Manual action required; inspect or back up the existing directory before using: ... install ...
```

目标可能是源码检出目录、手动安装的 Skill，或用户数据。安装器拒绝覆盖，因为伪造的元数据文件不能证明所有权。请检查并备份该目录。只有在用户明确接受替换或删除该确切路径后，才使用 `--force`。

<div id="doctor-fails-after-installation" class="doc-anchor" aria-hidden="true"></div>

## 安装后 `doctor` 失败

```text
One or more dependencies or installations require attention.
```

摘要上方的行会指出失败组件。检查命令退出状态，验证建议的修复与实际平台和包管理器匹配，每次只执行一项修复，然后重新运行完全相同的 `doctor` 命令。Linux 修复命令只是供审阅的建议，并不保证发行版仓库提供 Node 18+。

<div id="message-remains-in-processing" class="doc-anchor" aria-hidden="true"></div>

## 消息一直处于 `processing`

先确认工作进程已退出；恢复仍在执行的工作可能导致重复实现。

```sh
node <skill>/scripts/agent-bus.mjs status --root <repo>
node <skill>/scripts/agent-bus.mjs recover --agent antigravity \
  --stale-after-seconds 14400 --root <repo>
```

`recover` 只会根据请求的阈值和当前租约状态，将过期领取移回 `new`。重新运行 `status`，然后只允许一个 worker 调用 `wait`。worker 仍存活时，绝不要手动在队列文件夹间复制消息。

<div id="agent-bus-is-damaged-or-unsafe" class="doc-anchor" aria-hidden="true"></div>

## `.agent-bus` 损坏或不安全

可能的错误包括格式错误的消息被隔离、状态记录无效，或不安全路径被拒绝。停止两个智能体。保留该目录以便诊断，检查 `quarantine/` 和 `status`，并验证 `.agent-bus` 是 Git 根目录内的普通目录，而非符号链接、junction、硬链接叶节点或越界路径。只对完整的过期领取使用 `recover`。只有在保存所需规格、审查和证据，并获得明确确认后，才使用 `clean`。

除非能够证明没有进程持有领取，否则不要手动修复 YAML frontmatter 或移动队列文件；手动编辑会破坏证据沿袭关系。

<div id="windows-path-normalization" class="doc-anchor" aria-hidden="true"></div>

## Windows 路径规范化

症状包括两个智能体报告不同的根目录，复制粘贴的命令因空格或 `&` 而失效，或提示被创建在意外的检出目录中。始终从实际的 Git worktree 根目录运行 `quickstart`，原样复制生成的 `launch` 命令。这些命令使用 `--root-base64` 编码根路径，而非嵌入不安全的 shell 字符串。比较以下结果：

```powershell
git rev-parse --show-toplevel
npx --yes @hogancv/coordinate-agents@2.4.0 doctor
```

除非两个 CLI 都在 WSL 中执行，否则不要手动将 `C:\project` 转换为 `/mnt/c/project`。即使 Windows 和 WSL 路径指向相同文件，它们仍属于不同的进程环境。

<div id="npm-registry-metadata-is-inconsistent" class="doc-anchor" aria-hidden="true"></div>

## npm registry 元数据不一致

```text
npm ERR! code ETARGET
npm ERR! notarget No matching version found for @hogancv/coordinate-agents@<version>
```

在不更改凭据的情况下比较公共元数据：

```sh
npm view @hogancv/coordinate-agents dist-tags.latest version repository.url --json
npm config get registry
```

仓库必须是 `https://github.com/hogancv/coordinate-agents`，registry 应为预期的公共 npm registry。过期镜像可能落后于发布。不要悄悄降级、切换到不受信任的 registry，或将 GitHub 检出目录作为安装器运行。等待元数据一致，或使用已经验证稳定的确切版本。

参阅正式的双语 [AI 安装指南](./install-with-ai.html)和[安全边界](./security.html)。
