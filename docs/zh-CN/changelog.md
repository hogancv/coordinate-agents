---
title: 更新日志
description: Coordinate Agents 已发布的 Web 包及保留的结构化工作流的版本历史。
---

<div id="changelog" class="doc-anchor" aria-hidden="true"></div>
<div id="302---2026-10-21" class="doc-anchor" aria-hidden="true"></div>
<div id="301---2026-10-13" class="doc-anchor" aria-hidden="true"></div>
<div id="300--web-first-npm-distribution" class="doc-anchor" aria-hidden="true"></div>
<div id="240--lightweight-web-workspace" class="doc-anchor" aria-hidden="true"></div>
<div id="230--multi-agent-task-graph-v1" class="doc-anchor" aria-hidden="true"></div>
<div id="220--adapter-sdk-contract-v1" class="doc-anchor" aria-hidden="true"></div>

# 更新日志

关于 v2.4 → v3 的产品方向变化及原始 v2.4.0 文档，请参阅 [v2.4 文档与迁移](./v2.4.html)。

## [3.0.2] - 2026-10-21

<div id="web-workspace" class="doc-anchor" aria-hidden="true"></div>

### Web 工作台

- 新增 Git Changes 及基于行的审查反馈、自定义终端、项目级桌面通知、协作时间线和协作健康提示。
- 简化任务标题栏，统一状态／操作控件，采用红色电源图标，并在关闭单个任务或当前项目全部任务终端前确认。将 Zen 退出控件移至右上角，并对齐侧边栏环境状态。
- 刷新时保留任务／项目列表元素，让终端输入、焦点和输出持续绑定到所选任务。

<div id="conversation-recovery" class="doc-anchor" aria-hidden="true"></div>

### 对话恢复

- 对受支持的本地 Codex CLI 0.163.x，使用进程级事件和精确的主 CLI 元数据，自动保留原始原生对话。不支持或无法捕获时，保留精确 UUID 回退方式。
- 重新打开原始 Codex 对话，不重放旧提示词或工作。恢复缺失的 Antigravity 执行者，同时保留有效的 Codex 运行实例、已记录轮次和时间线。
- 根据当前所管理的会话、运行时代次、终端初始化和身份冲突事实判断就绪；去掉恢复后的额外 UUID 确认步骤，同时保持旧记录可读。
- 对已绑定／已保留的默认任务拒绝重启全新终端对，阻止过期运行实例／轮次写入，并允许未更换的执行者在 Codex 恢复较慢时报告其已有轮次。

<div id="settings-documentation-and-compatibility" class="doc-anchor" aria-hidden="true"></div>

### 设置、文档与兼容性

- 在工作台设置中提供 Antigravity 工具权限模式。适配器默认仍通过 `--dangerously-skip-permissions` 自动批准；明确保存的参数数组（包括 `args: []`）会覆盖默认值。
- 对齐中英文恢复指南和操作表，按实施阶段标记历史设计及原生验收结果，并更新工作台截图。
- 更新关闭确认测试夹具，并在 Windows 恢复所有权测试中使用原生规范化路径。
- 保留 Web 优先的 npm 包内容、Node.js >=18 下限和现有 PTY／回退策略。独立版本管理的 Legacy Plugin 仍为 2.4.0。历史原生 CLI 验收不构成新的跨平台保证或持续身份验证保证。

## [3.0.1] - 2026-10-13

<div id="windows-terminals" class="doc-anchor" aria-hidden="true"></div>

### Windows 终端

- 恢复在 Windows 10、Node 22/24 上经过验证的原生 ConPTY 会话。在隔离的 Session Host 中检查原生启动和真实 TTY 行为；探测失败或超时且确认清理完成后，安全回退。
- 修复 Session Host RPC 错误、关闭响应竞态，以及过期元数据覆盖最终输出的问题。报告清理完成前确认所管理的 Host／CLI 已退出，并防止状态轮询终止使用了历史复用 PID 的其他进程。
- 新增后端和经过清理的平台诊断、明确的 native／stdio 模式、UTF-8 安全的输出尾部，以及有界启动清理。保留独立 Host 重连，并在合并待处理尺寸的同时重试失败的终端尺寸调整请求。

