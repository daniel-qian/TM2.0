// Orchestrates MiniMax-M3 to transcreate app/i18n/en.ts → app/i18n/zh.ts.
// I (the agent) DIRECT M3 via the brief below; M3 writes the Chinese.
//
//   node --experimental-strip-types scripts/i18n-zh.mjs
//
// Key/endpoint/model are read from eval-harness/.env (MINIMAX_*). Re-run after
// Danny edits en.ts. zh.ts is AUTO-GENERATED — hand-edits get overwritten.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── load MiniMax creds from eval-harness/.env ───────────────────────────────
const envPath = path.resolve(ROOT, "../eval-harness/.env");
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
const { en } = await import(pathToFileURL(path.resolve(ROOT, "app/i18n/en.ts")).href);

// ── the director brief (ADR-0018: management-decision layer; investor page) ─
const SYS = `你是 Avery 的资深中文文案。Avery 是「管理决策层」产品：帮 20–500 人公司的管理者做出更稳妥、可追溯、算得清账的人事与项目决策。这一版页面面向证券金融行业的投资人路演使用：他们关心市场空白、盈利模式、降本增效和 ROI，对数字敏感。

任务：把给定 JSON 里的英文 value 转译（transcreation，不是直译）成自然、地道、专业的中文。语感：清晰、干练、可信的商业叙事——像一位懂产品的创始人向专业投资人陈述；产品描述处可以有温度，但不堆砌抒情。

铁律：
1. 只翻译 value；绝不改任何 key。返回 JSON 的结构、key 名、数组顺序、嵌套层级必须与输入完全一致。
2. 原样保留、不要翻译：品牌名 Avery；占位符 {em}（必须原样出现在 title 里）；所有数字/百分比/价格/符号（如 60、20、47m、94%、3×、$114、$79–149、$8k–18k、≈ $7B、≈ $3.3M、650,000、~$240K、18%、08:02、MMXXVI、20–500）；SCN-001 这类编号；risk / actions / performance 这类英文小写 logic key。
3. 红线（ADR-0018，任何情况下不破）：绝不给任何一个人打分 / 贴标签 / 下人格判断；文案不能让被讨论的员工读起来觉得自己「被处理 / 被监控」。
4. 类目框架：中文重心落在「管理决策」「用人决策」「决策层」；"safer HR decisions" 往「更稳妥的用人决策」方向译，全文不出现「HR 软件 / 人力资源系统」这类低天花板类目词。dashboard / 效率 / 降本增效 / ROI / 护城河等商业词可以正常使用（旧的"去 SaaS 腔"总开关已按 ADR-0018 降级）。
5. 术语：Playbooks 保留英文原词；TAM / SOM / SaaS / ARR / Pilot / benchmark 等商业术语保留英文或用行业通译。
6. 标题类（h2 / kicker / punch / em）要短、有力，符合中文标题习惯，别拖沓。
7. 只返回 JSON 本身，不要任何解释、不要 markdown 代码块围栏。`;

async function translateSection(name, obj) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL, temperature: 0.3, max_tokens: 6000,
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

// ── translate all top-level sections with a small concurrency pool ──────────
const keys = Object.keys(en);
const zh = {};
const POOL = 4;
let idx = 0, failed = [];
async function worker() {
  while (idx < keys.length) {
    const k = keys[idx++];
    // M3 is a reasoning model and occasionally returns non-JSON for a complex
    // section; retry up to 3× before falling back to English (transient, so a
    // re-ask at temperature 0.3 almost always parses on the next try).
    let done = false, lastErr;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        zh[k] = await translateSection(k, en[k]);
        console.log(`✓ ${k}${attempt > 1 ? ` (retry ${attempt})` : ""}`);
        done = true;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!done) {
      zh[k] = en[k]; // fall back to English for this section; safe + regenerable
      failed.push(k);
      console.log(`✗ ${k} — ${String(lastErr).slice(0, 120)} (kept English after 3 tries)`);
    }
  }
}
await Promise.all(Array.from({ length: POOL }, worker));

// ── force language-invariant fields back from en (logic keys, numbers, token) ─
zh.langSwitch = en.langSwitch;
if (zh.modules?.items) zh.modules.items.forEach((it, i) => { it.key = en.modules.items[i].key; });
if (zh.revenue?.kpis) zh.revenue.kpis.forEach((k, i) => { k.val = en.revenue.kpis[i].val; });
if (zh.morningBriefing?.stats) zh.morningBriefing.stats.forEach((s, i) => { s.num = en.morningBriefing.stats[i].num; });
if (zh.hero && !String(zh.hero.title).includes("{em}")) zh.hero.title = en.hero.title;
// ADR-0018 additions — pure price/derivation values stay byte-identical to en.
if (zh.revenue?.offers) zh.revenue.offers.forEach((o, i) => { o.price = en.revenue.offers[i].price; });
if (zh.revenue?.components) zh.revenue.components.forEach((c, i) => { c.v = en.revenue.components[i].v; });
if (zh.marketGap?.tam) {
  zh.marketGap.tam.factors?.forEach((f, i) => { f.v = en.marketGap.tam.factors[i].v; });
  if (zh.marketGap.tam.sam) zh.marketGap.tam.sam.v = en.marketGap.tam.sam.v;
  if (zh.marketGap.tam.som) zh.marketGap.tam.som.v = en.marketGap.tam.som.v;
}
if (zh.roi?.account?.lines) zh.roi.account.lines.forEach((l, i) => { l.v = en.roi.account.lines[i].v; });
if (zh.playbooks?.items) zh.playbooks.items.forEach((p, i) => { p.id = en.playbooks.items[i].id; });

// ── write zh.ts ─────────────────────────────────────────────────────────────
const out = `import type { Dict } from "./index";

// AUTO-GENERATED by scripts/i18n-zh.mjs — MiniMax-M3 (${MODEL}) transcreation of en.ts.
// ⚠ Draft / 待 Danny 审字. Re-run the script after editing en.ts; hand-edits are overwritten.
export const zh: Dict = ${JSON.stringify(zh, null, 2)};
`;
fs.writeFileSync(path.resolve(ROOT, "app/i18n/zh.ts"), out, "utf8");
console.log(`\nWrote app/i18n/zh.ts (${keys.length - failed.length}/${keys.length} sections translated)` +
  (failed.length ? `; kept English for: ${failed.join(", ")}` : ""));
