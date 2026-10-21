---
title: Windows 原生 ConPTY 验收
description: 历史开发记录，适用范围以原文注明的实现阶段为准。
search: false
---

::: info 历史工程记录
本页保留当时的设计、计划或验收依据，适用范围以原文实现阶段为准。旧版本行为、计划中的能力与旧部署方式不能替代[当前使用指南](/zh-CN/inspector.html)和[版本记录](/zh-CN/changelog.html)。
:::

::: warning 历史开发记录
本页保留原始中文技术记录。计划中的版本和能力不代表已发布的 npm 功能；请先查阅[当前版本说明](/zh-CN/changelog.html)。
:::

<div id="windows-native-conpty-diagnostics" class="doc-anchor" aria-hidden="true"></div>
<div id="1-本机环境" class="doc-anchor" aria-hidden="true"></div>
<div id="2-根因与证据边界" class="doc-anchor" aria-hidden="true"></div>
<div id="3-独立最小复现" class="doc-anchor" aria-hidden="true"></div>
<div id="4-最小生产修补" class="doc-anchor" aria-hidden="true"></div>
<div id="5-native-backend-实测矩阵" class="doc-anchor" aria-hidden="true"></div>
<div id="6-输入输出与浏览器实测" class="doc-anchor" aria-hidden="true"></div>
<div id="7-resize-证据" class="doc-anchor" aria-hidden="true"></div>
<div id="8-关闭与清理" class="doc-anchor" aria-hidden="true"></div>
<div id="9-自动化与回归" class="doc-anchor" aria-hidden="true"></div>
<div id="10-未解决事项及发布边界" class="doc-anchor" aria-hidden="true"></div>

# Windows 原生 ConPTY 本地开发与验证报告

日期：2026-10-12。分支：`dev/windows-native-conpty`。基线：`origin/main` 的 `0b924f8`。
本次为未发布的源码开发；npm 版本仍为 **3.0.0**，node-pty 仍为 **1.1.0**。

## 结论

- **已完成、真实 Windows 验证通过：**本机 Node 22/24 的 native binding、真实 ConPTY、模拟交互 CLI、输入输出、原生 resize、正常退出尾部输出、Session Host 生命周期、关闭清理与安全 fallback。
- **已实现、其他平台仍需验证：**Host RPC/metadata/关闭竞态修补。此次未运行远端 CI，也没有声称 macOS/Linux 或其他 Windows build 已通过。
- **尚未完成：**登录后的真实 Codex/Antigravity TUI 验收；嵌入浏览器 Ctrl+C 快捷键直接触发；默认长路径 PowerShell/PSReadLine resize 边界问题；首次故障实验残留目录的清理确认。

原生自动化测试在 Windows Node 22/24 **各 7 项通过、0 失败、0 跳过**。它们明确断言 `backend=node-pty` 和真实 TTY；fallback 不会被当成原生通过。

## 1. 本机环境

| 项目 | 实测值 |
| --- | --- |
| Windows | Windows 10，`10.0.19045`，x64 |
| PowerShell | `7.6.5`；系统 Windows PowerShell `5.1.19041.6456` |
| 默认 Node | `22.23.0`，ABI `127`，`C:\nvm4w\nodejs\node.exe` |
| 另一 Node | `24.19.0`，ABI `137`，Codex bundled runtime 中的独立 node.exe |
| npm / Git | `10.9.8` / `2.53.0.windows.1` |
| node-pty | `1.1.0`，binding 从 `prebuilds/win32-x64` 加载 |
| 本地 CLI 版本 | `codex-cli 0.160.0`；`agy 1.3.3`；仅执行 `--version` |

开始时工作区干净，HEAD 与最新获取的 `origin/main` 相同。开发分支此前不存在，未覆盖既有工作。
依赖已安装且与 lockfile 一致，因此未重装依赖、未安装 Build Tools、未修改全局 Node 或系统组件。

## 2. 根因与证据边界

Git 历史 `500c752` 加入 Windows Node >=22 禁用条件，说明是为了规避 detached Host 故障；这条说明本身不能证明当时 CI 的精确崩溃根因。

本次独立实测没有复现 ABI 加载失败或 ConPTY 初始化失败。两版 Node 使用实际安装的同一 node-pty binding 都能运行真实 TTY。
本机实际复现并定位了以下生命周期问题：

