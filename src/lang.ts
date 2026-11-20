import type { Platform, RunStatus } from "./types";

/**
 * Centralized UI text dictionary for Settled.
 * Keep all user-visible labels, tooltips, alerts, and formatted messages here.
 */
export const lang = {
  app: {
    name: "Settled",
    platformLabel: (platform: Platform): string => {
      switch (platform) {
        case "windows":
          return "Windows";
        case "macos":
          return "macOS";
        case "linux":
          return "Linux";
      }
    },
  },

  header: {
    openWorkspace: "打开工作区",
    recentWorkspacesAria: "最近打开的工作区",
    recentWorkspacesTitle: "最近打开的工作区",
    recentWorkspacesEmpty: "暂无",
    reload: "刷新扫描",
    scopeLabel: "视图范围",
    scopeCurrent: "当前设备",
    scopeAll: "全部平台",
    runChecks: "运行 Check",
    stopChecks: "中止 Check",
    selectWorkspaceTitle: "选择 Settled Workspace 目录",
    noWorkspaceLoaded: "未打开工作区",
    themeGroupAria: "主题外观",
    themeSystem: "跟随系统",
    themeLight: "浅色模式",
    themeDark: "深色模式",
  },

  filters: {
    searchPlaceholder: "搜索条目名称、描述",
    tagFilterPlaceholder: "筛选标签",
    moreTagsCount: (count: number): string => `+${count}`,
    itemsSummary: (shown: number, total: number): string =>
      `${shown}/${total}`,
    clearSearchAria: "清空搜索关键词",
    removeTagAria: (tag: string): string => `移除标签 ${tag}`,
  },

  sidebar: {
    noItemsMatch: "没有符合条件的条目",
  },

  detail: {
    selectItemPrompt: "请选择左侧条目",
    createdAtLabel: "创建时间",
    platformsLabel: "目标平台",
    tagsLabel: "分类标签",
    noTagsValue: "无标签",
    createdAtEmpty: "无",
    openInVscode: "在 VS Code 中打开",
    revealInExplorer: "在文件管理器中定位",
    copyAiContext: "复制条目上下文",
    copiedAiContext: "已复制上下文",
    readmeTitle: "README.md",
    scriptsSectionTitle: "命令",
    noScriptsNotice: "该条目未注册命令",
    rawMetaTitle: "meta.json",
  },

  scripts: {
    runGroup: (title: string): string => `运行 ${title}`,
    stopGroup: (title: string): string => `中止 ${title}`,
    runSingle: "运行",
    stopSingle: "中止",
    exitCodeLabel: (code: number): string => `exit ${code}`,
    durationTitle: "执行时间",
    durationLabel: (ms: number): string => `${ms} ms`,
    logsShow: "日志",
    logsHide: "收起日志",
    logsEmpty: "暂无输出日志",
    logsWaiting: "正在等待命令输出...",
  },

  status: {
    label: (status: RunStatus): string => {
      switch (status) {
        case "idle":
          return "未运行";
        case "running":
          return "运行中";
        case "pass":
          return "通过";
        case "fail":
          return "失败";
        case "canceled":
          return "已中止";
      }
    },
    disabled: "已禁用",
  },

  confirmModal: {
    subtitle: "运行此命令可能会修改本机配置、文件或依赖，请确认：",
    confirmBtn: "确认执行",
    cancelBtn: "取消",
  },
} as const;
