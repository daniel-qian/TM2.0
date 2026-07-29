# 资料库战役（files-hub-0729）· PRD

**状态**：Danny 2026-07-29 盘问定稿（grilling ×3 轮，逐项拍板）。前置侦察全在
`.issues/feedback-0729/persona-review-0729.md` 与 07-29 侦察（上传散三屏四点两套实现/
文件管理只有只读清单/后端写端点全缺/多库切换 store 现成）。

**票已开齐（2026-07-29，`/to-issues`）** —— GitHub `daniel-qian/avery`，父票
[#21](https://github.com/daniel-qian/avery/issues/21)：

| 票 | 内容 | 阻塞于 | 标签 |
| --- | --- | --- | --- |
| [#22](https://github.com/daniel-qian/avery/issues/22) | 01 资料库屏本体 + tab 换防 | — | ready-for-agent |
| [#23](https://github.com/daniel-qian/avery/issues/23) | 02 多库切换 UI | #22 | ready-for-agent |
| [#24](https://github.com/daniel-qian/avery/issues/24) | 03 团队屏零文件元素 + 入口铺设 | #22 | ready-for-agent |
| [#25](https://github.com/daniel-qian/avery/issues/25) | 04 收官 | #22 #23 #24 | ready-for-agent |
| [#26](https://github.com/daniel-qian/avery/issues/26) | T1 笔记升级真记忆 | — | ready-for-agent |
| [#27](https://github.com/daniel-qian/avery/issues/27) | T2 两套上传实现合一 | — | ready-for-agent |
| [#28](https://github.com/daniel-qian/avery/issues/28) | T3 后端文件写端点批 | — | ready-for-agent |
| [#29](https://github.com/daniel-qian/avery/issues/29) | T4 tab 合并观察票 | 等真用户反馈 | needs-triage |

## 拍板记录（8 项，全部 Danny 口径）

1. **「资料库 / Files」升第 10 个 tab**，同时**砍「完整版预告」tab**（降设置菜单，照
   /paperwork 待遇，页面保留可达）→ 净回 9 个 tab。资料库顶队尾位。
2. **v1 范围**（前端集中批）：①文件清单+逐份下载（GET /team/{id}/files/{idx} 现成，
   前端从未接）②多库切换 UI（switchContext/forgetContext/knownContexts 三件套现成只差渲染）
   ③上传入口集中进资料库+诚实文案。**不做**：删除/重传/替换（后端端点缺，按不建假按钮
   红线 UI 上不出现）。
3. **页名「资料库 / Files」**——与首页「资料概览」同词族。
4. **愿景界线**：v1 只管用户上传的文件；「agent 自己的文件空间」愿景继续留 Vision 页当
   诚实预告，**不许**把愿景容器混进 v1。
5. **团队屏彻底零文件元素**（Danny 原话「团队和项目应该只分析团队和项目」）：满态右栏
   只剩成员；空态换引导卡 CTA 去资料库。
6. **首页骨架保留上传卡**（首访第一动作不多跳）+ 卡底加「去资料库管理 →」链接。
7. **「Avery 的笔记」升级成真记忆**——现状是单向观察日志（append_note 不回流 recall，
   后续回答引用不到自己的笔记；「越合作越厚」文案的暗示是假的）。拍板：回流检索层。
   **单独排票，不进本战役。**
8. **tab 合并本战役不做**（笔记→问 Avery、值得注意→待办 两个候选开观察票等用户反馈；
   feat-057「聚合与分屏两极都要」旧拍板此轮不推翻）。

## 切片（串行，下个 session 执行）

### 01 · 资料库屏本体 + tab 换防
- 新屏 `src/lite2/screens/FilesScreen.tsx`，route `/files` 进 `LiteScreen` 联合类型 + tab 队尾。
- 内容三段：**当前资料**（文件行：名/大小/引用数/状态循环——复用 UploadPanel「你的文件」
  段的展示逻辑，抽成共享件；每行「下载」——⚠ 端点吃 owner_token 鉴权，裸 `<a href>` 带不上，
  走 fetch+blob+objectURL）；**上传新一批**（UploadPanel 整件搬入 + 🔴 诚实文案：「再传一批
  会另建一份画像，当前这份不会合并；可从下面列表切回」——顺手修掉团队屏注释「可加文件」
  的假话）；**（02 的多库切换区占位）**。
- 「完整版预告」出 tab：tabs 数组删 vision 行；设置菜单加入口（照 paperwork 行样式，
  `visionHref()` 带粘性 query）；vision 路由/页面原样保留。
- 🔴 门同 commit 联动（改名战役同款纪律）：`assertV2Boots` expected 数组
  （-"What's coming" +"Files"，位置队尾）+ expectedSubs；snippet 里 vision 相位
  `_clickTab("What's coming")`（:809 区）改 URL 直达；`assertV1Untouched` 不涉。
  注意 assertV2Boots 注释里 feat-057「7 分屏不退休」裁定——vision 不属七分屏（feat-026
  叙事页），删 tab 不违裁定，注释同步改写免误导后人。
- i18n：tabFiles + 屏内键（en 源 → zh 导演手改，短键先例）；生成器锁定词族补「资料库」。
- 新 ADR（0032）：tab 换防 + 资料库定位；CONTEXT.md 补 surface label。

### 02 · 多库切换 UI
- 资料库屏第三段「你上传过的几批」：KnownContext{id, files[], at} 渲染（文件名+日期即标签，
  demo 克隆批次天然带示例文件名可辨）；当前批标记；每行「切换」（吃 switchPending 置灰——
  store 注释明说 UI 必须挡双击）+「从列表移除」（🔴 只许显式点击触发 forgetContext，
  错误路径绝不自动调）；switchError 诚实报错。
- 门：新 e2e（上传两批 → 名册两条 → 切回第一批 → team 数据换回 → 移除一条）。

### 03 · 团队屏零文件元素 + 入口铺设
- TeamScreen 满态/空态两个 UploadPanel 渲染点全撤：满态右栏只剩 `.home-lanes` 成员；
  空态换引导卡（文案 + CTA 「去资料库上传」）。
- 首页骨架上传卡保留 + 「去资料库管理 →」链接；首页「资料概览」板块标题行加链接。
- 🔴 门波及（侦察实据，执行时逐个过）：snippet `filesSurfaceV2` 相位（现断言团队屏
  UploadPanel 文件清单）→ 改指 /files；`readSkinProbe`（点团队屏读 `.upload-panel` 圆角）
  → 改在 /files 读；verify-file-manifest-truth / onboarding-returning 走 store.uploadFiles
  屏无关（复核即可）；verify-topbar-clearance 团队屏几何重量；团队屏像素基线重冻。
- OnboardGate 上传步不动（引导闸自有实现，合一另票）。

### 04 · 收官
全电池（26 道，A 区名单如有新门先入册）两轮零红 + 像素重冻晨审 + 验收手册 + handoff。

## 单独排票（不进本战役，票开在 issues/ 下）
- **T1 笔记升级真记忆**：append_note 时同步回流检索层（notes.md 或等价），后续回答可 cite
  自己的观察；写侧红线复验路径不变；「越合作越厚」文案随实现成真。
- **T2 两套上传实现合一**：UploadPanel 与 OnboardGate.StepUpload 去重（现双份维护注释
  明写「必须一字不差」）。
- **T3 后端文件写端点批**：DELETE 单文件（连带清 chunk）/ DELETE 整库 / 追加上传
  （动 ingest_docs 语义）/ 替换；⚠ 先给 SourceDocument 稳定 id（现按数组下标寻址，
  一支持删除下标就漂）。
- **T4 tab 合并观察票**：候选=笔记→问 Avery、值得注意→待办；等真用户反馈，动前须
  推翻 feat-057 拍板（开 ADR）。

## 环境与纪律（下个 session 冷启动直用）
- 跑法全在 `.issues/rich-align-0722/runbook.md` + 记忆条目（build+preview/--host/mock 三件套/
  四 deselect/电池 A→B→C 独占）。
- push=上产人工闸；zh 文案 en 源+导演手改先例；absent≠none；不建假按钮。
- ⚠ 本 PRD 定稿时 main 已含 07-29 两战役 6 commit（未推）——资料库战役基于其上开发。
