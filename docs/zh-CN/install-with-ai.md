---
title: AI 安装指南
description: Web Workspace 的权威安装、验证、升级与卸载指南、AI 请求示例，以及独立的 Legacy Skill 安装入口。
---

<div id="install-with-ai-ai-安装指南" class="doc-anchor" aria-hidden="true"></div>
<div id="install-with-ai--ai-安装指南" class="doc-anchor" aria-hidden="true"></div>
<div id="canonical-identity--官方身份" class="doc-anchor" aria-hidden="true"></div>
<div id="check-prerequisites--安装前检查" class="doc-anchor" aria-hidden="true"></div>
<div id="choose-installation-path--选择安装方式" class="doc-anchor" aria-hidden="true"></div>
<div id="published-web-package--已发布-web-包" class="doc-anchor" aria-hidden="true"></div>
<div id="current-source--当前源码" class="doc-anchor" aria-hidden="true"></div>
<div id="verify-and-report--验证与汇报" class="doc-anchor" aria-hidden="true"></div>
<div id="upgrade--更新" class="doc-anchor" aria-hidden="true"></div>
<div id="uninstall--卸载" class="doc-anchor" aria-hidden="true"></div>
<div id="optional-structured-installation--可选结构化安装" class="doc-anchor" aria-hidden="true"></div>
<div id="troubleshooting--故障排查" class="doc-anchor" aria-hidden="true"></div>

# AI 安装指南

本页是权威安装指南，合并了原根目录的 `AI_INSTALL.md` 与原有的 AI 安装说明。

::: warning v2.4 用户
用 Web 包替换现有结构化安装之前，请先阅读[旧版文档与 v3 迁移](./v2.4.html)。
:::

用户要求安装 Coordinate Agents 时，默认安装本地 **Web Workspace**。
仅当用户明确要求 Codex Plugin、Legacy Skill、MCP 或结构化 Task 时，才使用
[结构化指南](./structured-workflow.html)及 [Legacy 安装生命周期（英文）](../legacy-ai-install.html)。
npm 3.x 不是旧版 Skill 安装器。

<div id="canonical-identity-官方身份" class="doc-anchor" aria-hidden="true"></div>

## 官方身份

