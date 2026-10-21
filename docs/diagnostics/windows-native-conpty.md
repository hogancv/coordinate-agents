---
title: Windows native ConPTY diagnostics
description: Historical Windows native terminal acceptance evidence with tested platform and CLI boundaries.
translationPending: true
search: false
---

<div id="windows-原生-conpty-本地开发与验证报告" class="doc-anchor" aria-hidden="true"></div>
<div id="结论" class="doc-anchor" aria-hidden="true"></div>
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
<div id="english-summary" class="doc-anchor" aria-hidden="true"></div>
<div id="_1-本机环境" class="doc-anchor" aria-hidden="true"></div>
<div id="_2-根因与证据边界" class="doc-anchor" aria-hidden="true"></div>
<div id="_3-独立最小复现" class="doc-anchor" aria-hidden="true"></div>
<div id="_4-最小生产修补" class="doc-anchor" aria-hidden="true"></div>
<div id="_5-native-backend-实测矩阵" class="doc-anchor" aria-hidden="true"></div>
<div id="_6-输入输出与浏览器实测" class="doc-anchor" aria-hidden="true"></div>
<div id="_7-resize-证据" class="doc-anchor" aria-hidden="true"></div>
<div id="_8-关闭与清理" class="doc-anchor" aria-hidden="true"></div>
<div id="_9-自动化与回归" class="doc-anchor" aria-hidden="true"></div>
<div id="_10-未解决事项及发布边界" class="doc-anchor" aria-hidden="true"></div>

# Windows native ConPTY diagnostics

::: warning Historical reference — English translation pending
Historical Windows native terminal acceptance evidence with tested platform and CLI boundaries. The complete record is written in Simplified Chinese. This English landing page is an index, not a translation of the technical evidence.
:::

- [Read the complete Chinese record](/zh-CN/diagnostics/windows-native-conpty.html).
- <a href="/coordinate-agents/reference-original/docs/diagnostics/windows-native-conpty.md" download>Read the unchanged original Markdown</a>.
- [Current release history](/changelog.html) and [current Workspace guide](/inspector.html).

The original record is retained in full. Do not infer current cross-platform guarantees or release status from this historical document.
