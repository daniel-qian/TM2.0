# 满态对齐战役 · issues 执行总序

> 依据：prd.md（07-22 盘问定稿共识 1-12）+ runbook.md。执行形态：Danny 一个 AFK 夜晚 session **01→11 严格串行**跑完；commit 攒在 `claude/layout-real-components-27b594`，push=人工闸。

## 总序与规模

规模口径：S=半小时量级；M=1-2 小时；L=3 小时+（含 AFK 自验自修循环）。

| # | 片 | 规模 | Blocked by | spec stick |
|---|---|---|---|---|
| 01 | 富字段·进度/风险（项目）——**字段语法全表在此定稿** | L | None | 6 |
| 02 | 富字段·里程碑 | M | 01 | 7 |
| 03 | 人员负载/情绪·开关口径（最重的门改造） | L | 01 | 8（如需） |
| 04 | team 屏目录化 | M | 03 | 9 |
| 05 | 真 CRUD·项目（写端点先例落地） | L | 01、02 | 10（如需） |
| 06 | 真 CRUD·人员 | M | 03、04、05 | 11（如需） |
| 07 | 三亚富语料 pack（16 人/6 项目/SOP） | L | 01、02、03 | — |
| 08 | playbooks 方法库 | M | 07 | 12 |
| 09 | 重新开始+演示控制闭环 | M | 07 | — |
| 10 | 登录隔离演示线 | S | None（序排 09 后） | — |
| 11 | 收官（全电池两轮+对照板+像素人审+验收表单+handoff） | M | 01–10 全部 | 全量 |

## 电池纪律提醒（🔴 runbook §1 一字不改，此处只是提醒）

- **电池名单唯一权威 = `eval-harness/tools/run-battery.mjs`（A 19 / B 3 / C 3 = 25 门）**；收官命令 `SPEC_STICK=99 node eval-harness/tools/run-battery.mjs` 连续两轮零红。
- **改完一片只跑相关门**：该片 Acceptance 列出的门 + 「波及面」列出的被波及门；**全量电池只在 11 收官跑，且连续两轮零红**。
- **三段序 A→B→C**：C 区 dist 调包者（verify-auth-capability / verify-auth-form / verify-bundle-privacy）**殿后**，跑完**必须重建 dev dist** 再干别的（bundle-privacy 最毒：跑完 dist 指生产域名，再碰上传路径=写生产库）。片内如需 C 区门（09/10），同样殿后+重建。
- **电池独占**：绝不与 agent/subagent 并发，并发=假红超时。
- **spec→门→码**：每片先落 cr-align-spec 行（stick 6 起每棒一号，分配见上表）再写码；禁反向抄构建值。
- **后端**：改 service/*.py 必杀 8137 重起才生效；mock 三件套 env 缺一真出网烧钱。
- **前端**：tsc -b + vite build + vite preview（禁 npm install / npm run build 之外的重装）；入口 URL 必带 `?v=2&mode=live&lang=zh`。
- **像素**（07-22 裁决后的统一口径，同 runbook §1）：片内 agent 目检 diff → diff png+目检结论存档 `eval-harness/reports/pixel-evidence/<片号>/` → 备份旧基线（同目录 `.bak/`）→ `--update-snapshots` 重冻改动屏 → 片内像素门复绿；11 收官全量两轮零红（含像素门）；Danny 晨审=acceptance-1.md 附 pixel-evidence 索引签认（人工闸移到晨审签认，push 人工闸不动）。
- **扫雷**：每片正式跑看 NEW 台账；`--selftest` 8 PASS 是硬门；收官清账 0/0。
- 测「从头开始」类行为用无痕窗/清键（localStorage `lite2:` 自动恢复陷阱）。
- **新探针落点**：本战役新写探针一律落 `.issues/rich-align-0722/verify-*.mjs`（tracked，不入电池 roster）。
- **「薄文档」指名**：`eval-harness/tests/fixtures/seed/` 的 LogiPulse-Roadmap.pdf + PrismDesign_TeamProfile_EN.xlsx；英文文档只做降级断言、不进 zh-purity 考察面。