1. **异步 RPC EPIPE：**客户端超时/断开后，Host 的 `socket.write()` 通过异步 `error` 事件报告 `EPIPE`。原有同步 try/catch 捕获不到，Host 因未处理事件退出。安装 tarball 的 Web 验收首先暴露了该问题。
2. **过早 shutdown：**native `onExit` 后的 25ms shutdown 可能先于 `close()` 等待 taskkill helper/回复刷新的完成，导致客户端关闭超时。external/trusted adapter 回归可复现，修补后通过。
3. **旧 metadata 覆盖：**Manager 写回较早 RPC 的 record，可能覆盖 Host 保存的最后输出。退出尾部输出测试暴露了此竞态。
4. **上游资源行为：**node-pty 1.1.0 的 conout worker 不保证在 CLI 自然退出后让 Node 事件循环自然结束。强杀路径还观察到其额外 helper 报 `AttachConsole failed`。Host 必须在输出/退出事实完成后显式结束；不能将宿主提前退出等同于清理完成。

没有声称上述 JS/生命周期修补消除了 node-pty 所有 C++ 原生崩溃。

## 3. 独立最小复现

```powershell
node test/support/native-pty-probe.mjs native
node test/support/native-pty-probe.mjs runtime
node test/support/native-pty-probe.mjs powershell
npm run test:native-pty
```

探针的 supervisor 不加载原生 binding；操作在独立 detached 子进程中执行，有超时、退出码、stdout/stderr 脱敏、精确测试 PID 清理和目录删除检查。
若发生兜底清理、泄漏或目录删除失败，不会制造 passing。`native` 与 `fallback` 是不同检查。
支持文件在 `node --test` 自动发现时保持 inert，不会启动工作台或读写真实用户配置。

修复前 `runtime` 探针准确失败于 `stdio-fallback != node-pty`；修复后通过。
另有预检 `process.abort()`、预检挂起、客户端丢弃关闭回复、非零 CLI 退出的负控。

机器证据：[windows-native-conpty-evidence.json](/diagnostics/windows-native-conpty-evidence.json)，包含两版 Node 的实测结果与相关源码 SHA-256。

## 4. 最小生产修补

| 文件 | 修补 |
| --- | --- |
| `pty-runtime.mjs` | Windows 原生选择依赖独立 Host 已验证的能力，不按 Node >=22 一概禁用；保留 spawn 异常 fallback；逻辑提交 LF→CR，raw 字节不改；先终止自有 CLI 树，再等待退出输出 |
| `session-host.mjs` | 一次性真实 TTY 预检；RPC socket error 隔离；关闭回复计数及有界释放；Host 单写 runtime metadata；持久化 backend |
| `session-manager.mjs` | 每个 Manager 缓存一次隔离预检；失败/超时先限时清理并确认；未确认清理则拒绝启动；停止旧 runtime record 写回；复用关联经 Host 更新；关闭必须确认 Host/CLI 退出 |

没有重写 Session 系统、没有引入新依赖，也没有改 WebSocket 或 Agent 协议。
测试、对应中英文 README、Session reference 和现有 Windows CI 专项入口同步更新。

## 5. Native backend 实测矩阵

| 方案 | Node 22.23.0 | Node 24.19.0 | TUI/ANSI | 子进程 resize | 关闭清理 |
| --- | --- | --- | --- | --- | --- |
| node-pty 1.1.0 + 本次 Host 修补 | 真实 `node-pty` | 真实 `node-pty` | 模拟 CLI 验证 | 验证 | 验证 |
| 系统 PowerShell，隔离 HOME/APPDATA、短提示符 | 通过 | 通过 | 系统交互终端 | `73×19` | 通过 |
| stdio-fallback 负控 | 单独通过 | 单独通过 | 非 TTY，不算原生 | 不提供原生 resize | 验证 |

不需要更换 node-pty 版本，package-lock.json 无改动。

## 6. 输入输出与浏览器实测

模拟 CLI 验证英文/中文、Enter、Backspace、四方向键、Ctrl+C、多行和粘贴、实时增量、ANSI 颜色/清屏/光标定位、长输出、4KiB 有界 buffer、退出前 `FINAL-OUTPUT-中文`。

使用源码的 `startWorkspace()`，独立临时 Git 项目、临时用户 Home 和模拟 Codex/Antigravity CLI，实际打开 localhost 页面并创建双终端：

- 两个 Session 的持久化 backend 均为 `node-pty`，CLI 报真实 stdin/stdout TTY。
- 页面输入中文、Enter 和方向键得到子进程事实；红色输出和 TUI 清屏重绘可见。
- 刷新重连保留 Session ID；显式 Restart 生成新 ID、关闭旧进程。
- 项目 B 无任务时没有错误显示项目 A 的终端；切回 A 重连其正确 Session。
- 关闭 Codex 后页面显示其终态，Antigravity 仍 idle；再从页面关闭整个任务。
- Ctrl+C 字节通过页面粘贴路径被两个子进程记录。嵌入浏览器的 Ctrl+C 快捷键尝试未观察到字节，不把它算成快捷键通过。

真实 Codex/Antigravity 只查版本，不执行模型任务、登录、授权或消耗模型额度。

