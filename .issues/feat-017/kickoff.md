# feat-017 Kickoff — Frontend graduate → Avery Live

> 依赖 feat-015 + feat-016。把 Vite demo 毕业成真产品（ADR-0020）。

## 目标
两道数据 seam；live mode 接真 agent（feat-015）+ 真 ingestion（feat-016）；story mode 原样保留（路演/视频）。

## 先读
- **施工图（必读第一份）**：`docs/strategy/2026-07-05-real-integration-map.md`——§2 逐表面集成契约（现脚本源→live 真源，表 #1–12）· §3 seam 两侧数据形 · §4 v1 范围 · §5 红线。
- `docs/adr/0020-*`（全篇，尤其 seam + 保留 story mode + 保留回放机器）· 战略 doc §3 · `CONTEXT.md` **Avery Live** / **Story mode / Live mode**
- `src/components/scenes/{NexusScene,HomeScene}.tsx` · `src/data/{cases.ts,fixtures.home.ts}` · `src/store/{canvasStore,homeStore,railStore}.ts` · `src/components/TeamComposer.tsx` · `landing/scripts/i18n-zh.mjs`（i18n 模式）

## Scope
1. **`StreamSource` seam**（Nexus 终端）：抽接口，两实现——`ScriptedSource`（现 `cases.ts` stream，story）+ `LiveAgentSource`（SSE 调 feat-015 `/advise`，live）。终端组件只认接口。
2. **`TeamDataSource` seam**（Your team）：抽接口，两实现——`ScriptedSource`（`fixtures.home.ts`，story）+ `LiveTeamSource`（feat-016 ingestion 产出，live）。
3. **上传 UI**：live mode 下传文件 → 调 ingestion → Your team 长出来。
4. **`?mode=story|live` 开关**，默认 live（部署）；story 供路演/视频。
5. **i18n**：文案外置 en/zh（复用 landing 模式 + M3）。
6. **不动 rail 回放机器**：story mode = 现机器原样（守 ADR-0003/0006/0012/0013/0014）。

**v1 范围（施工图 §4，R3 拍板）**：live 必达 = Onboarding 真解析 + Your team 人卡/项目卡 + Nexus 终端流 + 8 字段卡 + Briefing。**弱版 reality-gap（R1：文档内 mismatch）**；聚合数字按 **R2**（真算或不显示，绝不编）。**story-only**：满血 signal-driven reality-gap。**v2**：多人 in-thread Chat、Team map 关系+focus、详情页 follow-up。

## AFK 验证门
- live 源打桩成确定性 → DOM 断言：上传→人卡/项目卡渲染、打字→终端流帧、8 字段卡、**红线扫描 live 产出零 %**。
- **story mode 回归**：现有 rail 26 拍 DOM 断言全过（不回退）。
- `./init.sh` 绿（tsc -b + vite build）。
- 已知坑：headless rAF 停摆——动画手感归 Danny 真机；静态样式用 `transition:none` 旁路断言。

## DoD / HITL
- 双模都跑、seam 干净隔离、`init.sh` 绿、故事回归绿。
- 全部新 live user-facing 英文 copy `⚠ 待 Danny 审字`；中文经 M3。
- Danny 真机目测动画手感 + "上传→长出"的手感。