<div id="web-workspace-1" class="doc-anchor" aria-hidden="true"></div>

### Web 工作台

- 简化侧边栏，提供紧凑的项目／任务导航、项目切换、仓库详情和项目／任务搜索。
- 新增可拖动并持久保存的双终端分屏尺寸，以及各自聚焦 Codex／Antigravity 的能力；支持恢复分屏，并在重排布局时保留滚动历史。
- 新增浅色／深色主题切换，默认浅色，保存偏好并同步终端配色，无需重启 Session。
- 将工作台和任务控件合并到一个工具栏，把终端角色标签放在智能体名称旁，增加终端空间。
- 修复混用 OSC 结束符和持续终端标题更新时的交互启动检测，防止已经就绪的 Codex 终端在超时后被错误关闭。
- 代理转发时保留空的 Antigravity 交互提示词，并改善终端后端可见性及启动／生命周期反馈。

<div id="performance-and-safety" class="doc-anchor" aria-hidden="true"></div>

### 性能与安全

- 减少重复的事件日志路径解析和 UTF-8 字节计数，同时保留路径检查和有界读取。
- 优化工作台归档发现和跨任务引用，同时在删除前保留对确切文件所有权／活动状态的验证。
- 单任务视图只读取引用的 Session 记录，并拒绝载荷身份与文件身份不一致的情况。减少 GitHub 源码中不必要的 Inspector 摘要清理和图详情内存分配。

<div id="compatibility" class="doc-anchor" aria-hidden="true"></div>

### 兼容性

- 保留 Node.js >=18、node-pty 1.1.0，以及 Web 优先的 npm 包内容。Node 18 继续使用 stdio 回退；只有受支持且经过验证的运行时才会选择原生 PTY。回退模式不提供原生 TUI，也无法让子进程感知尺寸调整。
- 独立版本管理的 GitHub Legacy Plugin 仍为 2.4.0。本版本未增加 WebSocket 传输或自动多智能体编排。

<div id="_3-0-0-—-web-first-npm-distribution" class="doc-anchor" aria-hidden="true"></div>

## 3.0.0 — Web 优先的 npm 分发

- 新增工作台对话和整个项目目录的右键归档。归档会关闭所管理的终端、持久保存记录并隐藏它们；设置可跨项目清除已归档对话及所管理的 Session 记录，同时保留项目源码。已归档目录在重启后仍隐藏，明确重新添加可恢复其导航条目。
- npm 现在仅包含轻量 Web 工作台、HTTP API、xterm 资源、所需的共享 Session／PTY／工作台运行时和启动验证。Plugin 清单／Skill、MCP、Task Graph、Adapter SDK／一致性套件／示例、开发工具及大型演示资源保留在 GitHub 中，不进入 tarball。
- Web 命令不再导入 Legacy CLI、Inspector 数据模型、Task Graph 或 Agent Bus。默认 Web API 提供项目、工作台任务、所管理的会话和设置；结构化操作仍仅在源码中提供。
- 保留双终端、自定义命令及含空格的路径／参数、Codex 模型／推理设置、角色注入、任务绑定消息、持久化、尺寸调整、关闭／重启，以及独立 Session Host 重连。保留现有平台 PTY 回退和 Node >=18 下限。
- npm API 破坏性变更：只保留 web／help／version；移除通配符导出和 Adapter SDK 导出。旧 npm CLI 请使用 `npx @hogancv/coordinate-agents@2.4.0 <command>`，或在 GitHub 源码中使用 `node bin/coordinate-agents-legacy.mjs <command>`。Plugin 解析器会选择其完整内置 Legacy 入口；Plugin 版本独立保持 2.4.0。
- 将基于 Plugin 的 npm 产物门禁替换为隔离生产安装、导入／包内容检查、离线模拟双终端、角色／消息／任务隔离、项目／设置／重连／重启及清理检查。Plugin／MCP 测试仍独立。新增 Windows／macOS／Linux × Node 18／22／24 验收矩阵。
- 修复未指定终端读取限制时被当作一个字节／一行的问题，确保消息辅助脚本可通过符号链接／realpath 别名运行，并让 Session Host 在断开 IPC 前消费初始化内容（通过延迟导入和 Node 22 验证）。保留环回、Host／Origin、capability、有界输入及文件系统防护。
- `npm pack --ignore-scripts` 不需要生成式构建。经人工授权的 Trusted Publishing／OIDC 工作流会发布经过验证的确切 tarball。本次变更本身不执行发布。
- 精确大小／安装／启动测量及验证限制：[V3 发布证据（英文技术参考）](../releases/v3-web-first.html)。

