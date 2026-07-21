# 顶栏宽度预算实测（决定「顶栏真搜索」能不能放、放多宽）

> 实测环境：:5173 preview，zh，paper 皮，示例团队已进。浏览器面板 `document.documentElement.clientWidth = 971px`。

## 现状（我方 `.prototype-topbar`）

| 项 | 值 |
|---|---|
| 定位 | `position: fixed; top: 14px; z-index: 50`（左 24px，宽 = 视口 − 48） |
| 实测 rect | `left 24 · top 14 · width 923 · height 64` |
| 布局 | `display:flex; gap:12px; padding:8px 14px` |
| 子元素 | `.scene-tabs` **772px** · `.lite-bell` 32px · `.lite-settings` 30px |
| **tab 条自然宽（zh，9 tab）** | **`scrollWidth = 770px`** |
| 当前溢出 | 0（971px 视口下不溢出） |

→ 我方顶栏几何**已经和她对齐**（她：`fixed top-3.5 · w-[min(1480px,calc(100vw-48px))] · z-50 · gap-3 · px-4 py-2.5`）。
本战役顶栏不需要重排，只需要**插一个搜索块**。

## 🔴 硬约束：`.scene-tabs` 是横向滚动容器

`lite2.css:4830-4846`（feat-055 修正）：9 个 tab 在窄视口会撑破文档，所以给 tab 条自己加了
`overflow-x:auto`，且 `.scene-tab { flex: 0 0 auto; white-space: nowrap }`——**tab 永不压缩、永不换行，宁可滑**。

→ 后果：**搜索框每抢一像素，tab 条就直接开始隐藏 tab**（不是变窄，是滑出可视区）。
这是可用性事故，不是观感问题。所以搜索框**必须有断点闸**。

## 宽度预算算式

```
可用内宽 = 视口宽 − 48（左右留白） − 28（padding 8px 14px 的左右）
已占用   = tabs 770(zh) + bell 32 + settings 30 + gap 12×N
```

| 视口宽 | 可用内宽 | 已占用（3 块 + 2 gap = 856） | **剩余给搜索** | 结论 |
|---|---|---|---|---|
| 1024 | 948 | 856 | 92 − 12(新 gap) = **80px** | ❌ 放不下 |
| 1280 | 1204 | 856 | 348 − 12 = **336px** | ✅ 宽裕 |
| 1440 | 1364 | 856 | 508 − 12 = **496px** | ✅ 宽裕 |
| 1480+（外夹封顶） | 1404 | 856 | 548 − 12 = **536px** | ✅ 宽裕 |

## 裁决

1. **断点 = 1280px**，与她的 `hidden xl:block`（Tailwind xl = 1280px）**完全一致** —— 她也是在
   窄屏直接不给搜索。这不是抄，是同一个几何约束推出的同一个答案。
2. **搜索块宽度 220–260px**（1280px 时剩 336px，留 76–116px 余量给 en 的更宽 tab 条）。
3. 搜索块必须 `flex: 0 0 auto` 或定宽，**不能 `flex:1`** —— 否则会在中间宽度反过来压 tab 条。
4. 搜索块自己要 `pointer-events: auto`（`.prototype-topbar` 是 `pointer-events:none` 容器，
   `.scene-tabs`/`.lite-bell`/`.lite-settings` 各自 auto 回来，见 lite2.css:548-550、2825、4087、5077 的三处同款注释——新块照这个老规矩自己补，**不动 shared/00-base.css**）。

## ⚠️ 待实测（棒C 起手第一件事）

- **en 下 9 个 tab 的 `scrollWidth`**（zh 是 770px；AGENTS.md 记过 en 比 zh 长得多——
  390px 视口下 zh 溢出 9px 而 en 溢出 119px，说明 en 大约宽 110px）。
  若 en ≈ 880px，1280px 视口剩余降到 ~226px —— **搜索框定宽要取 220px 才两语言都安全**。
- 断点闸落在 CSS 媒体查询里时，注意棒4 的坑：**媒体查询不加特异性**，
  `@media` 块里的规则若要压过 `.lite2-shell .xxx`（0,2,0）必须写到同等或更高特异性。
