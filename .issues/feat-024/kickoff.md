# feat-024 kickoff — story/lite 同仓立墙 + lite 3 屏壳(修绿 feat-022 前端断言)

冷启动三件:① 读 `.issues/live-rescue-0707/plan.md`(§0 + §S2)② 读 ADR-0022 决策 1 ③ 读根 `session-handoff.md`(07-07 收盘版)三个渗漏机制。

一句话:`src/story/**`(fixtures/cases/rail/满血场景,冻结资产)/ `src/lite/**`(3 屏:上传空态 · Your team · The room 薄建 + 薄只读详情浮层,零 fixtures)/ `src/shared/**`(卡片/字体/CSS 原子);ESLint `no-restricted-imports` 把 lite→story import 变红灯。composer 接 askLive;live 空态左脊柱不渲染 scripted 占位;HOME_CLOSING 类 story 文案出 lite。

硬门:feat-022 前端断言全绿(story 名词黑名单=0)**且** story 回归(rail 26 拍)仍绿;story 资产 URL/构建不变。红线:人卡永不渲染数字。坑:`.prototype-topbar` pointer-events 模式(新可点子元素各自 auto);headless rAF;global.css 拆分时 light/dark 嵌套段小心(52ecfb5 教训)。EN copy act-first 定稿,ZH 走 M3。
