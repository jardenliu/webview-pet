import { defineConfig } from 'vitepress';

export default defineConfig({
  // GitHub Pages project site: https://<user>.github.io/webview-pet/
  base: '/webview-pet/',
  lang: 'zh-CN',
  title: 'webview-pet',
  description:
    '为任意 Node.js / Bun 项目快速接入桌面宠物能力 — 气泡说话、拖拽抛掷物理、睡觉、占用锁、多宠物，全部由纯函数 API 驱动。',
  cleanUrls: true,
  head: [['link', { rel: 'icon', href: '/webview-pet/favicon.svg' }]],

  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/getting-started' },
      { text: 'API', link: '/api/petapp' },
      { text: 'npm', link: 'https://www.npmjs.com/package/webview-pet' },
      { text: 'GitHub', link: 'https://github.com/jardenliu/webview-pet' },
    ],

    sidebar: [
      {
        text: '指南',
        items: [
          { text: '快速开始', link: '/guide/getting-started' },
          { text: '动画系统', link: '/guide/animations' },
          { text: '物理与拖拽', link: '/guide/physics' },
          { text: '互动能力', link: '/guide/interaction' },
        ],
      },
      {
        text: 'API 参考',
        items: [
          { text: 'PetApp', link: '/api/petapp' },
          { text: 'Pet', link: '/api/pet' },
          { text: '类型定义', link: '/api/types' },
        ],
      },
    ],

    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    darkModeSwitchLabel: '外观',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
          modal: {
            noResultsText: '没有找到结果',
            resetButtonTitle: '清除查询',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },

    footer: {
      message: 'MIT License · Powered by @webviewjs/webview',
      copyright: '© webview-pet contributors',
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/jardenliu/webview-pet' }],
  },
});