<div id="_2-4-0-—-lightweight-web-workspace" class="doc-anchor" aria-hidden="true"></div>

## 2.4.0 — 轻量 Web 工作台

此版本发布双语双终端 Web 工作台及其低开销协作路径。结构化 Skill／CLI／MCP Task 和 Task Graph 工作流继续提供，沿用原有约定。

- 将 Web 工作台重建为双语双终端任务列表，使用全新的 Codex + Antigravity 终端对，并提供独立工作台记录、自定义启动命令、模型／推理设置、原始输入、尺寸调整和明确的终端对生命周期控件。
- 新增独立版本管理的 Web-lite 角色提示词和任务绑定终端消息，支持低开销协作；结构化 Skill／CLI／MCP Task 和 Graph 工作流仍沿用原有约定。
- 用交互式 PTY 替换 Web 聊天／Composer 和管理页面；保留只读 Inspector 及静态 Composer 兼容资源。
- 记录两种模式及其不同的完成／恢复保证。发布仍由明确的发布工作流控制。
- 默认测试命令串行运行 PTY／MCP／Graph 套件，避免发布门禁中的资源争用。
- 将 CLI 启动器测试与真实用户配置隔离，并修正用户配置测试夹具的可执行权限。
- 为带有 Intent Map 的 Task Graph 新增确定性的执行后 Scope Audit v1。持久证据覆盖已提交和未提交变更、重命名前后路径、有界偏移事实，以及在推导依赖任务资格前执行的 `observe`／`warn`／`strict` 策略行为。
- 新增明确且有界的 `graph-advance`，支持 1–32 个新规划的执行波次，具有确定性的停止原因，不会自动重试、恢复、集成、审查、修改依赖，也不授予发布权限。

<div id="_2-3-0-—-multi-agent-task-graph-v1" class="doc-anchor" aria-hidden="true"></div>

## 2.3.0 — 多智能体 Task Graph v1

这是 `v2.2.0` 之后的候选发布变更集。发布仍受仓库独立的 `RELEASE_APPROVED` 和 `PUBLISH` 门禁约束。

<div id="added" class="doc-anchor" aria-hidden="true"></div>

### 新增

- 以增量方式加入 Task Graph v1 验证，以及持久化图创建、状态和检查，同时保留现有单 Task 约定。
- 确定性的 READY 前沿规划，提供明确的依赖原因和有界 `maxConcurrency` 限制。
- 每个运行中的子任务各使用一个 Runtime 管理的 Git worktree 和 Session，精确解析可执行程序，不修改用户检出目录。
- 有界并行执行，持久保存各子任务的提交、证据、失败和依赖结果。
- 持久化中断检查，以及明确的恢复、停止和清理操作，不自动重试，也不进行破坏性恢复。
- 确定性的隔离集成和审查，提供结构化冲突事实、`REVIEW_APPROVED`／`CHANGES_REQUESTED`，不隐含合并或发布权限。
- 增量 CLI 和 MCP 图操作、稳定 JSON schema、保持协议纯净的 MCP stdio 行为，以及端到端验收覆盖。

<div id="changed" class="doc-anchor" aria-hidden="true"></div>

### 变更

