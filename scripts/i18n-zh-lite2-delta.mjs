// feat-035 · one-off companion to scripts/i18n-zh.mjs.
//
// `en.lite2` is a near-total duplicate of `en.lite` (same product copy, separate namespace per
// kickoff-dev.md §6) plus a small delta of genuinely NEW strings (2 new tabs, 2 new placeholder
// screens, the compliance footer). Running `i18n-zh.mjs lite2` sends the WHOLE ~90-key section
// through M3 in one shot and blows its max_tokens budget (progress.md S5/S6 already logged this
// failure mode for the `lite` section itself — same size, same wall).
//
// This script avoids the wall: it reuses the ALREADY-APPROVED `zh.lite` translation verbatim for
// every key `lite2` shares with `lite` (identical English source -> identical correct Chinese
// target, not stale), and sends ONLY the small delta (~11 keys) through M3 — comfortably inside
// budget. Same director-brief pattern as i18n-zh.mjs (I direct M3; M3 writes the Chinese).
// Re-run after editing the delta keys in en.ts; overwrites only the `lite2` section of zh.ts,
// every other top-level section is carried over byte-identical.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const envPath = path.resolve(ROOT, "eval-harness/.env");
const env = Object.fromEntries(
  fs.readFileSync(envPath, "utf8").split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")]; })
);
const KEY = env.MINIMAX_API_KEY;
const BASE = env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";
const MODEL = env.MINIMAX_MODEL || "MiniMax-M3";
if (!KEY) { console.error("No MINIMAX_API_KEY in eval-harness/.env"); process.exit(1); }

const { en } = await import(pathToFileURL(path.resolve(ROOT, "src/shared/i18n/en.ts")).href);
const { zh: existingZh } = await import(pathToFileURL(path.resolve(ROOT, "src/shared/i18n/zh.ts")).href);

if (!en.lite2) { console.error("en.ts has no `lite2` section — nothing to do."); process.exit(1); }
if (!existingZh.lite) { console.error("zh.ts has no `lite` section to reuse — run i18n-zh.mjs lite2 directly instead."); process.exit(1); }

// Delta = keys present in en.lite2 but NOT in en.lite (the genuinely new strings) AND not
// already translated in zh.lite2. The second condition was added after the feat-043 rework
// (2026-07-14): without it, every re-run re-sends ALL lite2-only keys through M3 — including
// values that were already finalized/adversarially-verified in earlier features — and silently
// clobbers approved copy (this is exactly how feat-042's closerLook*/footerText drifted).
// Approved translations stay put; only keys M3 has never seen go out. To force a re-translation
// of an existing key, delete its line from zh.ts's lite2 section first, then re-run.
const sharedKeys = new Set(Object.keys(en.lite || {}));
const existingLite2Zh = existingZh.lite2 || {};
const deltaKeys = Object.keys(en.lite2).filter(
  (k) => !sharedKeys.has(k) && !(k in existingLite2Zh),
);
const deltaObj = Object.fromEntries(deltaKeys.map((k) => [k, en.lite2[k]]));
console.log(`Delta keys (through M3): ${deltaKeys.join(", ") || "(none)"}`);
console.log(`Reused verbatim from zh.lite: ${Object.keys(en.lite2).filter((k) => sharedKeys.has(k)).length} keys`);
console.log(`Kept from existing zh.lite2 (already approved): ${Object.keys(en.lite2).filter((k) => !sharedKeys.has(k) && k in existingLite2Zh).length} keys`);