![真实双终端 ANSI 重绘](/diagnostics/windows-conpty-web.png)

## 7. Resize 证据

独立探针从 `100×30` 改为 `73×19`；子进程查询自己的 console handle 后报告实际尺寸。
Windows Node 的 stdout 尺寸缓存不依赖 Unix SIGWINCH，因此探针主动刷新子进程自己的句柄尺寸，而非断言父进程 JS 字段。
系统 PowerShell 也报告 `[Console]::WindowWidth/WindowHeight = 73,19`。

Session 测试将第一端改为 `71×18`，另一端仍为 `120×30`。
浏览器 Zen/普通布局切换由子进程记录 `66×6 → 70×20 → 66×6`，不是仅修改前端尺寸。

## 8. 关闭与清理

原生测试检查自有 CLI、Host 的退出、失败 Session 不复用、关闭一端不终止另一端、final output，以及中文/空格测试目录删除。
所有成功的 supervisor 用例均报告 `leaked=false`、`directoryRemoved=true`。
Web 的两个工作台测试目录已删除；当前测试双终端的两个 CLI PID 和两个 Host PID 均已单独确认不存在。只操作本次明确创建的进程。

**保留的异常现场：**最初 `early-exit` 故障实验曾报告 `EBUSY`，以下临时目录仍存在：
`C:\Users\Hogan\AppData\Local\Temp\coordinate-conpty-中文 空格-khKlSI`。
其清理没有确认成功；未为删除它而猜测/杀死任何其他 conhost、Node 或 Agent 进程。不能把此项算作全部故障实验现场已经清理。

## 9. 自动化与回归

| 检查 | 本机结果 |
| --- | --- |
| Node 22 native 专项 | 7/7，零跳过 |
| Node 24 native 专项 | 7/7，零跳过 |
| `npm run check` | 190 项，186 通过，4 项既有跳过，零失败 |
| `npm run check:web` | Web 57 项：55 通过、2 跳过；shared 72 项：70 通过、2 跳过；零失败 |
| `npm run test:package` | 7/7，含安装真实生产 tarball 后的离线 Web 验收 |
| `npm run test:legacy` | 114/114 |
| `npm run test:adapters` | 33 项，32 通过、1 既有跳过，零失败 |
| Session/Native 关闭门槛修补后复跑 | 16/16；最终 Session 单独 9/9 |
| Session/PTY/Inspector/Workspace 组合 | 34/34 |
| `npm pack --dry-run --ignore-scripts` | 42 文件，约235.5kB，仍为 Web-first 白名单 |
| `git diff --check` | 通过 |

既有跳过项不用于原生验收。未声称在所有平台完成回归。
日常 CI 保持 Ubuntu Node 24、macOS Node 22、Windows Node 22；Windows native 专项复用原矩阵，手动 `windows_regression` 仍可验证 22/24，没有触发远端运行。
Skill/Plugin metadata 未修改，无须元数据重新验证；demo 流程未改。

## 10. 未解决事项及发布边界

1. 默认长路径 PowerShell 提示符缩窄到73列时，本机 PSReadLine 2.4.5 曾报 `SetCursorPosition(left=73)` 越界。隔离 HOME/APPDATA、短提示符探针通过并不代表该长提示符边界已修复。未升级用户 PSReadLine。
2. 预检验证启动能力，不是所有时刻/应用的永久稳定性证明；实际业务 Session 的异常保持 failed，需要显式重启，不能自动重放模型任务。
3. 未登录运行真实 Agent TUI；嵌入浏览器 Ctrl+C 快捷键未确认；首次异常实验残留目录尚未清理确认。
4. macOS/Linux、其他 Windows build、Node 20、长时间压力测试留待后续验证。
5. 本报告记录本地验收阶段；报告生成时未提交、推送或合并。后续 PR 集成由用户另行授权。版本未改，未创建 Tag、GitHub Release、npm 发布或触发发布工作流。

## English summary

Windows 10 build 19045 x64 was tested with Node 22.23.0 and 24.19.0 and the installed node-pty 1.1.0. Native tests pass 7/7 on both, with genuine ConPTY/TTY, child-observed resize, bounded output, final-output preservation, isolated Session lifecycles and separately asserted fallback. Fixes address asynchronous RPC EPIPE, premature Host shutdown during close, and stale metadata replay. Native capability is verified in a disposable Host before user CLI launch; cleanup is checked before fallback/startup proceeds. Versions/dependencies remain unchanged and nothing was released.

Limitations remain explicit: authenticated real-Agent TUI is untested; embedded-browser Ctrl+C keystrokes are unconfirmed (ETX paste and native Ctrl+C were verified); the local PSReadLine long-prompt resize edge case is unresolved; the first early-exit experiment left the named temporary directory without confirmed cleanup. Other operating systems/builds and long-duration stress require further validation.
