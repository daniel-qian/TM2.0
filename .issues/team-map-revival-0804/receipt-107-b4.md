# 回执 · #107 B4 部门收拢态（2026-08-19）

票面原是「缓建，触发＝首个 40 人以上真租户」。kickoff 两条拍板改了前提：

```
① 现在做，理由换成「首次碰面要演示」——B1 那份 80 人合成 fixture 是现成的大团队素材。
② 火情判据 = 警报药丸那把尺（blocked / at-risk，复用 B3 的 isNeedsYouStatus）。
```

四件全做完：布局层 · 渲染层 · 开局镜头对火情 · 项目列同步。门 80 条、变异 9 发、像素 8 张。

---

## ① 一处对票面的偏离（已知会）

票面：「每部门一张卡：**人数** + 组级定性读数 + 警报角标」。**人数没做。**

- B3 已上线的判据 F1 逐字写着「chip 上零数字——**没有部门人数，那是一张人数排行榜**」；
- ADR-0023 明禁跨人计数（`zoneRead.ts` 连「有几个人报了吃紧」都拒绝返回）。

票面写在 B3 之前。冲突时按红线走：收拢卡上不印人数，**块头也不表达人数**（所有卡等高
`ZONE_COLLAPSED_H`）。规模差异留给展开之后的行数。要推翻改一个常量。

---

## ② 四件是**耦合**的，验收时才发现

第一刀（布局层）写了条判据「收拢之后 board 应该矮得多」——实测 board 高度**一个像素都没变**
（2522 → 2522）：`boardSizeOf` 取 `max(名册高, 项目列高)`，24 条项目那一列本来就比名册高。

⇒ **收拢部门单独做不出可读性。** 项目列收掉 4 件已完结再省 400px（2122），仍然由项目列主导。
真正让大团队一屏读得完的是**开局镜头不框全员**。三件缺一件这一态都不成立——判据注释里记着。

## ③ 落地口径

- **收拢**：`buildMapLayout(people, projects, { allowCollapse, expandedZoneKey })`，
  人数 ≥ `COLLAPSE_MIN_PEOPLE`(40)。🔴 收拢**不改契约**：`zone.members` 一个人都不少，
  只是 pos 全落卡心 ⇒ 连线仍从项目条连到那张部门卡、`focusBounds` 仍框得住，
  `mapFocus` / `MapEdges` 一条「收拢了就特殊处理」的分支都不用加。
- **展开**复用 `?focus=zone:<key>`：同一个 token 小团队里是「点亮这一组」、大团队里顺带铺开它
  ⇒ **展开了哪个部门跟着一起可分享**，零新增状态。查无此部门 → 老实全收拢。
- **收拢卡是 `<button>`，铺开的仍是 `<div>`**。不能一律 button：铺开的卡里站着可点的人节点、
  mini 卡里还有链接，按钮套按钮是 B2 立的 HTML 硬约束。收拢的卡里什么都没有，当按钮于是
  白拿键盘与读屏路径。
- **pointer-events 只给 button 那一版开**。分区层整层 `pointer-events: none`（B2 那段碑写着
  「点分区卡=点空白」，并预告了「B4 要点它时单独开口子」）。开成
  `.lite-map-zone { pointer-events: auto }` 会当场毁掉铺开态的「点部门卡空白处回 calm」。
- **项目列**：收拢态下默认只铺没完结的 + 一枚开关。🔴 只折 `done`；`unknown`（资料没写状态）
  照铺——把「没写」和「做完了」折进同一个抽屉是替文档下了它没下的结论。🔴 被深链点名的那条
  永远留着，哪怕已完结（折叠是视图不是删除）。只在收拢态生效，小团队一个像素不动。
- **开局镜头**：框住有「需要你出手」项目的那几个部门。一个都没着火 ⇒ 照旧 fit-width，
  **不退化成「框第一个部门」**——那会让「今天没什么要紧事」长得跟「这个部门出事了」一样。
  有 focus 时不介入（深链归 focusRect）。「复位视野」仍然回全景：开局帧答的是「今天该看哪儿」，
  复位答的是「这家公司长什么样」。

---

## ④ 两处是**真机截图**逼出来的，不是想出来的

| 症状 | 改法 |
| --- | --- |
| 桌面顶着一条 200px 空白带（火情区只占板上半，上下都居中） | 水平居中 + **垂直顶锚**，跟 fit-width 初始帧同口径（ADR-0012 修订 6） |
| **手机整个塌掉**：火情区横跨三列约 1300px，390 竖屏要缩到 0.28 倍，九张卡成一排指甲盖 | 开局帧守 `MIN_FIT_SCALE`；装不下就只框一部分、左上角对齐，其余靠 pan |

桌面上同一份代码看着挺好——「桌面绿≠手机绿」的又一次实收。

---

## ⑤ 门：J 段 15 条（verify-team-map.mjs，全门 **80 PASS · 0 FAIL**）

