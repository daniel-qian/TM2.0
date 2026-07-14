#!/usr/bin/env node
// feat-047 (lite-live-v02) · enginePar — phase group F, static source-level check.
//
// The live-frontend-gate snippet runs in a browser and can't read source files off disk, so this
// half of the enginePar phase runs OUTSIDE the browser (same doctrine as wallRed's external
// `npm run lint` runs): a driver session calls `node scripts/gates/engine-par-check.mjs`, then
// feeds the printed JSON into `__seedGate.recordEnginePar(evidence)`.
//
// What this checks: that src/lite2/transport.ts carries the FULL feat-047 SCOPED delta from
// src/lite/transport.ts — owner_token storage + X-Avery-Token header discipline + fetchFiles/
// fetchNotes — with matching shapes (field names, header constant, which methods thread the auth
// header into their fetch calls). This is NOT a full byte-diff: lite2 intentionally does NOT
// carry lite's later Ask-stage-C additions (revokeAsk, offlinePreview, AskStatus 'revoked'/
// 'expired') — those are a separate, unscoped feature per kickoff-dev.md's §合流契约附录 §2
// explicit file list (only transport.ts's owner_token/header/fetchFiles/fetchNotes delta is
// named). The script records that scope decision as evidence rather than failing on it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const liteSrc = fs.readFileSync(path.resolve(ROOT, 'src/lite/transport.ts'), 'utf8');
const lite2Src = fs.readFileSync(path.resolve(ROOT, 'src/lite2/transport.ts'), 'utf8');

const has = (src, re) => re.test(src);
const checks = {};

// ── 1) owner_token round-trips through LiveTeamPayload ──────────────────────────────────────
checks.liveTeamPayloadHasOwnerToken = has(lite2Src, /interface LiveTeamPayload[\s\S]*?owner_token\?:\s*string[\s\S]*?\n\}/);

