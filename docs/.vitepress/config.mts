import { defineConfig } from 'vitepress'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const pages = {
  en: {
    guide: 'Web Workspace', start: 'Getting started', workspace: 'Workspace guide', install: 'Install with AI',
    recovery: 'Conversation recovery', troubleshooting: 'Troubleshooting', faq: 'FAQ', compare: 'Compare workflows',
    security: 'Security & permissions', plugin: 'Structured Plugin', structured: 'Onboarding & lifecycle',
    reference: 'Technical reference', versions: 'Versions & migration', changelog: 'Changelog', migration: 'v2.4 → v3 migration',
    protocol: 'Protocol & recovery', session: 'Session Runtime', map: 'Documentation migration', graph: 'Knowledge graph',
  },
  zh: {
    guide: 'Web 工作台', start: '快速开始', workspace: '使用指南', install: '让 AI 安装',
    recovery: '对话恢复', troubleshooting: '故障排查', faq: '常见问题', compare: '方案比较',
    security: '安全与权限', plugin: '结构化 Plugin', structured: '上手与生命周期',
    reference: '技术参考', versions: '版本与迁移', changelog: '版本记录', migration: 'v2.4 → v3 迁移',
    protocol: '协议与恢复', session: 'Session Runtime', map: '文档迁移记录', graph: '知识图谱',
  },
}
function theme(lang: 'en' | 'zh') {
  const t = pages[lang], prefix = lang === 'zh' ? '/zh-CN/' : '/'
  const item = (key: keyof typeof t, slug: string) => ({ text: t[key], link: `${prefix}${slug}.html` })
  return {
    nav: [item('guide', 'getting-started'), item('graph', 'knowledge-graph'), item('plugin', 'structured-workflow'), item('reference', 'reference'), item('versions', 'v2.4')],
    sidebar: [
      { text: t.guide, items: [item('start', 'getting-started'), item('workspace', 'inspector'), item('install', 'install-with-ai'), item('recovery', 'codex-conversation-resume'), item('graph', 'knowledge-graph')] },
      { text: lang === 'zh' ? '帮助与安全' : 'Help & safety', items: [item('troubleshooting', 'troubleshooting'), item('faq', 'faq'), item('compare', 'comparison'), item('security', 'security')] },
      { text: t.plugin, items: [item('structured', 'structured-workflow'), item('protocol', 'protocol'), item('session', 'session-runtime'), item('reference', 'reference')] },
      { text: t.versions, items: [item('changelog', 'changelog'), item('migration', 'v2.4'), item('map', 'documentation-migration')] },
    ],
    outline: { level: [2, 3] as [number, number], label: lang === 'zh' ? '本页目录' : 'On this page' },
    docFooter: { prev: lang === 'zh' ? '上一页' : 'Previous page', next: lang === 'zh' ? '下一页' : 'Next page' },
    lastUpdated: { text: lang === 'zh' ? '最后更新' : 'Last updated', formatOptions: { dateStyle: 'medium' as const } },
    editLink: { pattern: 'https://github.com/hogancv/coordinate-agents/edit/main/docs/:path', text: lang === 'zh' ? '在 GitHub 编辑此页' : 'Edit this page on GitHub' },
    footer: { message: lang === 'zh' ? '本地协作。明确权限。独立验证。' : 'Local coordination. Explicit permissions. Independent verification.', copyright: 'MIT · Coordinate Agents' },
    ...(lang === 'zh' ? { langMenuLabel: '切换语言', returnToTopLabel: '返回顶部', sidebarMenuLabel: '菜单', darkModeSwitchLabel: '主题', lightModeSwitchTitle: '切换到浅色模式', darkModeSwitchTitle: '切换到深色模式', skipToContentLabel: '跳转到内容' } : {}),
  }
}
export default defineConfig({
  async buildEnd(config) {
    // JSON evidence is linked as a document, so Vite does not bundle it as an asset.
    for (const folder of ['releases', 'diagnostics', 'development']) {
      const destination = join(config.outDir, folder)
      mkdirSync(destination, { recursive: true })
      for (const entry of readdirSync(join(config.srcDir, folder))) {
        if (entry.endsWith('.json')) copyFileSync(join(config.srcDir, folder, entry), join(destination, entry))
      }
    }
    copyFileSync(join(config.srcDir, 'llms.txt'), join(config.outDir, 'llms.txt'))
  },
  title: 'Coordinate Agents',
  description: 'A local Web Workspace for persistent coding-agent terminals and explicit collaboration.',
  base: '/coordinate-agents/',
  cleanUrls: false,
  lastUpdated: true,
  srcExclude: ['maintenance/**', 'node_modules/**', 'public/**'],
  transformHead({ pageData }) {
    if (pageData.relativePath === '404.md') return []
    const path = pageData.relativePath.replace(/index\.md$/, '').replace(/\.md$/, '.html')
    const logical = path.replace(/^zh-CN\//, '')
    const origin = 'https://hogancv.github.io/coordinate-agents/'
    return [
      ['link', { rel: 'canonical', href: origin + path }],
      ['link', { rel: 'alternate', hreflang: 'en', href: origin + logical }],
      ['link', { rel: 'alternate', hreflang: 'zh-CN', href: origin + 'zh-CN/' + logical }],
      ['link', { rel: 'alternate', hreflang: 'x-default', href: origin + logical }],
    ]
  },
  sitemap: { hostname: 'https://hogancv.github.io/coordinate-agents/' },
  head: [['meta', { name: 'theme-color', content: '#285a76' }]],
  locales: {
    root: { label: 'English', lang: 'en', link: '/', themeConfig: theme('en') },
    'zh-CN': { label: '简体中文', lang: 'zh-CN', link: '/zh-CN/', description: '持久编码 Agent 双终端与明确协作边界的本地 Web 工作台。', themeConfig: theme('zh') },
  },
  themeConfig: {
    siteTitle: 'Coordinate Agents',
    socialLinks: [{ icon: 'github', link: 'https://github.com/hogancv/coordinate-agents' }],
    search: { provider: 'local', options: { locales: { 'zh-CN': { translations: { button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' }, modal: { displayDetails: '显示详情', resetButtonTitle: '清除搜索', backButtonTitle: '返回', noResultsText: '没有找到结果', footer: { selectText: '选择', selectKeyAriaLabel: 'Enter', navigateText: '切换', navigateUpKeyAriaLabel: '向上', navigateDownKeyAriaLabel: '向下', closeText: '关闭', closeKeyAriaLabel: 'Escape' } } } } } } },
  },
})
