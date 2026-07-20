// feat-069 · 通用「只翻新键」增量生成器 —— scripts/i18n-zh-lite2-delta.mjs 的泛化版。
//
//   node scripts/i18n-zh-delta.mjs lite                  # 只把 en.lite 里 zh.lite 还没有的键送 M3
//   node scripts/i18n-zh-delta.mjs lite2 --mirror=lite   # 键名+英文源都相同的，逐字复用 zh.lite
//   node scripts/i18n-zh-delta.mjs --dry-run lite        # 只报告 delta，不调 M3、不写文件
//
// ⚠️ lite / lite2 要**分两趟**跑（先 lite 再 lite2 --mirror=lite）：mirror 读的是磁盘上已有的
//    zh.lite，同一趟里 lite 的新译文还没落盘，mirror 会扑空、两张皮各翻各的。
//
// 为什么需要它（三条，都是现有两个脚本踩过或会踩的坑）：
//
//   ① `i18n-zh.mjs <section>` 是**整段重发**。`lite` / `lite2` 各约 90–350 个键，一次发完
//      直接撞 max_tokens（progress.md S5/S6 已记过这个失败模式），而且会把早就定稿、
//      甚至对抗验证过的译文重新翻一遍 —— feat-042 的 closerLook*/footerText 就是这么漂的。
//      本脚本只发 **zh 里还不存在的键**，已定稿的一个字都不动。
//
//   ② `i18n-zh-lite2-delta.mjs` 只认识 `lite2` 一个 section（硬编码）。`lite` 加了新键就没
//      工具可用，只能手写 —— zh.ts 头部那几条 "⚠ HAND-WRITTEN, NOT YET M3" 就是这么来的。
//
//   ③ 🔴 **两个现有脚本都会把 zh.ts 顶部的来源注释块整个冲掉。** 它们的 `out` 模板只写
//      两三行头，而 zh.ts 现存的头有近 30 行：哪些键是手写没过 M3、哪些已 ✅ M3-PASSED、
//      哪些还等 Danny 审字 —— 这些是**只存在于那个注释块里**的事实，冲掉就没了，而且冲掉
//      时不报错、不提示。本脚本**逐字保留原有注释块**，只在末尾追加一条本次运行的记录。
//
// 与 i18n-zh.mjs 同一套 director 口径（我导演，M3 写中文；memory: chinese-copy-via-m3）。
// 译文照例是 draft —— 待 Danny 审字，脚本不代表审过。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ZH_PATH = path.resolve(ROOT, "src/shared/i18n/zh.ts");

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
// --mirror=<section>：delta 键若在该 section 的 zh 里已有译文，**逐字复用**，不再调 M3。
// 用于 lite / lite2 这种「两张皮、同一份文案、键名逐字相同」的情形（i18n-zh-lite2-delta.mjs
// 的 sharedKeys 逻辑就是这个，这里把它做成通用开关）。复用保证两张皮的中文一字不差——
// 各翻各的会让同一句话在 v01 和 v02 上长得不一样，客户切壳时会当成两个产品。
const MIRROR = (argv.find((a) => a.startsWith("--mirror=")) || "").split("=")[1] || null;
const sections = argv.filter((a) => !a.startsWith("-"));
if (sections.length === 0) {
  console.error("Usage: node scripts/i18n-zh-delta.mjs [--dry-run] <section> [section…]");
  process.exit(1);
}

const envPath = path.resolve(ROOT, "eval-harness/.env");
const env = Object.fromEntries(
  fs.readFileSync(envPath, "utf8").split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")]; })
);
const KEY = env.MINIMAX_API_KEY;
const BASE = env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";
const MODEL = env.MINIMAX_MODEL || "MiniMax-M3";

const { en } = await import(pathToFileURL(path.resolve(ROOT, "src/shared/i18n/en.ts")).href);
const { zh: existingZh } = await import(pathToFileURL(ZH_PATH).href);

const unknown = sections.filter((s) => !(s in en));
if (unknown.length) { console.error(`Unknown en.ts section(s): ${unknown.join(", ")}`); process.exit(1); }

// delta = en[section] 有、zh[section] 没有的键。**已存在的键一律不动**（定稿保护）。
// 要强制重译某个键：先把它从 zh.ts 里删掉，再跑本脚本。
if (MIRROR && !(MIRROR in en)) { console.error(`--mirror=${MIRROR}: unknown en.ts section`); process.exit(1); }
const mirrorZh = MIRROR ? existingZh[MIRROR] || {} : {};

