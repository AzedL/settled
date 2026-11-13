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
    hostBadge: (platform: Platform, shell: string): string =>
      `${lang.app.platformLabel(platform)} · 默认 ${shell}`,
  },

  header: {
    openWorkspace: "打开工作区",
    switchWorkspace: "切换工作区",
    loadSample: "载入示例库",
    reload: "刷新扫描",
    scopeLabel: "视图范围",
    scopeCurrent: "当前设备",
    scopeAll: "全部平台",
    runAllChecks: "全部 Check",
    runFailedChecks: "重跑失败项",
    cancelAll: "中止运行",
    activeRunsCount: (count: number): string => `运行中 (${count})`,
    selectWorkspaceTitle: "选择 Settled Workspace 目录",
    noWorkspaceLoaded: "未打开工作区",
  },

  filters: {
    searchPlaceholder: "搜索条目名称、ID、描述或标签...",
    statusAll: "全部状态",
    statusHasFail: "存在失败",
    statusHasIdle: "待检测",
    statusAllPass: "全部通过",
    statusNoCheck: "无 Check",
    allTags: "全部标签",
    clearFilters: "重置筛选",
    itemsSummary: (shown: number, total: number): string =>
      `显示 ${shown} / ${total} 条`,
    checksCounter: (pass: number, fail: number, idle: number, running: number): string =>
      `Check 统计：${pass} 通过 · ${fail} 失败 · ${idle} 未跑${running > 0 ? ` · ${running} 运行中` : ""}`,
    runFilteredChecks: (count: number): string => `运行当前筛选 Check (${count})`,
    clearSearchAria: "清空搜索关键词",
  },

  sidebar: {
    noItemsMatch: "没有符合当前筛选条件的条目",
    noItemsInWorkspace: "当前工作区的 items/ 下暂无条目",
    missingItemsDirHint: "当前目录中尚未发现 items/ 聚合目录，请先创建 items/<item-id>/。",
    disabledOsBadge: "非当前平台",
    parseErrorBadge: "配置异常",
    noCheckBadge: "纯文档 / 手工项",
    commandsCount: (count: number): string => `${count} 条 Check`,
    disabledCommandTooltip: (name: string, platforms: Platform[]): string =>
      `${name}（仅适用于 ${platforms.map(lang.app.platformLabel).join(", ")}）`,
  },

  detail: {
    selectItemPrompt: "从左侧选择一条环境条目以查看详情与独立红绿灯控制",
    itemIdLabel: "目录 ID",
    createdAtLabel: "创建时间",
    platformsLabel: "目标平台",
    allPlatformsValue: "全平台通用",
    tagsLabel: "分类标签",
    noTagsValue: "无标签",
    createdAtEmpty: "未填写",
    openInVscode: "在 VS Code 中打开",
    revealInExplorer: "在文件管理器中定位",
    copyAiContext: "复制 AI 上下文",
    copiedAiContext: "已复制上下文",
    disabledNoticeTitle: "此条目不适用于当前设备平台",
    disabledNoticeBody: (host: Platform, targets: Platform[]): string =>
      `当前主机为 ${lang.app.platformLabel(host)}，该条目的适用平台限定为 ${targets.map(lang.app.platformLabel).join(" / ")}。在「全部平台」视图中仅作只读对照，已禁用本机执行。`,
    parseErrorTitle: "meta.json 解析失败",
    readmeTitle: "说明文档 (readme.md)",
    emptyReadme: "该条目暂未编写 readme.md。",
    scriptsSectionTitle: "已注册命令 (scripts)",
    noScriptsNotice: "该条目未注册任何 scripts 命令，可作为纯文档或手工排查记录保存。",
    rawMetaToggleShow: "查看原始 meta.json",
    rawMetaToggleHide: "收起原始 meta.json",
  },

  scripts: {
    groupTitleCheck: "红绿灯检测 · check",
    groupTitleFix: "修复动作 · fix",
    groupTitleCustom: (key: string): string => `自定义脚本 · ${key}`,
    groupSubtitleCheck: "每条检测命令独立并行执行并展示各自红绿灯，互不中止。",
    groupSubtitleFix: "执行完成后若存在适用 check，将自动重跑 check 进行验收。",
    groupSubtitleCustom: "在 meta.json 中显式注册的扩展操作命令。",
    runGroupCheck: "运行整组 Check",
    runGroupFix: "执行整组 Fix",
    runGroupCustom: (key: string): string => `执行整组 ${key}`,
    runSingle: "运行",
    stopSingle: "中止",
    autoVerifyingFix: "修复动作执行完毕，正在自动重跑当前条目 check 验收...",
    noApplicableInGroup: "当前设备平台下无适用命令",
    hiddenPlatformCount: (count: number): string =>
      `另有 ${count} 条非当前平台命令在「当前设备」视图下已隐藏`,
    disabledCommandBadge: "禁用（跨平台）",
    shellBadge: (shell: string, encoding: string): string => `${shell} · ${encoding}`,
    exitCodeLabel: (code: number): string => `exit ${code}`,
    durationLabel: (ms: number): string => `${ms} ms`,
    logsShow: "日志",
    logsHide: "收起日志",
    logsEmpty: "暂无输出日志",
    logsWaiting: "正在等待命令输出...",
    commandPreviewLabel: "执行命令",
    cwdHintLabel: "工作目录固定为当前条目目录",
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
    protocolHintBody: "<workspace>/items/<item-id>/meta.json + readme.md + scripts/ (@script/)",
  },

  notifications: {
    workspaceMissingNotice: "未在工作区根目录发现 items/ 子目录",
    scanWarningsPrefix: "扫描提示：",
    errorPrefix: "操作失败：",
    vscodeFallbackHint: "请确认已安装 VS Code 并将 code 命令加入系统 PATH。",
    noRunnableChecks: "当前范围内没有可执行的 Check 命令",
    noFailedChecks: "当前没有失败或中止的 Check 命令",
    clearToast: "关闭提示",
  },
} as const;
