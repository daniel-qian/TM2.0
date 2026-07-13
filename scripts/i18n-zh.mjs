// feat-017 · Orchestrates MiniMax-M3 to transcreate src/shared/i18n/en.ts -> src/shared/i18n/zh.ts.
// (feat-024: i18n moved into src/shared/ behind the story/lite wall.)
// I (the agent) DIRECT M3 via the brief below; M3 writes the Chinese (memory: chinese-copy-via-m3).
//
//   node scripts/i18n-zh.mjs                # full run: every top-level section through M3
//   node scripts/i18n-zh.mjs ask            # targeted (feat-034): ONLY the named sections go
//                                           # through M3; every other section is kept
//                                           # byte-identical from the existing zh.ts — avoids the
//                                           # full-run token blowup and never churns settled copy.
//
// Adapted from landing/scripts/i18n-zh.mjs (same pattern). Key/endpoint/model read from
// eval-harness/.env (MINIMAX_*). Re-run after Danny edits en.ts. zh.ts is AUTO-GENERATED —
// hand-edits get overwritten.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── load MiniMax creds from eval-harness/.env ───────────────────────────────
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

// ── load the English source (single source of truth) ───────────────────────
const { en } = await import(pathToFileURL(path.resolve(ROOT, "src/shared/i18n/en.ts")).href);

// ── the director brief (Avery Live product surface; ADR-0015/0018 voice + red line) ─
const SYS = `你是 Avery 的资深中文文案。Avery 是「管理决策层」产品：帮 20–500 人公司的管理者做出更稳妥、可追溯、算得清账的人事与项目决策。这一版文案是产品界面本身（Avery Live 的 live mode）：给管理者当场使用——上传公司文件、看自己团队长出来、就自己团队提问。

任务：把给定 JSON 里的英文 value 转译（transcreation，不是直译）成自然、地道、温暖而专业的中文界面文案。语感：像一位见过世面、站在你这边的资深同事在说话——清楚、平实、指向善意的下一步；是产品 UI 里的按钮/标题/提示，要短、可点、不啰嗦。

铁律：
1. 只翻译 value；绝不改任何 key。返回 JSON 的结构、key 名、数组顺序、嵌套层级必须与输入完全一致。
2. 原样保留、不要翻译：品牌名 Avery；所有文件格式词 PDF / Word / Excel / CSV / Markdown（可保留英文）。
3. 红线（ADR-0018，任何情况下不破）：绝不给任何一个人打分 / 贴标签 / 下人格判断；文案不能让被讨论的员工读起来觉得自己「被处理 / 被监控」。"Nothing is scored about any person" 这类要译出「不给任何人打分，只看他们负责什么」的意思。
4. 界面文案要地道简短：按钮（如 "Ask" / "Choose files" / "Try again"）用中文里 UI 常见的短词；标题（title）别拖沓；提示句（hint / caption）可以有一句话的温度但不堆砌抒情。
5. story / live 这两个词是产品模式名：Story 译「演示」方向、Live 译「实用 / 上你的团队」方向，别直译成「故事 / 直播」。
6. 术语表锁定（CONTEXT.md）："Quick ask" 的中文 surface 名固定为「快问」——不是「快速提问 / 问卷 / 调查 / 投票」（问卷/调查是表单工具腔，投票是匿名聚合语义，都撞术语红线）；"Self-reported" 固定为「本人自述」。
7. 只返回 JSON 本身，不要任何解释、不要 markdown 代码块围栏。`;

async function translateSection(name, obj) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL, temperature: 0.3, max_tokens: 4000,
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: `区块名："${name}"。把下面 JSON 的英文 value 转译成中文，key 与结构完全一致，只返回 JSON：\n${JSON.stringify(obj, null, 2)}` },
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
  if (s < 0 || e < 0) throw new Error("no JSON in response");
  return JSON.parse(txt.slice(s, e + 1));
}

// ── targeted mode: only the sections named on the CLI go through M3 ─────────
const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
let existingZh = {};
if (requested.length > 0) {
  const unknown = requested.filter((k) => !(k in en));
  if (unknown.length) { console.error(`Unknown en.ts section(s): ${unknown.join(", ")}`); process.exit(1); }
  try {
    ({ zh: existingZh } = await import(pathToFileURL(path.resolve(ROOT, "src/shared/i18n/zh.ts")).href));
  } catch (err) {
    console.error(`Targeted mode needs an importable existing zh.ts (${String(err).slice(0, 120)})`);
    process.exit(1);
  }
  console.log(`Targeted run: ${requested.join(", ")} (other sections kept from existing zh.ts)`);
}

// ── translate the selected top-level sections with a small concurrency pool ──
const keys = requested.length > 0 ? requested : Object.keys(en);
const zh = {};
// Sections NOT selected: carry over the committed translation byte-identically
// (fall back to EN only if the section is brand-new and zh.ts predates it).
if (requested.length > 0) {
  for (const k of Object.keys(en)) if (!requested.includes(k)) zh[k] = existingZh[k] ?? en[k];
}
const POOL = 4;
let idx = 0, failed = [];
async function worker() {
  while (idx < keys.length) {
    const k = keys[idx++];
    // M3 is a reasoning model and occasionally returns non-JSON; retry up to 3x before falling
    // back to English (transient — a re-ask at temp 0.3 almost always parses next try).
    let done = false, lastErr;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        zh[k] = await translateSection(k, en[k]);
        console.log(`  ${k}${attempt > 1 ? ` (retry ${attempt})` : ""}`);
        done = true;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!done) {
      zh[k] = en[k]; // fall back to English for this section; safe + regenerable
      failed.push(k);
      console.log(`  x ${k} — ${String(lastErr).slice(0, 120)} (kept English after 3 tries)`);
    }
  }
}
await Promise.all(Array.from({ length: POOL }, worker));

// ── write zh.ts (key order mirrors en.ts regardless of translation order) ───
const ordered = {};
for (const k of Object.keys(en)) ordered[k] = zh[k];
const out = `import type { Dict } from "./index";

// AUTO-GENERATED by scripts/i18n-zh.mjs — MiniMax-M3 (${MODEL}) transcreation of en.ts.
// Do NOT hand-edit; re-run the script after editing en.ts. ⚠ Draft / 待 Danny 审字.
export const zh: Dict = ${JSON.stringify(ordered, null, 2)};
`;
fs.writeFileSync(path.resolve(ROOT, "src/shared/i18n/zh.ts"), out, "utf8");
console.log(`\nWrote src/shared/i18n/zh.ts (${keys.length - failed.length}/${keys.length} sections translated)` +
  (failed.length ? `; kept English for: ${failed.join(", ")}` : ""));
