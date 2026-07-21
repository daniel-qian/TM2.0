# ADR-0026 · onboarding 全屏闸门页 + 克隆制一键示例团队

- 状态：已采纳（Danny 2026-07-21 拍板「onboarding 不要浮层，单独一个页面作为闸门；
  一键示例团队放进前置 onboarding；参照 command-room 藏在 /companyinput 的独立页」）
- 日期：2026-07-21
- 关联：ADR-0025（cr 对齐棒 r1）、`.issues/cr-align-0721/decisions.md` 拍板 3A/8A、
  `.issues/input-side-0721/plan.md`

## 决策 1 · onboarding 形态：浮层对话框 → 全屏闸门页（底座不换）

OnboardWizard（LiteModal 浮窗，可 × 掉）改为 OnboardGate：新访客先过门再进指挥室。
**实现上刻意保留 LiteModal 底座**，整页观感全部由 `layerClassName="lite-gate-layer"` 的
CSS 承担（遮罩变整幅不透明底/aurora 渐变，面板变页面居中卡）：

- 为什么不做成路由页：cr 的 /companyinput 也不过是「fixed inset-0 全屏盖」——URL 不是
  这个体验的组成部分；做成路由要动 SCREEN_PATH/重定向/query 粘性三处，而 ~20 道既有门
  全部依赖「Escape 收起后底下 shell 立即可用」的浮层语义。底座不换 = Escape/滚动锁/焦点圈/
  层栈四件全保留，门电池近乎零迁移。
- a11y 上 aria-modal 仍是诚实描述（它确实盖住一切、focus 圈在门内）。
- 点背景关闭**关掉**（closeOnBackdrop=false）：整页世界里「背景」是页面本身。键盘退路归
  Escape（pause），可见退路归右上「先随便看看」（同一 pause 语义），skip-forever 留在页脚。
- 生命周期语义零变化：有数据不弹（hadContextOnLoad）/ skipped 永不弹 / pause 续进度 /
  reopen 重看（现在从三扇门起）。

## 决策 2 · 步骤 4→5：新第 0 步「三扇门」

①一键示例团队（主推，见决策 3）②上传自己的材料（原步进）③先随便看看（pause）。
红线不动：不做假「连接工具」步（cr 那步是纯假 toggle，不抄）、不做假「创建账号」步
（真账号在 AuthPanel）。示例门只在 `GET /demo/status` 探到 available 时渲染——不出假按钮。

## 决策 3 · 示例团队 = 服务端预铸母本 + 每访客克隆（不是共享、不是只读）

`POST /demo/claim`：后端从 `AVERY_DEMO_SEED_DIR` 的 seed 文件**自铸**母本 context
（首 claim 时，锁防双铸；离线门=heuristic 秒出，生产=LLM 一次），此后每次 claim 用
`registry.clone_context` 复制成访客私有副本（新 context_id + 新 owner_token）。

- 为什么不共享：/advise 落笔记、/ask 落行——共享 token = 访客互相写脏示例。
- 为什么不只读：只读特判要撒进每个写端点，还防不住下一个新写端点；克隆一处收口。
- pg 克隆是 SQL 级 INSERT..SELECT（不走 get()+put() 重组）：embedding 列原样抄
  （不再烧一遍 DashScope）、source_documents 的 bytea 原样抄（get() 刻意不拉字节，
  重组会造出「列得出、下载不到」的文件清单）。合约钉死在 test_registry_contract.py。
- 母本 owner_token 铸完即弃——没有 HTTP 路径能读母本，它只被克隆。
- 母本自带一条「实时数据缺位」预铸笔记（Danny 3A 附注），克隆继承。
- 母本 id 内容寻址（`ctx_demo_<sha1(文件名:大小)>`）：seed 换了自动重铸，不删旧行；
  `AVERY_DEMO_CONTEXT_ID` 可显式钉死。限流表盘 `AVERY_RATE_DEMO_PER_MIN`（默认关）。

## 决策 4 · 8A 采集：「公司现状」口述送 company_notes，承诺文案同棒改口

团队信息步扩展（人数/职位仍本机），新增「公司现状」textarea——**唯一送后端的一格**
（`POST /team/{id}/notes`，owner_token 门后，写侧红线原样）。送出走「context 落地即送」
的订阅线（onboardNote.ts，幂等账本 companyNoteSentTo）：先跳过上传、几天后才传文件的人
也不丢。`onboardTeamBody` 的「不会发到任何地方」旧承诺同棒改成逐字段分界
（en+zh，注释拦着别抄回来）——机制与文案同一个 commit，不存在文案先撒谎的窗口。

## 后果

- 首访第一眼从「产品硬塞的弹窗」变成「先选路再进门」；投资人 30 秒路径 = 示例门。
- 每个 demo 访客一份克隆副本会在库里累积（含 seed bytea）。可接受：副本小（~几百 KB），
  且有限流表盘；将来可加过期清扫（**删除类动作，届时找 Danny 批**）。
- 门电池迁移面：verify-onboarding-returning（首步 doors）、live-frontend-gate.snippet
  （walkthrough 先过上传门）两处；新门 verify-onboard-gate.mjs（39 判据，五世界）。