- GitHub 所有者：`hogancv`
- 官方仓库：https://github.com/hogancv/coordinate-agents
- npm 包：`@hogancv/coordinate-agents`
- 预期的 `repository.url`：`git+https://github.com/hogancv/coordinate-agents.git`
- 主要用法：[中文 README](https://github.com/hogancv/coordinate-agents/blob/main/README.zh-CN.md)、[英文 README](https://github.com/hogancv/coordinate-agents/blob/main/README.md)

安装前核验身份及实际发布版本：

```sh
npm view @hogancv/coordinate-agents dist-tags.latest version repository.url --json
```

本指南以 **Web 3.0.2** 为目标，包含 Git Changes 与审查反馈、自定义终端、桌面通知、
Timeline、Health 及原生 Codex 恢复。**2026-10-21 已核验**：npm `latest` 与源码包版本
均为 **3.0.2**；独立版本的 `.codex-plugin` Plugin 为 **2.4.0**。
选择 `latest` 前仍须重新检查注册表元数据。开发或使用所选发布版本之后的改动时，应使用源码。
切勿用 npm 最新版本替换 Legacy 流程中的 2.4.0。

<div id="check-prerequisites-安装前检查" class="doc-anchor" aria-hidden="true"></div>

## 安装前检查

```sh
node --version
git --version
# 仅默认协作模式需要：
codex --version
agy --version
```

要求 Node.js >=18 和 Git。默认模式使用 `codex` 与 `agy`；自定义模式使用用户选择的可执行文件。
各 CLI 负责自己的供应商登录。不要索要、输出、复制或保存凭据，不要读取或搬运登录目录。
检测到可执行文件不代表登录、供应商访问或配额正常。不要静默修改 CLI 权限。

原生 PTY 支持取决于平台和 Node 版本。stdio 回退不能提供完整 TUI，也不能提供子进程可见的尺寸变化。

<div id="choose-installation-path-选择安装方式" class="doc-anchor" aria-hidden="true"></div>

## 选择安装方式

<div id="published-web-package-已发布-web-包" class="doc-anchor" aria-hidden="true"></div>

### 已发布 Web 包

全局安装是可选的。启动已核验版本时应明确项目根目录：

```sh
npx @hogancv/coordinate-agents@3.0.2 web --root "/path/to/project" --port 3000
```

若用户要求最新版本，用新近核验的版本替换 3.0.2。`--port 0` 会选择空闲端口。
打开 Web 会初始化本地项目存储；若启动目录不是 Git 仓库，还会初始化 Git，但不创建提交。
请选择实际要使用的项目目录，不要为验证而从任意目录启动。

<div id="current-source-当前源码" class="doc-anchor" aria-hidden="true"></div>

### 当前源码

```sh
git clone https://github.com/hogancv/coordinate-agents.git
cd coordinate-agents
npm ci
node bin/coordinate-agents.mjs web --root "/path/to/project" --port 3000
```

适合时复用已有检出目录并保留本地修改。合并到 main 不等于发布到 npm。
npm 包和 Plugin 版本独立。需要当前新增功能时，从源码安装依赖后运行 Web 入口即可。

<div id="verify-and-report-验证与汇报" class="doc-anchor" aria-hidden="true"></div>

## 验证与汇报

若请求仅为安装软件包，应检查所选包的版本和帮助。除非用户另行要求，不要运行 `quickstart`、
创建任务或启动代理进程。npm 3.x 没有 `doctor` 或 Skill `install` 命令。

```sh
npx @hogancv/coordinate-agents@3.0.2 --version
npx @hogancv/coordinate-agents@3.0.2 --help
# 对应的源码命令：
node bin/coordinate-agents.mjs --version
node bin/coordinate-agents.mjs --help
```

若用户要求启动 Web，检查输出的 localhost URL、选定根目录和可用的可执行文件设置。
命令以非零状态退出即为该步骤失败，应汇报失败及适度截取的诊断，不能宣称成功。
仅启动服务器不能验证真实模型任务、PTY TUI 或操作系统通知。

汇报仓库和包身份、所选版本或源码提交、Node/Git、所选 CLI 可执行文件、安装位置、
实际检查项，以及尚未解决的登录或平台问题。明确区分“已安装”“服务器已启动”和“真实任务已验证”。
安装成功不等于模型任务完成。

<div id="upgrade-更新" class="doc-anchor" aria-hidden="true"></div>

## 更新

npm 安装应重新检查元数据并使用选定的新版本。全局安装可使用
`npm install -g @hogancv/coordinate-agents@<verified-version>` 更新。
源码安装应先检查本地修改，再更新检出目录；依赖变化时重新运行 `npm ci`。
明确停止并重启 Web，持久会话通过各自的关闭或重启控件处理。
已有任务数据独立于安装代码。不要承诺自动迁移数据或恢复会话上下文。

<div id="uninstall-卸载" class="doc-anchor" aria-hidden="true"></div>

## 卸载

若曾全局安装：

```sh
npm uninstall -g @hogancv/coordinate-agents
```

`npx` 无需全局卸载。用户要求停止使用时，关闭所属代理会话并停止服务器。
移除软件包或源码不会移除本地项目历史或项目注册表。用户要求移除任务历史时，优先使用
Workspace 明确提供的归档与清空控件；清空不可恢复。不要仅为卸载而删除项目源码或 `.agent-bus/`。

<div id="optional-structured-installation-可选结构化安装" class="doc-anchor" aria-hidden="true"></div>

## 可选结构化安装

用户明确要求 Codex Plugin 时：

```sh
codex plugin marketplace add hogancv/coordinate-agents
codex plugin add coordinate-agents@coordinate-agents
```

Plugin 自带运行时，无需全局 npm CLI。独立安装 Legacy Skill 时，固定 npm **2.4.0**，
并按照 [Legacy 安装指南（英文）](../legacy-ai-install.html)进行选定目标的 `doctor` 检查、
升级、卸载、备份恢复和失败处理。源码命令使用 `node bin/coordinate-agents-legacy.mjs`；
npm 3.x 不提供这些命令。

<div id="troubleshooting-故障排查" class="doc-anchor" aria-hidden="true"></div>

## 故障排查

参阅[故障排查](./troubleshooting.html)。切勿使用 `curl | sh` 安装未经审阅的代码。
切勿索要、输出、复制或保存 token、cookie、密码或私钥。缺少代理 CLI 时，应另行查阅供应商
安装说明，不能据此推断用户允许替换现有配置。

<div id="request-the-web-workspace" class="doc-anchor" aria-hidden="true"></div>

## 请求安装 Web Workspace

```text
请从 hogancv/coordinate-agents 安装 Coordinate Agents，供本地 Web 使用。
阅读 docs/zh-CN/install-with-ai.md，核验包身份和已发布版本，检查 Node.js、Git
及我的代理 CLI 命令。保留现有 CLI 登录与权限设置。验证安装，不创建代理任务。
```

源码开发或需要所选 npm 发布之后的改动时，使用以下请求：

```text
请从官方仓库配置当前 coordinate-agents 源码，让我使用自定义终端、Git Changes
审查、Timeline、Health 和桌面通知。复用已有检出目录并保留本地修改。
安装依赖，给出针对我的项目的 Web 启动命令。
```

AI 应检查注册表元数据，不能假定源码、3.0.2 发布与当前 npm `latest` 完全一致。

<div id="commands-the-ai-may-execute" class="doc-anchor" aria-hidden="true"></div>

## AI 可以执行的命令

安装请求范围内，可执行只读的身份与前置条件检查：

```sh
npm view @hogancv/coordinate-agents dist-tags.latest version repository.url --json
node --version
git --version
codex --version
agy --version
```

安装所选包或源码依赖后，检查其 `--version` 和 `--help`。
用户要求启动 Web 时，选择明确的项目根目录并打开输出的 localhost URL。
非 Git 启动目录会初始化 Git 和本地存储，但不创建提交。
创建任务会启动真实代理进程，这属于与包验证分开的操作。

<div id="commands-the-ai-must-not-execute-implicitly" class="doc-anchor" aria-hidden="true"></div>

## AI 不得隐式执行的命令

不要针对 npm `latest` 运行 Legacy `install`、`doctor` 或 `quickstart`。
不要仅为证明安装成功而创建协作任务。不要修改 CLI 权限或沙箱设置、复制登录信息，或删除本地任务历史。
供应商认证保留在所选 CLI 中。未经审阅，不要将下载的安装脚本直接通过管道交给 shell。

<div id="installation-result-report" class="doc-anchor" aria-hidden="true"></div>

## 安装结果汇报

有效汇报应说明：

- 官方仓库、包及所选发布版本或源码提交。
- 安装路径、Node/Git 版本，以及配置的可执行文件名称或路径。
- 实际完成的版本与帮助检查；若用户要求启动，还应给出服务器 URL。
- 尚未验证的登录、供应商、PTY 或操作系统通知检查。

npm 命令成功不能证明真实代理任务或桌面通知正常。非零退出必须作为失败步骤汇报。
常见失败与恢复方法见[故障排查](./troubleshooting.html)。

<div id="explicit-plugin-or-legacy-skill-requests" class="doc-anchor" aria-hidden="true"></div>

## 明确请求 Plugin 或 Legacy Skill

需要 Codex 原生结构化 Task 时，请使用 GitHub Plugin 并遵循[结构化工作流](./structured-workflow.html)。
仅安装 Plugin 时自带运行时，无需全局 npm CLI。

npm 2.4.0 Skill 安装器请使用 [Legacy Skill 安装指南（英文）](../legacy-ai-install.html)。
该指南保留 Codex 和 Antigravity 的安装对话、选定目标的 `doctor` 检查、更新与卸载，以及备份恢复。
切勿将 npm 当前的 `dist-tags.latest` 代入该 Legacy 流程。