- 扩展 Task、Session、安全、协议、MCP 和安装文档，涵盖感知依赖的本地编排。
- 本次联合发布将 npm 包和 Codex Plugin 同步至 `2.3.0`；各自版本字段仍可独立演进。
- 将 Plugin Security Scan 自动化限制为拉取请求和明确的手动运行；完整验收矩阵继续在推送到 `main` 和推送标签时运行。

<div id="verification" class="doc-anchor" aria-hidden="true"></div>

### 验证

候选版本应基于同一个精确源码提交，运行以下检查：

```sh
npm ci
npm run check
npm run demo
npm pack --dry-run
uv run --with pyyaml python "$HOME/.codex/skills/.system/skill-creator/scripts/quick_validate.py" skills/coordinate-agents
uv run --with pyyaml python "$HOME/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py" .
```

完整验收套件覆盖 Windows／macOS／Linux 和 Node.js 18／22。创建候选 tarball 后，运行 `npm run release:verify -- <artifact> --expected-version 2.3.0 --expected-source-commit <candidate-commit> --expected-tag v2.3.0`。验证器会记录确切的源码提交、标签、包／Plugin 身份、包内容完整性、离线外部 Adapter 示例，以及隔离的 Plugin／运行时发现和 doctor 路径。

带有人工门禁的 npm 工作流会在 OIDC trusted-publisher 步骤前，从确切的 `release_tag` 重复执行这套隔离验证。

## 2.2.0 — Adapter SDK Contract v1

这是 `v2.1.3` 之后的候选发布变更集。发布仍受仓库独立的 `RELEASE_APPROVED` 和 `PUBLISH` 门禁约束。

<div id="added-1" class="doc-anchor" aria-hidden="true"></div>

### 新增

- 在 `adapter-sdk.mjs` 提供公开的 Adapter SDK Contract v1，涵盖适配器身份、能力、检测、配置兼容性、启动计划、持久会话输入和启动策略。
- 公开的 Adapter Conformance Kit，提供有界诊断，以及适用于内置和外部适配器的确定性离线夹具。
- 明确的受信任本地注册，支持单个 `.mjs`、`.js` 或 `.cjs` 模块，包含规范化路径验证和事务回滚；不允许 URL 导入、下载、目录扫描或自动安装 npm 包。
- 对一份增量外部适配器注册表快照提供 Setup 和 MCP 集成，涵盖发现、配置、Task 派发和持久 Session 复用。
- 在 `examples/minimal-external-adapter/` 提供最小外部 Adapter 示例，包括离线一致性验证路径。

<div id="changed-1" class="doc-anchor" aria-hidden="true"></div>

### 变更

- 将内置 Codex CLI、Antigravity CLI 和通用 CLI 适配器迁移到经过验证的 Contract v1 描述符，同时保留精确可执行程序身份及项目 > 用户 > 适配器默认值的优先级。
- 加固 Windows／macOS／Linux 和 Node.js 18／22 验收路径，包括可移植的 Session 和 Inspector 路径、Node 18 PTY 回退行为、适合扫描器检查的示例夹具，以及非递归包检查。
- 本次联合发布将 npm 包和 Codex Plugin 同步至 `2.2.0`；两个版本字段仍可在未来发布中独立演进。

<div id="verification-1" class="doc-anchor" aria-hidden="true"></div>

### 验证

候选版本应基于同一个精确源码提交，运行以下检查：

```sh
npm ci
npm run check
npm run demo
npm pack --dry-run
uv run --with pyyaml python "$HOME/.codex/skills/.system/skill-creator/scripts/quick_validate.py" skills/coordinate-agents
uv run --with pyyaml python "$HOME/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py" .
```

创建候选 tarball 后，运行 `npm run release:verify -- <artifact> --expected-version 2.2.0 --expected-source-commit <candidate-commit> --expected-tag v2.2.0`。验证器会记录确切的源码提交、标签、包／Plugin 身份、包内容完整性、离线外部示例，以及隔离的 Plugin／运行时发现和 doctor 路径。

带有人工门禁的 npm 工作流会在 OIDC trusted-publisher 步骤前，从确切的 `release_tag` 重复执行这套隔离验证。
