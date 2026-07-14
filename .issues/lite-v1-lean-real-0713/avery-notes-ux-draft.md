# 「Avery 的笔记」露出 UX 设计稿(lite v1 · feat/033 实现依据 · 待 Danny 抽查)

status: draft-for-danny · date: 2026-07-13 · source: PRD User Stories 7/8 + session-close §6
红线前提(不可谈判):笔记 = agent 自写观察,**永不评分/排名/画像**;用户**只读**。写侧由后端
`redline.validate` 门管(PRD Implementation Decisions),本稿只管露出层。

---

## 1 · 放哪:独立第 5 个 tab「Avery's notes」

- **推荐:顶栏新增 tab**,`LiteScreen` 加 `'notes'`,`LiteTopbar` tabs 数组插一项。
  排序建议:`Your team · The room · Avery's notes · Playbooks · Where this goes`
  (紧跟 The room——笔记由 advise 会话产生,动线上"问完就能翻到它写了什么")。
- 为什么不是 Team 屏侧栏:Team 右栏已密(上传面板+人卡分组+项目卡);且笔记是
  **"活的 agent"钩子**(PRD Story 7/17 的 lead-gen 核心),值得一个一级入口,不该埋进侧栏。
- 为什么不塞 Room 屏:Room 是画布(LitePanZoom + 终端 + 8 字段卡),再挂长列表会挤。
  但 Room 里留一个**轻 nudge**(见 §3),让"它刚写了笔记"在事发现场被感知。

## 2 · 信息结构(屏内布局)

复用 Playbooks/Vision 的叙事屏骨架:`.scene.scene-nexus.is-active` 外壳 + `.eyebrow` + `h2` + lede。

```
┌─ lite-notes ────────────────────────────────────────────┐
│ eyebrow: FIELD NOTES                                     │
│ h2: What Avery has noticed about your company            │
│ lede + 信任说明条(§4,常驻)                              │
│ 计数行: 12 observations · since Mar 3    ← 增长感知     │
│ ── 按天分组、新→旧 ──────────────────────────────       │
│ ▾ Today                                                  │
│   ┌ note-entry ┐ 时间戳 · 观察正文(1–3 句)              │
│   │            │ 来源行: From your question about the    │
│   └────────────┘         onboarding backlog →(跳 Room)  │
│ ▸ Mar 5 (3)                                              │
└──────────────────────────────────────────────────────────┘
```

- **条目 = 时间戳 + 观察正文 + 来源指引**。来源行显示触发该笔记的 advise 提问的
  **短摘录**(前 ~60 字符),点击跳 Room tab(v1 不回放历史会话,只切屏;历史回放超范围)。
- 数据契约(对 feat/033 的期望,露出层假设):`{ id, created_at, text, source_question_excerpt? }`,
  经 `/team/{id}` 或独立读路径随 context 返回;store 挂 `team.notes` 或平行字段,`refreshTeam` 带回。
- 分组折叠复用 TeamScreen 的 `PeopleGroup` 交互模式(`.home-people-group-head` 的
  aria-expanded 折叠头):按天分组,今天默认展开,往前默认收起——**越用越厚**的视觉即
  "折叠组越排越长",不用发明新机制。
- **只读**:条目不是 button、无编辑/删除 affordance(区别于人卡可点开浮层)。整屏零输入控件。

## 3 · 增长态与空态

- **空态**(还没笔记):复用 `.nexus-empty` + Playbooks 空态模式(eyebrow/h2/body/预告槽)。
  引导指向动作:"去 The room 问一个真实的管理问题,Avery 会把它观察到的记下来"+ 一个
  跳 Room 的按钮(复用 `.home-map-card-link` 或 `.upload-choose` 样式)。
- **增长感知**:① 头部计数行 `N observations · since <首条日期>`;② 按天分组的时间纵深;
  ③ 最新一条带 `is-new` 高亮(终端 `.terminal-line.is-new` 已有同名先例);
  ④ **Room 内 nudge**:一次 advise 完成且后端确认新笔记落库后,在 advice 卡下方出一个小 chip
  (样式对齐 `.lite-metric-chip` / `.upload-source-chip`):"Avery added a note → " 点击切到 notes tab。
