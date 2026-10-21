import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const docs = resolve(root, 'docs');
const inventory = JSON.parse(readFileSync(resolve(docs, 'maintenance/content-inventory.json'), 'utf8'));
const originals = inventory.files.filter(row => row.path.startsWith('docs/') && !row.path.startsWith('docs/zh-CN/'));
const pending = [], routes = [];
const route = name => name.replace(/^docs\//, '').replace(/index\.md$/, '').replace(/\.md$/, '.html');
for (const row of inventory.files.filter(row => row.path.startsWith('docs/'))) {
  routes.push({ old: '/coordinate-agents/' + route(row.path), new: '/coordinate-agents/' + route(row.path), policy: 'preserved' });
}
for (const row of originals) {
  const en = row.path.slice(5), zh = 'zh-CN/' + en;
  for (const name of [en, zh]) {
    if (!existsSync(resolve(docs, name))) throw new Error('Missing locale route: ' + name);
    if (/translationPending: true/.test(readFileSync(resolve(docs, name), 'utf8'))) pending.push({ path: name, language: name.startsWith('zh-CN/') ? 'zh-CN' : 'en' });
  }
}
const mapping = { checkedOn: '2026-10-21', base: '/coordinate-agents/', sourceCommit: inventory.baselineCommit, routes, staticRoutes: ['llms.txt', 'feed.xml', 'sitemap.xml'].map(path => ({ old: '/coordinate-agents/' + path, new: '/coordinate-agents/' + path, policy: 'preserved' })), pending };
mkdirSync(resolve(docs, 'public/audits'), { recursive: true });
writeFileSync(resolve(docs, 'maintenance/route-map.json'), JSON.stringify(mapping, null, 2) + '\n');
for (const name of ['content-inventory.json', 'route-map.json']) writeFileSync(resolve(docs, 'public/audits', name), readFileSync(resolve(docs, 'maintenance', name)));
for (const zh of [false, true]) {
  const prefix = zh ? '/zh-CN/' : '/';
  const title = zh ? '文档迁移与路径映射' : 'Documentation migration and URL map';
  const lines = [`---\ntitle: ${title}\ndescription: ${zh ? '内容清单、版本核对、路径兼容、翻译状态及部署步骤。' : 'Content inventory, version audit, URL compatibility, translation status and deployment steps.'}\n---\n\n# ${title}\n`];
  lines.push(zh ? `本次以稳定版 VitePress 1.6.4 替换 Jekyll/Minima。域名保持 \`https://hogancv.github.io\`，base 保持 \`/coordinate-agents/\`。英文为根语言，简体中文为 \`/zh-CN/\`。审计基线为 \`${inventory.baselineCommit}\`，日期 2026-10-21。` : `This migration replaces Jekyll/Minima with stable VitePress 1.6.4. The domain remains \`https://hogancv.github.io\`, with base \`/coordinate-agents/\`, English at root and Simplified Chinese at \`/zh-CN/\`. Baseline: \`${inventory.baselineCommit}\`; audited 2026-10-21.`);
  lines.push(zh ? '## 改动清单\n\n- 独立文档依赖和锁文件；GitHub Actions 构建、检查与部署。\n- 原生语言菜单、独立中英文导航、移动导航、明暗主题、本地搜索、目录及代码复制。\n- Web 产品主路径与结构化 Plugin 分区；完整双语上手、安装、排障、安全、协议、Session 与版本记录。\n- 清理过期版本表述与整页双语混排；保留安全、权限、回执与 Runtime 限制。\n- 保存精确原文、旧版快照、原地址和片段兼容；附自动链接检查。\n- 应用实现、CLI、协议、根依赖与 npm 发布文件选择未改动。' : '## Change list\n\n- Independent documentation dependency/lockfile and GitHub Actions build, checks and deployment.\n- Standard language menu, independent navigation, mobile menu, themes, local search, outline and code copy.\n- Separate Web and structured Plugin paths; complete bilingual onboarding, installation, troubleshooting, security, protocol, Session and changelog.\n- Correct stale release claims and mixed-language articles while retaining safety, permission, receipt and Runtime limits.\n- Exact source archives, historical snapshot, preserved URLs/fragments and an automated link crawler.\n- No changes to application implementation, CLI, protocol, root dependencies or npm file selection.');
  lines.push(zh ? '## 内容清单与版本依据' : '## Inventory and version evidence');
  lines.push(zh ? '审计覆盖全部 **63 份已跟踪 Markdown（docs 内 47 份）**，记录路径、行数、SHA-256、标题和链接。' : 'The audit covers all **63 tracked Markdown files (47 in docs)**, recording paths, line counts, SHA-256 hashes, headings and links.');
  lines.push('[Markdown inventory](/audits/content-inventory.json) · [Machine-readable route map](/audits/route-map.json)');
  lines.push('| Component | Verified version | Evidence |\n| --- | --- | --- |\n| Web source | 3.0.2 | `package.json`, root lockfile |\n| npm latest | 3.0.2 | `npm view @hogancv/coordinate-agents dist-tags --json` |\n| GitHub release | v3.0.2 | `gh release view v3.0.2` |\n| Structured Plugin | 2.4.0 | `.codex-plugin/plugin.json` (independent version) |\n| VitePress stable | 1.6.4 | `npm view vitepress dist-tags --json`; `2.0.0-alpha.20` is next |');
  lines.push(zh ? '以上是审计日期的事实，不是未来版本承诺。源码、Web npm 包与 Plugin 的发布独立；历史开发记录中的 v3.1 是计划名称。' : 'These are dated audit facts, not future release promises. Source, Web npm and Plugin releases are independent; v3.1 in engineering records is a planning label.');
  lines.push(zh ? '## 旧新路径映射' : '## Old-to-new URL map');
  lines.push(zh ? '所有既有 Markdown 页面地址均原地保留，继续使用 `.html`。中文产品链接进入对应中文页；原文技术页不冒充完整译文。以下均相对于 `/coordinate-agents/`。' : 'Every existing Markdown page retains its route and `.html` extension. Product links stay within their language; technical entry pages disclose pending translations. Paths below are relative to `/coordinate-agents/`.');
  const routeRows = ['| Old | New | Chinese counterpart |', '| --- | --- | --- |'];
  for (const row of originals) {
    const name = route(row.path), dest = name || './';
    routeRows.push(`| \`${name || '/'}\` | [${name || '/'}](/${name}) | [${'zh-CN/' + (name || '')}](/zh-CN/${name}) |`);
  }
  lines.push(routeRows.join('\n'));
  lines.push(zh ? '已有 `/zh-CN/` 和 `/zh-CN/codex-conversation-resume.html` 同样保持。`index.html` 与目录首页均可直接访问。原站首页列出的重要入口不需要额外跳转；不存在服务器重写依赖。`llms.txt`、`sitemap.xml` 继续提供，旧的空 Atom `feed.xml` 保留兼容访问；新版版本信息以版本记录为准。' : 'Existing `/zh-CN/` and `/zh-CN/codex-conversation-resume.html` also remain. Both directory indexes and explicit `index.html` work. Important old homepage links need no server rewrite or redirect. `llms.txt` and `sitemap.xml` remain available; the previous empty Atom `feed.xml` is retained for compatibility. Use the changelog for current releases.');
  lines.push(zh ? '## 精确历史快照' : '## Exact historical snapshots');
  lines.push('- [v2.4.0 original README](/archive/v2.4.0/README.md)\n- [v2.4.0 original Chinese README](/archive/v2.4.0/README.zh-CN.md)\n- [v2.4.0 original docs index](/archive/v2.4.0/docs/index.md)\n- [v2.4.0 original installation](/archive/v2.4.0/AI_INSTALL.md)\n- [Pre-migration docs index](/reference-original/docs/index.md)');
  lines.push(zh ? '快照位于 `public/archive/v2.4.0/`，来自固定提交 `3e36942ce52004ad3136c6f24be57a8255361c75`，保留完整原目录与文件内容。重构前 47 份文档的完整副本位于 `public/reference-original/docs/`，SHA-256 可与内容清单核对。它们是原始 Markdown，不进入当前文档搜索，不重写其内部历史链接。' : 'The `public/archive/v2.4.0/` snapshot comes from pinned commit `3e36942ce52004ad3136c6f24be57a8255361c75`, preserving its original tree and bytes. All 47 pre-migration docs have exact copies under `public/reference-original/docs/`, verifiable against the inventory hashes. These are raw Markdown archives, excluded from current search; historical links inside them are intentionally unchanged.');
  lines.push(zh ? '## 剩余未翻译页面' : '## Remaining full translations');
  lines.push(zh ? '以下为完整、明确的待翻译清单；本地化导航入口不计为全文翻译。主产品阅读路径及结构化 Plugin 上手已全文翻译。' : 'This is the complete pending list; localized index pages do not count as full translations. Primary product journeys and structured Plugin onboarding are fully translated.');
  lines.push(['| Language needed | Page |', '| --- | --- |', ...pending.map(item => `| ${item.language} | [${item.path}](/${item.path.replace(/\.md$/, '.html')}) |`)].join('\n'));
  lines.push(zh ? '## 构建与上线' : '## Build and rollout');
  lines.push('```sh\nnpm ci --prefix docs\nnpm test --prefix docs\nnpm run build --prefix docs\nnpm run check --prefix docs\nnpm run dev --prefix docs -- --host 127.0.0.1\n```');
  lines.push(zh ? '工作流在 PR 中只构建检查；合并到 main 或在 main 手动运行时上传并部署。线上当前配置曾为 `legacy / main:/docs`，切换前必须先将本次变更合并至 main，再用下列 CLI 将 Source 改为 GitHub Actions 并触发工作流。域名和 HTTPS 配置不变；若部署失败可切回旧提交与旧 Pages Source。实际线上部署状态见维护验收记录，本页不声称本地构建已经上线。' : 'Pull requests only build/check. Main pushes or manual main runs upload and deploy. The previous live setting was `legacy / main:/docs`; first merge this change into main, then change Source to GitHub Actions and dispatch via the CLI below. The domain and HTTPS settings remain. A failed rollout can be reverted to the old commit and Pages Source. See the maintenance verification record for actual deployment status; a local build does not imply publication.');
  lines.push('```sh\ngh api --method PUT repos/hogancv/coordinate-agents/pages -f build_type=workflow\ngh workflow run pages-build.yml --ref main\ngh run list --workflow pages-build.yml --limit 5\n```');
  writeFileSync(resolve(docs, zh ? 'zh-CN/documentation-migration.md' : 'documentation-migration.md'), lines.join('\n\n').replace(/\[([^\]]+)\]\((\/(?:archive|reference-original)\/[^)]+\.md)\)/g, (_, text, href) => `<a href="/coordinate-agents${href}" download>${text}</a>`) + '\n');
}
console.log(`Generated ${routes.length} preserved routes, ${pending.length} pending full translations.`);