const deltas = {};   // 真要送 M3 的键
const mirrored = {}; // 从 --mirror section 逐字复用的键
let totalDelta = 0, totalMirrored = 0;
for (const s of sections) {
  const cur = existingZh[s] || {};
  const missing = Object.keys(en[s]).filter((k) => !(k in cur));
  // 复用的前提是**英文源串也逐字相同**——键名撞上但英文不同就必须重翻，否则会把
  // 另一处的译文张冠李戴地贴过来（看着有中文，说的却是别的事）。
  const reuse = MIRROR && s !== MIRROR
    ? missing.filter((k) => typeof mirrorZh[k] === "string" && en[MIRROR]?.[k] === en[s][k])
    : [];
  const send = missing.filter((k) => !reuse.includes(k));
  deltas[s] = Object.fromEntries(send.map((k) => [k, en[s][k]]));
  mirrored[s] = Object.fromEntries(reuse.map((k) => [k, mirrorZh[k]]));
  totalDelta += send.length;
  totalMirrored += reuse.length;
  console.log(`${s}: ${missing.length} new key(s) — ${send.length} → M3${reuse.length ? `, ${reuse.length} reused verbatim from zh.${MIRROR}` : ""}${send.length ? " → " + send.join(", ") : ""}`);
}
if (totalDelta === 0 && totalMirrored === 0) { console.log("Nothing to do — zh.ts already covers every en.ts key."); process.exit(0); }
const src = fs.readFileSync(ZH_PATH, "utf8");