// ── 2) file-space + notes contract types exist with matching field sets ─────────────────────
const FILE_ENTRY_FIELDS = ['idx', 'filename', 'size_bytes', 'mime', 'doc_kind', 'uploaded_at', 'n_chunks'];
const NOTE_ENTRY_FIELDS = ['id', 'created_at', 'text', 'source_excerpt'];
function interfaceBody(src, name) {
  const re = new RegExp(`interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = re.exec(src);
  return m ? m[1] : null;
}
function fieldsPresent(body, fields) {
  if (body == null) return { present: false, missing: fields };
  const missing = fields.filter((f) => !new RegExp(`\\b${f}\\??:`).test(body));
  return { present: missing.length === 0, missing };
}
const lite2FileEntryBody = interfaceBody(lite2Src, 'LiveFileEntry');
const lite2NoteEntryBody = interfaceBody(lite2Src, 'LiveNoteEntry');
checks.liveFileEntryShape = fieldsPresent(lite2FileEntryBody, FILE_ENTRY_FIELDS);
checks.liveNoteEntryShape = fieldsPresent(lite2NoteEntryBody, NOTE_ENTRY_FIELDS);
checks.liveFilesPayloadExists = has(lite2Src, /interface LiveFilesPayload\s*\{[\s\S]*?context_id:\s*string[\s\S]*?files:\s*LiveFileEntry\[\][\s\S]*?\n\}/);
checks.liveNotesPayloadExists = has(lite2Src, /interface LiveNotesPayload\s*\{[\s\S]*?context_id:\s*string[\s\S]*?notes:\s*LiveNoteEntry\[\][\s\S]*?\n\}/);

// ── 3) LiveTransport interface declares fetchFiles/fetchNotes with the SAME signature shape
//    as lite's (contextId: string) => Promise<...Payload> ───────────────────────────────────
function transportInterfaceBody(src) {
  const re = /interface LiveTransport\s*\{([\s\S]*?)\n\}/;
  const m = re.exec(src);
  return m ? m[1] : null;
}
const liteTransportBody = transportInterfaceBody(liteSrc);
const lite2TransportBody = transportInterfaceBody(lite2Src);
function memberSignature(body, name) {
  if (body == null) return null;
  const re = new RegExp(`${name}:\\s*\\(([^)]*)\\)\\s*=>\\s*([^\\n]+)`);
  const m = re.exec(body);
  return m ? { params: m[1].trim(), returns: m[2].trim().replace(/,$/, '') } : null;
}
const liteFetchFiles = memberSignature(liteTransportBody, 'fetchFiles');
const lite2FetchFiles = memberSignature(lite2TransportBody, 'fetchFiles');
const liteFetchNotes = memberSignature(liteTransportBody, 'fetchNotes');
const lite2FetchNotes = memberSignature(lite2TransportBody, 'fetchNotes');
checks.fetchFilesSignatureMatches = {
  lite: liteFetchFiles, lite2: lite2FetchFiles,
  match: !!liteFetchFiles && !!lite2FetchFiles &&
    liteFetchFiles.params === lite2FetchFiles.params && liteFetchFiles.returns === lite2FetchFiles.returns,
};
checks.fetchNotesSignatureMatches = {
  lite: liteFetchNotes, lite2: lite2FetchNotes,
  match: !!liteFetchNotes && !!lite2FetchNotes &&
    liteFetchNotes.params === lite2FetchNotes.params && liteFetchNotes.returns === lite2FetchNotes.returns,
};

// ── 4) OWNER_TOKEN_HEADER constant — SAME wire header name, deliberately DIFFERENT storage key
//    (lite2 uses its own `lite2:` localStorage namespace, not lite's `avery.ownerTokens`) ─────
const liteHeaderName = /export const OWNER_TOKEN_HEADER = ('|")([^'"]+)\1/.exec(liteSrc);
const lite2HeaderName = /export const OWNER_TOKEN_HEADER = ('|")([^'"]+)\1/.exec(lite2Src);
checks.ownerTokenHeaderNameMatches = {
  lite: liteHeaderName ? liteHeaderName[2] : null,
  lite2: lite2HeaderName ? lite2HeaderName[2] : null,
  match: !!liteHeaderName && !!lite2HeaderName && liteHeaderName[2] === lite2HeaderName[2],
};
const liteStoreKey = /const TOKEN_STORE_KEY = ('|")([^'"]+)\1/.exec(liteSrc);
const lite2StoreKey = /const TOKEN_STORE_KEY = ('|")([^'"]+)\1/.exec(lite2Src);
checks.tokenStoreKeyIsNamespacedSeparately = {
  lite: liteStoreKey ? liteStoreKey[2] : null,
  lite2: lite2StoreKey ? lite2StoreKey[2] : null,
  // deliberately NOT equal — each shell owns its own storage namespace (lite2: prefix,
  // matching flowStore.ts/notifyStore.ts/onboardStore.ts's own `lite2:*` convention).
  deliberatelyDistinct: !!liteStoreKey && !!lite2StoreKey && liteStoreKey[2] !== lite2StoreKey[2] &&
    lite2StoreKey[2].startsWith('lite2:'),
};

// ── 5) createHttpTransport: which call sites thread authHeader(...) into their fetch() calls —
//    compare the SET of call sites between the two files (must be a superset match on the
//    feat-047-scoped methods: ingest remembers the token; fetchTeam/fetchFiles/fetchNotes/
//    streamAdvise attach the header) ─────────────────────────────────────────────────────────
function httpTransportBody(src) {
  const re = /export function createHttpTransport[\s\S]*$/;
  const m = re.exec(src);
  return m ? m[0] : '';
}
const liteHttp = httpTransportBody(liteSrc);
const lite2Http = httpTransportBody(lite2Src);
function methodBody(fullSrc, methodName) {
  // crude but adequate: grab from `methodName(` up to the next method's `async `/name( at the
  // same indent, or end of object — good enough for this file's consistent formatting.
  const re = new RegExp(`(?:async )?${methodName}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n    \\},`);
  const m = re.exec(fullSrc);
  return m ? m[1] : null;
}
const scopedMethods = ['ingest', 'fetchTeam', 'fetchFiles', 'fetchNotes'];
const authThreading = {};
for (const name of scopedMethods) {
  const liteBody = methodBody(liteHttp, name);
  const lite2Body = methodBody(lite2Http, name);
  const liteUsesAuth = liteBody != null && (/authHeader\(/.test(liteBody) || /rememberToken\(/.test(liteBody));
  const lite2UsesAuth = lite2Body != null && (/authHeader\(/.test(lite2Body) || /rememberToken\(/.test(lite2Body));
  authThreading[name] = { liteFound: liteBody != null, lite2Found: lite2Body != null, liteUsesAuth, lite2UsesAuth, match: liteUsesAuth === lite2UsesAuth && lite2UsesAuth };
}
checks.authHeaderThreading = authThreading;
// streamAdvise is a top-level property (not `name(...)`), check separately.
const liteStreamAdviseUsesAuth = /streamAdvise\(req, onEvent, onDone\)[\s\S]{0,600}authHeader\(req\.company_context_id\)/.test(liteHttp);
const lite2StreamAdviseUsesAuth = /streamAdvise\(req, onEvent, onDone\)[\s\S]{0,600}authHeader\(req\.company_context_id\)/.test(lite2Http);
checks.streamAdviseAuthThreading = {
  liteUsesAuth: liteStreamAdviseUsesAuth, lite2UsesAuth: lite2StreamAdviseUsesAuth,
  match: liteStreamAdviseUsesAuth === lite2StreamAdviseUsesAuth && lite2StreamAdviseUsesAuth,
};

// ── 6) Ask status vocabulary — REQUIRED as of the feat-047 adversarial-verify blocker
//    (2026-07-15). lite2's copy forked before Ask stage C and carried the old 4-word status
//    vocabulary; its coerce folded every unknown word (including the real backend's `revoked` /
//    `expired`) back to 'draft', resurrecting withdrawn asks as editable drafts — ADR-0023 +
//    stage C F1 forbid this verbatim. Both shells must now carry the same six words. ─────────
const STATUS_WORDS = ['draft', 'shared', 'collecting', 'closed', 'revoked', 'expired'];
function statusVocab(src) {
  const m = /export type AskStatus =([^\n]*(?:\n\s*\|[^\n]*)*)/.exec(src);
  if (!m) return null;
  return STATUS_WORDS.filter((w) => new RegExp(`'${w}'`).test(m[1]));
}
const liteVocab = statusVocab(liteSrc);
const lite2Vocab = statusVocab(lite2Src);
checks.askStatusVocabMatches = {
  lite: liteVocab, lite2: lite2Vocab,
  match: !!liteVocab && !!lite2Vocab && JSON.stringify(liteVocab) === JSON.stringify(lite2Vocab) &&
    lite2Vocab.length === STATUS_WORDS.length,
};

// ── 7) Ask endpoints must thread the auth header too (found by the same adversarial-verify pass:
//    lite2's saveAsk/shareAsk/fetchAsk went out with zero X-Avery-Token while the read endpoints
//    carried it — the hardened real backend 404s them). ─────────────────────────────────────
const askMethods = ['saveAsk', 'shareAsk', 'fetchAsk'];
const askAuthThreading = {};
for (const name of askMethods) {
  const liteBody = methodBody(liteHttp, name);
  const lite2Body = methodBody(lite2Http, name);
  const liteUsesAuth = liteBody != null && /authHeader\(/.test(liteBody);
  const lite2UsesAuth = lite2Body != null && /authHeader\(/.test(lite2Body);
  askAuthThreading[name] = { liteFound: liteBody != null, lite2Found: lite2Body != null, liteUsesAuth, lite2UsesAuth, match: liteUsesAuth === lite2UsesAuth && lite2UsesAuth };
}
checks.askAuthHeaderThreading = askAuthThreading;
// share/fetch only carry an askId — both shells need the askId->contextId map to know which
// token to present.
checks.askContextMapPresent = {
  lite: /const askContexts/.test(liteSrc), lite2: /const askContexts/.test(lite2Src),
  match: /const askContexts/.test(liteSrc) && /const askContexts/.test(lite2Src),
};

// ── informational only: confirm the still-OUT-OF-SCOPE Ask-stage-C additions are absent from
//    lite2 (documents the scope decision as machine-checkable evidence, doesn't fail either way
//    — kickoff-dev.md §合流契约附录 §2 only names transport.ts's owner_token/header/fetchFiles/
//    fetchNotes as the delta to port).
//    NOTE (2026-07-15): `askStatusRevokedExpiredAbsentFromLite2` USED to live here and assert
//    those two words were ABSENT. The adversarial-verify blocker proved that framing was wrong —
//    the status vocabulary is not an optional stage-C nicety, it is a safety contract, and it is
//    now REQUIRED above (checks.askStatusVocabMatches). What remains out of scope is only the
//    manager-side *withdraw action* (revokeAsk + its button): lite2 renders the revoked/expired
//    terminal states when the backend reports them, but cannot itself withdraw an ask. ────────
checks.intentionallyNotPorted = {
  revokeAskActionAbsentFromLite2: !/revokeAsk/.test(lite2Src),
  offlinePreviewAbsentFromLite2: !/offlinePreview/.test(lite2Src),
  note: 'The manager-side withdraw ACTION (revokeAsk) and the stub offlinePreview self-declaration exist in src/lite but stay unported: kickoff-dev.md §合流契约附录 §2 does not name them. lite2 still RENDERS revoked/expired correctly when the backend reports them (a withdrawal can originate elsewhere, and expiry is automatic) — displaying a terminal state and being able to cause it are different features.',
};

const requiredPass = [
  checks.liveTeamPayloadHasOwnerToken,
  checks.liveFileEntryShape.present,
  checks.liveNoteEntryShape.present,
  checks.liveFilesPayloadExists,
  checks.liveNotesPayloadExists,
  checks.fetchFilesSignatureMatches.match,
  checks.fetchNotesSignatureMatches.match,
  checks.ownerTokenHeaderNameMatches.match,
  checks.tokenStoreKeyIsNamespacedSeparately.deliberatelyDistinct,
  ...scopedMethods.map((m) => authThreading[m].match),
  checks.streamAdviseAuthThreading.match,
  // feat-047 adversarial-verify additions (2026-07-15)
  checks.askStatusVocabMatches.match,
  ...askMethods.map((m) => askAuthThreading[m].match),
  checks.askContextMapPresent.match,
];
const pass = requiredPass.every(Boolean);

const out = { pass, checks };
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
