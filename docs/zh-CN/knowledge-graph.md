---
layout: page
title: 知识图谱
description: 通过交互式双语图谱，探索 Coordinate Agents 代码、文档与概念之间的关系。
---

<script setup>
import { withBase } from 'vitepress'
const graphUrl = withBase('/graphs/coordinate-agents.html') + '?lang=zh-CN'
</script>

<main class="knowledge-graph-page">
  <h1>知识图谱</h1>
  <p>探索仓库代码、文档及它们之间的关系。可搜索节点、筛选社区，并在图谱内切换中文与 English。</p>
  <iframe class="knowledge-graph-frame" :src="graphUrl" title="Coordinate Agents 交互式知识图谱"></iframe>
  <p class="knowledge-graph-caption"><a :href="graphUrl" target="_blank" rel="noopener">全屏打开</a> · 静态快照：3,562 个节点 · 10,299 条边 · 147 个社区。加载图形库需要联网。</p>
</main>
