import type { Platform, RunStatus } from "./types";

/**
 * Centralized UI text dictionary for Settled.
 * Keep all user-visible labels, tooltips, alerts, and formatted messages here.
 */
export const lang = {
  app: {
    name: "Settled",
    tagline: "跨设备环境检查与问题台账驾驶舱",
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
    switchWorkspace: "切换工作区",
    loadSample: "载入示例库",
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
    searchPlaceholder: "搜索条目名称、描述或标签...",
    allTags: "全部标签",
    itemsSummary: (shown: number, total: number): string =>
      `${shown}/${total}`,
    clearSearchAria: "清空搜索关键词",
  },

  sidebar: {
    noItemsMatch: "没有符合条件的条目",
    noItemsInWorkspace: "当前工作区的 items/ 下暂无条目",
    missingItemsDirHint: "当前目录中尚未发现 items/ 聚合目录，请先创建 items/<item-id>/。",
    parseErrorBadge: "配置异常",
  },

  detail: {
    selectItemPrompt: "从左侧选择一条环境条目以查看详情与独立红绿灯控制",
    createdAtLabel: "创建时间",
    platformsLabel: "目标平台",
    tagsLabel: "分类标签",
    noTagsValue: "无标签",
    createdAtEmpty: "未填写",
    openInVscode: "在 VS Code 中打开",
    revealInExplorer: "在文件管理器中定位",
    copyAiContext: "复制 AI 上下文",
    copiedAiContext: "已复制上下文",
    parseErrorTitle: "meta.json 解析失败",
    readmeTitle: "README.md",
    readmeEmptyHint: "未编写",
    emptyReadme: "该条目暂未编写 README.md。",
    scriptsSectionTitle: "命令",
    noScriptsNotice: "该条目未注册命令",
    rawMetaTitle: "meta.json",
  },

  scripts: {
    runGroup: (title: string): string => `运行 ${title}`,
    stopGroup: (title: string): string => `中止 ${title}`,
    runSingle: "运行",
    stopSingle: "中止",
    autoVerifyingFix: "修复动作执行完毕，正在自动重跑当前条目 check 验收...",
    noApplicableInGroup: "当前设备平台下无适用命令",
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
    title: "确认执行环境修改命令",
    subtitleFix: "即将执行 fix 修复脚本，这可能会修改本机配置、文件或依赖。完成后将自动重跑该条目的 check 进行验收。",
    subtitleCustom: "即将执行自定义脚本命令，请确认以下命令符合本机预期：",
    skipFutureLabel: "后续执行 fix / 自定义命令不再弹窗确认",
    confirmBtn: "确认执行",
    cancelBtn: "取消",
  },

  welcome: {
    title: "Settled 环境驾驶舱",
    subtitle: "打开一个包含 items/<id>/meta.json 的工作区目录，即刻获取本机独立命令红绿灯与跨设备环境清晰度。",
    openFolderBtn: "选择 Workspace 目录",
    loadSampleBtn: "打开内置示例 Workspace",
    recentTitle: "最近打开的工作区",
    protocolHintTitle: "目录约定",
    protocolHintBody: "<workspace>/items/<item-id>/meta.json + README.md + scripts/ (@script/)",
  },

  notifications: {
    workspaceMissingNotice: "未在工作区根目录发现 items/ 子目录",
    scanWarningsPrefix: "扫描提示：",
    errorPrefix: "操作失败：",
    vscodeFallbackHint: "请确认已安装 VS Code 并将 code 命令加入系统 PATH。",
    noRunnableChecks: "当前范围内没有可执行的 Check 命令",
    clearToast: "关闭提示",
  },
} as const;
