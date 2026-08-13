---
layout: page
title: coordinate-cli-agents 简体中文文档
description: Codex CLI 负责规格和审查，Google Antigravity CLI 负责实现的可恢复多代理协作工作流。
permalink: /zh-CN/
---

# coordinate-cli-agents

在同一个 Git 仓库中协调 **OpenAI Codex CLI** 与 **Google Antigravity CLI（`agy`）**：Codex 负责需求澄清、规格、提交审查和发布门禁，Antigravity 独占代码与测试实现。

```sh
npx @hogancv/coordinate-cli-agents@latest install --lang zh-CN
npx @hogancv/coordinate-cli-agents@latest doctor --lang zh-CN
npx @hogancv/coordinate-cli-agents@latest quickstart --template feature --task "开发 Todo Web 应用" --lang zh-CN
```

- [完整简体中文 README](https://github.com/hogancv/coordinate-cli-agents/blob/main/README.zh-CN.md)
- [AI 安装指南](https://github.com/hogancv/coordinate-cli-agents/blob/main/AI_INSTALL.md)
- [安全说明](../security.html)
- [常见问题](../faq.html)

`.agent-bus` 是本地明文数据，不要写入令牌、Cookie、密码或私钥。两个代理不得同时修改产品代码或并发执行 Git 写操作。