🔴 **换语料**：上面全程跑真上传的 demo-seed（16 人），而收拢门槛 40——用那份语料一条 B4
判据都够不着。所以把 80 人 fixture 在 Node 侧过真 derive 之后灌 `__lite2Store`，并显式把
`scoring_enabled` 翻成 true（fixture 自带 false，不翻的话「收拢卡带组级读数」会以
「读数没渲染」的形态假红，而病根在语料不在代码）。

J1 收拢/零人位/真按钮 · J2 角标 = 门这侧独立手算的 needsYou 数 · J3 角标之外零数字 ·
J4 默认收完结 + 显示全部回来 · J5 原位展开四条 · J6 开局帧冲火情 + 守地板。

## ⑥ 变异 9 发，逼出**三个门洞**——都不是代码 bug，是判据 bug

| # | 变异 | 第一轮结果 |
| --- | --- | --- |
| N08 | 开局帧退回 fit | **存活** |
| N09 | 拿掉可读地板 | **存活** |
| N05 | 角标改印人数 | J3 绿、J2 红 |
| N01/02/03 | 三发收拢相关 | J1 红了，但门随后**崩掉** |

三处修的都是门：

1. 🔴 **J6 两条判据都放错了视口**。桌面：开局帧 0.71 / fit 0.60 两者不同，但**都框得住**火情
   （这份语料的火情恰好起于板左上角），而地板根本不绑；手机：地板真绑住，可两帧重合。
   **一条判据放错视口，就是一条永远绿的判据。** 现在「冲不冲火情」在桌面量（判据落在
   「比 fit 更近」上，不落「在不在画面里」——后者实测两帧都成立，已在判据名里写明），
   「守不守地板」在手机量。
2. 🔴 **J3 的名字 overclaim**。它把 `.lite-map-zone-alert` 整块摘掉再扫数字，于是「角标里印的是
   人数不是项目数」它一个字看不见。名字改成**「角标之外」**，角标里那个数由 J2 逐值守。
   判据够不着就把射程写进名字，别让宽名字盖着窄判据。
3. 🔴 **门会被变异炸掉**。收拢态没出现时 locator 一直重试到超时，J4/J5/J6 一条都不跑，
   报告只剩半页——而崩掉的门和「一条都没红」在跑器眼里一样（B3 的 M01 同款）。
   点击改成吞超时 + 选择器不带 `button`，红在「没展开」上而不是炸。

修完复跑：**9 发发发红在自己那条判据上**，还原逐字节干净。

顺带修一处**真 bug**（门的几何尺 E2 逮的）：警报角标一度也渲染进**铺开态**的卡，而布局公式
只给卡头留了 46px，第三行直接压在第一排人像上。角标现在只长在收拢卡上。

## ⑦ 像素基线：8 张（`visual-map-collapsed.spec.mjs`）

2 态 × 2 皮 × 2 视口。单独一个 spec——同目录 `visual-map` 拍的 16 人语料永远进不了收拢态，
硬塞一起会让两种形态互相殃及（「首处不匹配即中止」那条老毛病，#68/#79 各栽过一次）。
**不上传也不吃后端**：fixture 直接灌 store。三条自证（真收拢 / 零人位 / 角标在画面里）挡住
「拍了一张看着还像地图、却把 B4 整层拍没了」。
⚠ 要预置 onboarding 已看过：闸门半透明，第一张图照拍，第二步点卡时才以
`.lite-modal-backdrop intercepts pointer events` 超时——像收拢卡不可点，其实不是。

**存量 66 张零漂移**（B4 全部改动都挂在收拢态上，小团队那条路一个像素没动），
现共 **74 张**，8 张新的两皮两视口人眼过。

## 跑法

```bash
cd eval-harness && AVERY_BRAIN=mock AVERY_EXTRACTOR=heuristic AVERY_EMBEDDINGS=keyword \
  AVERY_DEMO_SEED_DIR=tests/fixtures/demo-seed AVERY_ALLOW_PERSON_SCORING=1 \
  python -m uvicorn service.app:app --port 8137
```
前端 build+preview（dist 要 bake 到那条后端），然后
`node eval-harness/tools/verify-team-map.mjs` ·
`node .issues/team-map-revival-0804/check-collapse-b4.mjs`（26 条纯函数）·
`node .issues/team-map-revival-0804/mutants-b4.mjs`（9 发，每发重打 dist）。

## 文件

**改**：`src/lite2/map/{mapLayout.ts,MapScreen.tsx,MapNodes.tsx,MapPanZoom.tsx,MapHud.tsx}` ·
`src/lite2/styles/lite2.css` · `src/shared/i18n/{en,zh}.ts`（3 对新键）·
`eval-harness/tools/{verify-team-map.mjs,run-battery.mjs}`
**新**：`eval-harness/visual/visual-map-collapsed.spec.mjs` ·
`.issues/team-map-revival-0804/{check-collapse-b4.mjs,mutants-b4.mjs,receipt-107-b4.md}`
