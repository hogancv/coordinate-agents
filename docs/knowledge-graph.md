---
layout: page
title: Knowledge graph
description: Explore the relationships between Coordinate Agents code, documentation and concepts in an interactive bilingual graph.
---

<script setup>
import { withBase } from 'vitepress'
const graphUrl = withBase('/graphs/coordinate-agents.html') + '?lang=en'
</script>

<main class="knowledge-graph-page">
  <h1>Knowledge graph</h1>
  <p>Explore the repository's code, documentation and their relationships. Search nodes, filter communities, and switch between English and 中文 inside the graph.</p>
  <iframe class="knowledge-graph-frame" :src="graphUrl" title="Coordinate Agents interactive knowledge graph"></iframe>
  <p class="knowledge-graph-caption"><a :href="graphUrl" target="_blank" rel="noopener">Open full screen</a> · Static snapshot: 3,562 nodes · 10,299 edges · 147 communities. Loading the graph library requires an internet connection.</p>
</main>
