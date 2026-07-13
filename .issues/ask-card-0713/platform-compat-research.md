# Ask 链接分享 · 平台兼容性调研（2026-07-13）

> 方法：企微/钉钉/飞书走 MiniMax 中国源搜索（~10 轮）+ 官方开放文档交叉核对；Slack/Teams 走官方开发者文档（api.slack.com / learn.microsoft.com）。服务于 `.issues/ask-card-0713/PRD.md` Q6/Q9 拍板。

## 总结论

零安装前提下五平台的可行体验一致：**贴链接 →（有 OG 能力的平台）渲染卡片 → 点开外部 H5 大按钮页 → token 标识受访者 → POST 回传**。五平台 webview 均不阻断外部表单提交；均不可指望登录态（token-in-URL 免登录是唯一正解）。差别只在链接卖相（OG 卡 vs 裸链接）与可达性（企微安全拦截 / Vercel 被墙）。

## 企业微信（WeCom）——三平台里的短板

- 贴链接 = 纯文本蓝链，**不解析 OG**（微信系只在 JS-SDK 分享接口出图文卡）。
- 打开走企微内置浏览器 + 腾讯网址安全检测：**未备案/新注册域名普遍触发"谨慎访问"中间页**（转化率杀手），被判风险则全拦、申诉以周计（CSDN 2025-09 实测 blog.csdn.net/qq_35744030/article/details/151227186）。
- 群机器人 webhook 的 `template_card` 只有 text/news 两种，**无按钮回调**（developer.work.weixin.qq.com/document/path/91770）；`button_interaction` 卡要自建应用+回调 URL+可信 IP = 客户 IT 深度配合。
- H5 免登的可信域名**须 ICP 备案且主体与该企业相同/关联**（open.work.weixin.qq.com/help2/pc/21316）→ 第三方 SaaS 免登事实性关死，正路是服务商第三方应用上架（长线）。
- 不装应用时外部 H5 只要没被安全拦截，渲染/JS/POST 均正常。

## 钉钉（DingTalk）——可靠但朴素

- 贴链接 = 裸文本链接，不做 OG（官方"链接增强"酷应用反证默认无卡片，open.dingtalk.com/document/orgapp/access-link-enhancements-coolapp）。
- **无备案检查、无域名拦截**（三平台最宽松）；移动端内置 webview，桌面端默认系统浏览器。
- 互动卡片需企业内部应用 + 卡片平台模板 + 回调（**Stream 模式长连接"五零接入"：零公网 IP/域名/证书**，工程最友好，open.dingtalk.com/document/orgapp/event-callback-card）。
- H5 微应用免登对域名无备案要求，但需应用发布+域名一致（open.dingtalk.com/document/orgapp/enterprise-internal-application-logon-free）。

## 飞书（Feishu/Lark）——零安装体验最好

- **唯一主动抓 OG 的国内平台**：贴外部链接自动渲染 og:title/og:image/og:description 卡片，零配置（segmentfault.com/a/1190000040863000 有微信 vs 飞书对比）。
- 无备案检查、无拦截；移动端 webview，PC 默认系统浏览器。
- 自定义机器人 webhook（群里两分钟加好）可发 interactive 卡但**仅单向**；按钮回传（card.action.trigger）需自建应用，支持长连接免公网回调，创建门槛=任何成员发起+管理员批版本 → **三平台中"聊天内按钮回传"门槛最低**，v2 首选。

## Slack

- 贴链接走 OG + Twitter Card + oEmbed；**爬虫只读前 32KB HTML**（OG tags 须靠前）、缓存 ~30 分钟、og:image 建议 1200×630（docs.slack.dev/messaging/unfurling-links-in-messages/）。默认 unfurl **无按钮**（确认）。
- 交互按钮需工作区装应用（Block Kit + interactivity endpoint，3 秒 ack）；**默认任何成员可自装 OAuth 应用**（除非管理员开 pre-approval）→ SMB 场景门槛低。装后 `link_shared`+`chat.unfurl` 可让贴的链接自动展开成**带真按钮的卡**（v2 甜点）。
- 移动端默认内置浏览器打开（无共享 cookie）；不剥 query 参数（消息 40k 字符上限，URL 保持 <2K 稳妥）。
- Workflow Builder 不可作集成通道（客户自建物、无原生出站 HTTP 步骤）。

## Microsoft Teams

- 贴链接抓 og:title/description/image（HTTPS only）；页面加 **schema.org JSON-LD** 可白赚更富的内置卡样式（learn.microsoft.com/en-us/microsoftteams/platform/messaging-extensions/how-to/link-unfurling "micro-capabilities"）。无按钮。
- 交互按钮需 Teams 应用+bot（**2025-07 后新多租户 bot 已弃用**，走单租户+商店上架或管理员上传自定义应用；租户应用策略是真闸门）→ 门槛显著高于 Slack，v2 排后。
- "零安装 unfurl"（anonymousQueryLink）仍要求应用在租户可见，且**匿名响应剥掉全部动作按钮** → 只是发现辅助，不是免摩擦通道。
- 2026-02 起移动端提示选浏览器；Safe Links 只做点击时检测**不改写 URL**；Stageview 深链 contentUrl 上限 2048 字符。

## Vercel / 域名可达性（国内）

- `*.vercel.app`：DNS 污染/间歇被墙，状态随时间波动 → **对国内企业分享场景不合格，不能赌**。
- 自有域名 + `cname-china.vercel-dns.com`：解 DNS 污染层但流量仍走境外（HK/SG），移动网络首屏 1–3s，企微"谨慎访问"照旧 → 能用但脆。
- **要稳 = 自有域名 + ICP 备案 + 国内边缘节点**；备案同时解掉微信系风险提示最大诱因。→ 答题页落 ECS 后端域名（PRD Q6）。
- **【2026-07-13 补正】Danny 已有备案域名 + 可 SSH 的 ECS** → 本节风险等级从"高"降为"低"：答题页走 ECS+备案域名即稳；`*.vercel.app` 不可用的结论不变（只影响 manager SPA 境外档，境内 ZH 前端按 runbook 走国内静态托管，可复用该域名）。企微"谨慎访问"降为低概率误伤，企微回升第一梯队（PRD Q9 已改）。

## v2 升级阶梯（聊天内原生按钮，按门槛从低到高）

1. **飞书**自建应用（管理员批一次，按钮回传+长连接免公网）
2. **Slack**应用（成员自装 OAuth；link_shared unfurl 带 Block Kit 按钮）
3. **钉钉**企业内部应用（Stream 模式零公网）
4. **Teams**单租户 bot + 商店/管理员上传
5. **企微**服务商第三方应用上架（长线）