// 🔴 JSON.stringify 出来的对象体里**不可能**有注释——所以对象体内原有的手写注释会被本次
//    写入无声地抹掉。这不是假设：feat-069 第一次跑就抹掉了 lite2 里两段（feat-057 的
//    "别写死统计数"，和 homeDecisionsAbsentBody 上面那条 "不许承诺重传就好了" 的红线说明），
//    靠人肉读 diff 才发现。两个既有生成器有同样的缺陷，只是碰巧没人在它们之后加过注释。
//    ⇒ 与其指望下一个人也去读 diff，不如在这里直接拦下来。
//    这道闸刻意放在**调 M3 之前**：先花钱再拒绝写入是最差的顺序，也会让它没法免费测。
const bodyComments = src.slice(src.indexOf("export const zh")).split("\n").filter((l) => /^\s*\/\//.test(l));
if (bodyComments.length) {
  console.error(`\n🔴 zh.ts 的对象体里有 ${bodyComments.length} 行手写注释，本脚本的写法（JSON.stringify）会把它们全部抹掉：`);
  for (const l of bodyComments.slice(0, 8)) console.error(`   ${l.trim().slice(0, 100)}`);
  if (bodyComments.length > 8) console.error(`   …… 另有 ${bodyComments.length - 8} 行`);
  if (!argv.includes("--allow-comment-loss")) {
    console.error(`\n拒绝写入，zh.ts 未改动、也没有调用 M3。处理方式二选一：`);
    console.error(`  · 跑完之后按 git diff 把这些注释手动贴回去（并确认没有别的东西一起丢）；`);
    console.error(`  · 或者加 --allow-comment-loss 明确表示你接受丢掉它们。`);
    process.exit(1);
  }
  console.error(`\n--allow-comment-loss 已给出，继续。\n`);
}

if (DRY) { console.log("\n--dry-run: no M3 call, no write."); process.exit(0); }
if (!KEY) { console.error("No MINIMAX_API_KEY in eval-harness/.env"); process.exit(1); }

// director brief —— 与 i18n-zh.mjs 同源，只去掉了那边针对整段翻译的措辞。
const SYS = `你是 Avery 的资深中文文案。Avery 是「管理决策层」产品：帮 20–500 人公司的管理者做出更稳妥、可追溯、算得清账的人事与项目决策。这一版文案是产品界面本身（Avery Live 的 live mode）：给管理者当场使用。

任务：把给定 JSON 里的英文 value 转译（transcreation，不是直译）成自然、地道、温暖而专业的中文界面文案。语感：像一位见过世面、站在你这边的资深同事在说话——清楚、平实、指向善意的下一步；是产品 UI 里的按钮/标题/提示，要短、可点、不啰嗦。

铁律：
1. 只翻译 value；绝不改任何 key。返回 JSON 的结构、key 名、数组顺序、嵌套层级必须与输入完全一致。
2. 原样保留、不要翻译：品牌名 Avery；所有文件格式词 PDF / Word / Excel / CSV / Markdown。
3. 红线（ADR-0018，任何情况下不破）：绝不给任何一个人打分 / 贴标签 / 下人格判断；文案不能让被讨论的员工读起来觉得自己「被处理 / 被监控」。
4. 术语表锁定（CONTEXT.md）："Quick ask" 的中文 surface 名固定为「快问」——不是「快速提问 / 问卷 / 调查 / 投票」；"Self-reported" 固定为「本人自述」。
5. 本批里以 stream* 开头的键是**议事室对话流**里 Avery 自己冒出来的系统提示行（一行一句，跟在终端流里滚过去）：要短、像人在旁边轻声交代一句，不要像报错弹窗。其中两条 nudge 说的是「它被拦回去重新找依据」这件事——只描述**在做的事**，绝不出现任何指向某个人的说法（不许出现「谁被贴标签 / 谁有问题」）。
6. 只返回 JSON 本身，不要任何解释、不要 markdown 代码块围栏。`;

async function translate(name, obj) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL, temperature: 0.3, max_tokens: 6000,
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: `区块名："${name} delta"。把下面 JSON 的英文 value 转译成中文，key 与结构完全一致，只返回 JSON：\n${JSON.stringify(obj, null, 2)}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  const txt = (data.choices?.[0]?.message?.content || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const s = txt.indexOf("{"), e = txt.lastIndexOf("}");
  if (s < 0 || e < 0) throw new Error("no JSON in response: " + txt.slice(0, 200));
  const parsed = JSON.parse(txt.slice(s, e + 1));
  // M3 偶尔会漏键或多编一个键。漏了就大声说，别让英文悄悄混进 zh.ts 冒充译文。
  const missing = Object.keys(obj).filter((k) => typeof parsed[k] !== "string" || !parsed[k].trim());
  if (missing.length) throw new Error(`M3 returned no usable value for: ${missing.join(", ")}`);
  return parsed;
}

const translated = {};
const failedSections = [];
for (const s of sections) {
  if (Object.keys(deltas[s]).length === 0) { translated[s] = {}; continue; }
  let out = null, lastErr;
  for (let attempt = 1; attempt <= 3 && !out; attempt++) {
    try {
      out = await translate(s, deltas[s]);
      console.log(`  ${s} delta translated${attempt > 1 ? ` (retry ${attempt})` : ""}`);
    } catch (err) { lastErr = err; console.log(`  x ${s} attempt ${attempt} — ${String(err).slice(0, 160)}`); }
  }
  if (!out) {
    // 🔴 失败时**不**把英文写进 zh.ts 冒充译文——那正是本次要修的缺陷（中文构建里混英文），
    //    而且写进去之后 delta 判据会认为"已翻译"，下次再也不会重试。宁可整段不写。
    console.error(`\n${s}: delta translation failed after 3 tries — ${String(lastErr).slice(0, 200)}`);
    failedSections.push(s);
    continue;
  }
  translated[s] = out;
}
if (failedSections.length) {
  console.error(`\nAborting without writing zh.ts (failed: ${failedSections.join(", ")}). Nothing was changed.`);
  process.exit(1);
}

// ── merge：每个 section 按 en 的键序重排，已有译文逐字保留，新键取 M3 结果 ──
const ordered = {};
for (const k of Object.keys(en)) {
  if (!sections.includes(k)) { ordered[k] = existingZh[k]; continue; }
  const cur = existingZh[k] || {};
  const merged = {};
  for (const key of Object.keys(en[k])) {
    merged[key] = key in cur ? cur[key] : key in mirrored[k] ? mirrored[k][key] : translated[k][key];
  }
  ordered[k] = merged;
}

// ── 🔴 逐字保留原有注释块（见文件头 ③）。只在末尾追加一条本次运行记录。 ──
const headStart = src.indexOf("\n", src.indexOf('import type { Dict } from "./index";'));
const headEnd = src.indexOf("export const zh");
if (headStart < 0 || headEnd < 0) { console.error("Could not locate zh.ts header block — refusing to write."); process.exit(1); }
const preservedHeader = src.slice(headStart + 1, headEnd).replace(/\s+$/, "");

const stamp = sections.map((s) => {
  const sent = Object.keys(deltas[s]);
  const reused = Object.keys(mirrored[s]);
  const parts = [];
  if (sent.length) parts.push(`M3: ${sent.join(", ")}`);
  if (reused.length) parts.push(`reused verbatim from zh.${MIRROR}: ${reused.join(", ")}`);
  return `//  ${s} — ${parts.join(" | ") || "(no change)"}`;
}).join("\n");
const note = `// NOTE (feat-069, via scripts/i18n-zh-delta.mjs): only the keys listed below were NEW in this
//  run; every other key in these sections was carried over byte-identical from the previous zh.ts.
${stamp}
//  ⚠ Draft / 待 Danny 审字.`;

const out = `import type { Dict } from "./index";

${preservedHeader}
${note}
export const zh: Dict = ${JSON.stringify(ordered, null, 2)};
`;
fs.writeFileSync(ZH_PATH, out, "utf8");
console.log(`\nWrote ${path.relative(ROOT, ZH_PATH)} — ${totalDelta} new key(s) translated; existing translations and the provenance header preserved.`);
