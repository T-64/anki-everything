// 全部界面文案（UI 文案不写在 JSX 里，见 CONTRIBUTING.md）。改措辞只改这里。
// 原则：字越少越好。能看懂的不解释；按钮只写动作；出错只说结果和怎么办。

export const zh = {
  appName: "Anki Everything",
  wordmark: { top: "Anki", main: "Everything" },

  common: {
    loading: "加载中",
    back: "返回",
    cancel: "取消",
    close: "关闭",
    networkError: "离线",
  },

  login: {
    server: "服务器地址",
    serverPlaceholder: "xxx.workers.dev",
    label: "访问密钥",
    submit: "进入",
    wrong: "密钥不对",
  },

  home: {
    filterLabel: "筛选",
    filters: { todo: "待确认", all: "全部", done: "已进 Anki" },
    camera: "拍照",
    gallery: "相册",
    empty: {
      todo: "都处理完了",
      all: "看到不懂的德语，拍下来",
      done: "还没有卡片",
    },
    pendingUpload: (count: number) => `${count} 张待上传`,
    confirmAllGo: "全部做成卡片",
    confirmAllAsk: (count: number) => `${count} 张全部做成卡片？`,
    photo: "照片",
    settings: "设置",
  },

  modes: { language: "语言", general: "通用", manual: "不用 AI" },

  status: {
    uploading: "待上传",
    analyzing: "识别中",
    draft: "待确认",
    confirmed: "待写入",
    in_anki: "已进 Anki",
    failed: "识别失败",
  },

  ask: {
    title: "哪里看不懂？",
    placeholder: "可不填",
    submit: "识别",
    manualSubmit: "做卡",
  },

  detail: {
    crop: "裁剪",
    analyzing: "识别中，约两三分钟",
    noLanguage: "没找到要学的语言",
    nothing: "没找到要记的东西",
    noAi: "服务器没有配置 AI",
    timeout: "识别超时",
    retry: "重新识别",
    discard: "丢弃",
    discardConfirm: "丢弃这张？",
    question: "你的问题",
    chunks: "意群",
    grammar: "语法",
    words: "单词",
    word: "词",
    phrase: "搭配",
    en: "英",
    sentences: (selected: number, total: number) => `句子 ${selected}/${total}`,
    addWord: "补词",
    confirm: "做成卡片",
    confirmed: "已做成",
    noneSelected: "至少留一个词",
    working: "处理中",
    unreadable: "看不清：",
    front: "正面",
    back: "背面",
    frontPlaceholder: "要记的内容",
    backPlaceholder: "讲解，支持 Markdown",
    mark: "划重点",
  },

  settings: {
    title: "设置",
    language: "语言",
    general: "通用",
    sourceLang: "学的语言",
    targetLang: "讲解语言",
    level: "水平",
    deck: "牌组",
    save: "保存",
    saved: "已保存",
    logout: "退出登录",
  },

  sentences: {
    title: "上卡的句子",
    hint: (max: number) => `最多 ${max} 句`,
    apply: "重新讲解",
    working: "讲解中，约一两分钟",
  },

  addWord: {
    title: "补词",
    placeholder: "Packungsbeilage",
    submit: "讲解",
    working: "讲解中",
  },

  crop: {
    title: "裁剪",
    hint: "拖出上卡的区域",
    reset: "整张",
    done: "完成",
  },

  preview: {
    flip: "点击翻面",
    front: "正面",
    back: "背面",
  },

  anki: {
    notInstalled: "未安装 AnkiDroid",
    needPermission: "需要访问 AnkiDroid",
    grant: "允许",
    notRunning: "AnkiDroid 未运行，卡片写不进去",
    openAnki: "打开 AnkiDroid",
    notRunningHint: "在系统设置里允许 AnkiDroid 自启动，就不用每次打开",
    webOnly: "网页版不能写入 Anki",
    writeFailed: (reason: string) => `写入失败：${reason}`,
  },

  errors: {
    no_items: "至少留一个词",
    too_many_items: "词太多了",
    wrong_state: "状态已变，返回刷新",
    daily_limit: "今天的次数用完了",
    invalid: "内容不完整",
    no_ai: "服务器没有配置 AI",
    wrong_mode: "这张不支持",
    unknown: "服务器出错",
  },
};

export type Copy = typeof zh;
