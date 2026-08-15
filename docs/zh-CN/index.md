---
layout: page
title: coordinate-agents 简体中文文档
description: 面向 AI 编码代理的本地优先协调协议与运行时，支持通过适配器接入任意 CLI/桌面代理，以 Codex CLI 与 Antigravity CLI 作为首发参考适配器。
permalink: /zh-CN/
---

# coordinate-agents

`coordinate-agents` 是面向 AI 编码代理的本地优先协调协议与运行时。在同一个 Git 仓库中通过可恢复的本地 `.agent-bus` 协调多代理协作。**OpenAI Codex CLI** 与 **Google Antigravity CLI (`agy`)** 作为首发官方参考适配器与默认工作流（Codex 负责需求澄清、规格说明、提交审查与发布门禁；Antigravity 独占代码与测试实现），同时支持通过适配器动态注册与配置任意 CLI 代理。

```sh
npx @hogancv/coordinate-agents@latest install --lang zh-CN
npx @hogancv/coordinate-agents@latest doctor --lang zh-CN
npx @hogancv/coordinate-agents@latest quickstart --template feature --task "开发 Todo Web 应用" --lang zh-CN
```

- [完整简体中文 README](https://github.com/hogancv/coordinate-agents/blob/main/README.zh-CN.md)
- [AI 安装指南](https://github.com/hogancv/coordinate-agents/blob/main/AI_INSTALL.md)
- [安全说明](../security.html)
- [常见问题](../faq.html)

`.agent-bus` 是本地明文数据，不要写入令牌、Cookie、密码或私钥。在默认参考工作流中，两个代理不得同时修改产品代码或并发执行 Git 写操作。