const SYS = `你是 Avery 的资深中文文案。Avery 是「管理决策层」产品：帮 20–500 人公司的管理者做出更稳妥、可追溯、算得清账的人事与项目决策。这一版文案是产品界面本身（Avery Live 的 live mode，v02 并排新壳 lite2）：给管理者当场使用。

任务：把给定 JSON 里的英文 value 转译（transcreation，不是直译）成自然、地道、温暖而专业的中文界面文案。语感：像一位见过世面、站在你这边的资深同事在说话——清楚、平实、指向善意的下一步；是产品 UI 里的按钮/标题/提示，要短、可点、不啰嗦。

铁律：
1. 只翻译 value；绝不改任何 key。返回 JSON 的结构、key 名、数组顺序、嵌套层级必须与输入完全一致。
2. 原样保留、不要翻译：品牌名 Avery。
3. 红线（ADR-0018，任何情况下不破）：绝不给任何一个人打分/贴标签/下人格判断；文案不能让被讨论的员工读起来觉得自己「被处理/被监控」。
4. 命名走锁定词族（0729 大白话命名 ADR-0031 + 资料库战役 ADR-0032 后的现行词表）：Today「今天」/ Team「团队」/ Ask Avery「问 Avery」/ To-do list「待办清单」/ Worth noting「值得注意」/ Files「资料库」/ What's coming「完整版预告」/ Follow-ups「跟进」/ 待办动作一律「加到待办」。文件这一族统一用「资料」：页名「资料库」、首页板块「资料概览」、屏内小节「当前资料」——不要在同一产品里混用「文档/档案/文件库/知识库」。不得出现「现实差距/差距/gap」「Nexus」字样，也不要复活旧词「多看一眼/议事室/指挥室/未来方向/实录笔记」。
5. 合规免责页脚（footerText）要读出「Avery 只辅助判断、不替代负责人决策；产出需复核；不得作为重大人事决策唯一依据」，口吻是备忘录腔（平实、直接），不是监管腔（生硬、免责条款感）。
6. 界面文案要地道简短：tab 标签像 UI 常见的短词，不要长句。
7. 只返回 JSON 本身，不要任何解释、不要 markdown 代码块围栏。`;

async function translateDelta(obj) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL, temperature: 0.3, max_tokens: 6000,
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: `区块名："lite2 delta"。把下面 JSON 的英文 value 转译成中文，key 与结构完全一致，只返回 JSON：\n${JSON.stringify(obj, null, 2)}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  let txt = (data.choices?.[0]?.message?.content || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const s = txt.indexOf("{"), e = txt.lastIndexOf("}");
  if (s < 0 || e < 0) throw new Error("no JSON in response: " + txt.slice(0, 200));
  return JSON.parse(txt.slice(s, e + 1));
}

let deltaZh = null, lastErr;
if (deltaKeys.length === 0) deltaZh = {}; // nothing new — skip the M3 call entirely
for (let attempt = 1; attempt <= 3 && !deltaZh; attempt++) {
  try {
    deltaZh = await translateDelta(deltaObj);
    console.log(`  delta translated${attempt > 1 ? ` (retry ${attempt})` : ""}`);
  } catch (err) {
    lastErr = err;
    console.log(`  x attempt ${attempt} — ${String(err).slice(0, 160)}`);
  }
}
if (!deltaZh) {
  console.error(`Delta translation failed after 3 tries: ${String(lastErr).slice(0, 200)} — falling back to English for the delta.`);
  deltaZh = deltaObj;
}

// lite2 = zh.lite verbatim for shared keys, then already-approved zh.lite2 values, then the
// M3 delta for genuinely new keys — in en.lite2 order.
const lite2Zh = {};
for (const k of Object.keys(en.lite2)) {
  lite2Zh[k] = sharedKeys.has(k)
    ? existingZh.lite[k]
    : k in existingLite2Zh
      ? existingLite2Zh[k]
      : deltaZh[k];
}

// Every other top-level section stays byte-identical from the existing zh.ts.
const ordered = {};
for (const k of Object.keys(en)) ordered[k] = k === "lite2" ? lite2Zh : existingZh[k];

const out = `import type { Dict } from "./index";

// AUTO-GENERATED by scripts/i18n-zh.mjs (+ scripts/i18n-zh-lite2-delta.mjs for the lite2 section)
// — MiniMax-M3 (${MODEL}) transcreation of en.ts. Do NOT hand-edit; re-run after editing en.ts.
export const zh: Dict = ${JSON.stringify(ordered, null, 2)};
`;
fs.writeFileSync(path.resolve(ROOT, "src/shared/i18n/zh.ts"), out, "utf8");
const nShared = Object.keys(en.lite2).filter((k) => sharedKeys.has(k)).length;
const nKept = Object.keys(en.lite2).filter((k) => !sharedKeys.has(k) && k in existingLite2Zh).length;
console.log(`\nWrote src/shared/i18n/zh.ts — lite2 section: ${nShared} keys reused from zh.lite + ${nKept} kept from existing zh.lite2 + ${deltaKeys.length} delta keys ${deltaKeys.length === 0 ? "(no M3 call)" : deltaZh === deltaObj ? "(EN fallback)" : "(M3-translated)"}.`);