- **降级诚实**:若该轮 advise 的观察被红线门丢弃(后端不落库),**不出 nudge、不显示占位**——
  绝不渲染"它本想写什么"。

## 4 · 红线在 UI 层的表达(信任说明)

- notes 屏 lede 下方**常驻**一条信任说明(样式复用 `.upload-privacy-note` 的静音小字,
  可命名 `.lite-notes-redline-note`),EN 见 §5 `notesRedlineNote`。
- 措辞与既有口径对齐(en.ts 已有三处同族:`upload.privacyNote`、`emptyHintPrivacy`、
  `visionProofRedline`),强调**确定性门**而非"我们尽量":never scored / ranked / profiled,
  且 "no instruction can turn that off"。
- 该说明同时链接到「数据处理说明」页(见姊妹稿 data-handling-copy-draft.md)。

## 5 · EN 文案初稿(全走 `t.lite.*`;中文后续 M3,不在此稿)

```ts
tabNotes: "Avery's notes",
notesEyebrow: 'Field notes',
notesTitle: 'What Avery has noticed about your company',
notesLede:
  "Every time you ask the room a real question, Avery writes down what it observed — in its own words, for you to read. It builds up the longer you work together.",
notesRedlineNote:
  'These notes describe work — projects, handoffs, load. They never score, rank, or profile a person, and no instruction can turn that off.',
notesCountSince: 'observations · since',        // "12 observations · since Mar 3"
notesToday: 'Today',
notesSourcePrefix: 'From your question about',   // + 摘录 + " →"
notesOpenRoom: 'Open the room →',
notesEmptyEyebrow: 'Nothing written yet',
notesEmptyTitle: "Avery hasn't taken its first note",
notesEmptyBody:
  'Ask the room a real question about your team. When Avery notices something worth keeping — a pattern, a risk, a dependency — it writes it here.',
notesEmptyCta: 'Ask the room',
notesNudge: 'Avery added a note',                 // Room 内 chip
```

## 6 · 与现有视觉语言的贴合点

| 用途 | 复用 |
|---|---|
| 屏外壳/标题层级 | `.scene.scene-nexus.is-active` + `.eyebrow` + `h2` + `.lite-vision-lede` 同级 lede |
| 空态 | `.nexus-empty`(PlaybooksScreen 先例) |
| 分组折叠 | `PeopleGroup` 交互模式(`.home-people-group-head`,aria-expanded) |
| nudge chip | `.lite-metric-chip` / `.upload-source-chip` 视觉族 |
| 信任小字 | `.upload-privacy-note` 同款静音层级 |
| 新条目高亮 | `is-new` 惯例(nexus 终端已有) |
| 导航 | `LiteTopbar` tabs 数组 + `useLite.goScreen`;所有 copy 走 `useDict` |

墙照旧:不 import `src/story/**`;新样式进 `src/lite/styles/lite.css`,类名 `lite-notes-*` 前缀。

## 7 · 留给 Danny 的口味决策点

1. **tab 名与排序**:"Avery's notes" vs "Notebook" vs "Memory";放 Room 后(本稿推荐)还是最右?
   5 个 tab 是否已嫌挤(替代:并入 Vision 屏做真实区块)?
2. **来源摘录的露出度**:来源行显示提问摘录(本稿推荐)还是只显时间戳?摘录会把提问原文
   回显在笔记屏——有的 manager 可能不想同事围观时看到自己问过什么。
3. **Room nudge 的形态与有无**:advise 后出"Avery added a note"chip(本稿推荐)/ 完全不打扰,
   让用户自己发现笔记 tab(更克制,但增长感知弱)。
4. (半个)**条目删除**:v1 只读零删除(本稿假设,与数据处理稿"联系我们删除"一致)——若 Danny
   想给"整本清空"逃生门,需要 feat/033 加删除端点,两稿同步更新。
