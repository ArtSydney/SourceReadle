// Reusable puzzle validation. validatePuzzle(obj, ctx) -> { errors, warnings }.
// Used by validate.mjs (CLI over all puzzles) and generate-backlog.mjs (per-draft).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const taxonomy = JSON.parse(readFileSync(join(root, "schema", "taxonomy.json"), "utf8"));

export const DIFFS = ["easy", "medium", "hard"];
const LANGS = ["python", "csharp", "c", "cpp", "javascript", "go", "java", "ruby", "php", "rust"];
// Links are rendered as <a href>; generated content must not smuggle javascript:/data: URLs.
const isHttps = (u) => { try { return new URL(u).protocol === "https:"; } catch { return false; } };

// ctx: { date, diff, seenIds? }  — date/diff are what the puzzle must declare.
export function validatePuzzle(p, ctx = {}) {
  const errors = [], warnings = [];
  const id = p?.id || `${ctx.date}/${ctx.diff}`;
  const fail = (m) => errors.push(`[${id}] ${m}`);
  const warn = (m) => warnings.push(`[${id}] ${m}`);

  if (!/^srd-\d{4,}$/.test(p?.id || "")) fail("id must match srd-NNNN");
  if (ctx.seenIds) { if (ctx.seenIds.has(p.id)) fail("duplicate id"); else ctx.seenIds.add(p.id); }
  if (ctx.date && p.date !== ctx.date) fail(`date '${p.date}' != expected '${ctx.date}'`);
  if (ctx.diff && p.difficulty !== ctx.diff) fail(`difficulty '${p.difficulty}' != expected '${ctx.diff}'`);

  if (!LANGS.includes(p?.language)) fail(`language '${p?.language}' not supported`);

  const files = p?.snippet?.files;
  if (!Array.isArray(files) || files.length === 0) { fail("snippet.files missing"); return { errors, warnings }; }
  const byName = {};
  for (const f of files) {
    if (!f.name || typeof f.code !== "string") { fail("a file is missing name/code"); continue; }
    const arr = f.code.split("\n");
    byName[f.name] = arr;
    const lineCount = (arr.length && arr[arr.length - 1] === "") ? arr.length - 1 : arr.length;
    if (f.notes) for (const k of Object.keys(f.notes)) {
      const n = parseInt(k, 10);
      if (!(n >= 1 && n <= lineCount)) warn(`${f.name}: note for line ${k} is out of range`);
    }
  }

  const ln = p.stages?.line;
  if (!ln) fail("stages.line missing");
  else {
    const lines = byName[ln.file];
    if (!lines) fail(`stages.line.file '${ln.file}' not in snippet.files`);
    else if (!(ln.line >= 1 && ln.line <= lines.length)) fail(`stages.line.line ${ln.line} out of range (file has ${lines.length} lines)`);
    else if (lines[ln.line - 1].trim() === "") warn(`stages.line.line ${ln.line} points at a blank line`);
    if (!(ln.maxGuesses >= 1 && ln.maxGuesses <= 10)) fail("stages.line.maxGuesses out of 1..10");
  }

  // Scaffolded (Intro) puzzles intentionally present fewer options.
  const minBug = p.scaffold ? 2 : 4;
  const minOpt = p.scaffold ? 2 : 3;

  const bc = p.stages?.bugClass;
  if (!bc) fail("stages.bugClass missing");
  else {
    if (!Array.isArray(bc.options) || bc.options.length < minBug) fail(`bugClass needs >= ${minBug} options`);
    if (!bc.options?.includes(bc.answer)) fail(`bugClass.answer '${bc.answer}' not among options`);
    for (const c of bc.options || []) if (!taxonomy.classes[c]) fail(`bugClass option '${c}' not in taxonomy`);
    if (new Set(bc.options).size !== (bc.options || []).length) fail("bugClass options not unique");
  }

  const wy = p.stages?.why;
  if (!wy) fail("stages.why missing");
  else {
    const opts = wy.options || [];
    if (opts.length < minOpt) fail(`why needs >= ${minOpt} options`);
    if (!(wy.answerIndex >= 0 && wy.answerIndex < opts.length)) fail("why.answerIndex out of range");
    opts.forEach((o, i) => {
      if (!o.label) fail(`why option ${i} missing label`);
      if (i === wy.answerIndex && o.whyWrong) warn(`correct why option ${i} has a whyWrong`);
      if (i !== wy.answerIndex && !o.whyWrong) warn(`wrong why option ${i} has no whyWrong`);
    });
  }

  if (!p.training?.exploit) warn("training.exploit missing (recommended)");

  const fx = p.stages?.fix;
  if (!fx) fail("stages.fix missing");
  else {
    const opts = fx.options || [];
    if (opts.length < minOpt) fail(`fix needs >= ${minOpt} options`);
    if (!(fx.answerIndex >= 0 && fx.answerIndex < opts.length)) fail("fix.answerIndex out of range");
    opts.forEach((o, i) => {
      if (!o.label || typeof o.diff !== "string" || !o.diff) fail(`fix option ${i} missing label/diff`);
      if (i === fx.answerIndex && o.whyWrong) warn(`correct fix option ${i} has a whyWrong`);
      if (i !== fx.answerIndex && !o.whyWrong) warn(`wrong fix option ${i} has no whyWrong`);
    });
  }

  const src = p.source;
  if (!src?.origin) fail("source.origin missing");
  if (!src?.license) fail("source.license missing");
  if (src?.origin === "cve") {
    if (!/^CVE-\d{4}-\d+$/.test(src.cve || "")) fail("cve origin requires a valid source.cve");
    if (!src.advisory) fail("cve origin requires source.advisory");
    if (!src.fixCommit) warn("cve origin: no source.fixCommit");
  }

  for (const [k, u] of [["source.advisory", src?.advisory], ["source.fixCommit", src?.fixCommit]]) if (u && !isHttps(u)) fail(`${k} must be an https URL`);
  for (const r of p.writeup?.readNext || []) if (!isHttps(r?.url)) fail(`writeup.readNext url '${r?.url}' must be https`);

  if (!p.writeup?.summary) fail("writeup.summary missing");

  if (p.verify) validateVerify(p, fail, warn);
  return { errors, warnings };
}

// The execution contract (Phase 1). Validated structurally here; executed by the
// runner (T1.2). The heart of it: fixes are index-aligned to stages.fix.options,
// and exactly the correct fix must expect "blocked".
function validateVerify(p, fail, warn) {
  const v = p.verify;
  if (v.version !== 1) fail("verify.version must be 1");
  if (typeof v.image !== "string" || !v.image) fail("verify.image missing");
  if (typeof v.run !== "string" || !v.run) fail("verify.run missing");
  if (v.build && !Array.isArray(v.build)) fail("verify.build must be an array of strings");
  if (v.timeoutSec != null && !(v.timeoutSec >= 1 && v.timeoutSec <= 60)) fail("verify.timeoutSec out of 1..60");
  for (const h of v.harness || []) if (!h?.name || typeof h.code !== "string") fail("verify.harness entry missing name/code");
  if (v.original?.expect !== "exploited") fail("verify.original.expect must be 'exploited'");

  const fixOpts = p.stages?.fix?.options || [];
  const fixes = v.fixes;
  if (!Array.isArray(fixes)) { fail("verify.fixes must be an array"); return; }
  if (fixes.length !== fixOpts.length) fail(`verify.fixes length ${fixes.length} != stages.fix.options length ${fixOpts.length}`);

  const snippetNames = new Set((p.snippet?.files || []).map((f) => f.name));
  let blocked = -1;
  fixes.forEach((fx, i) => {
    if (fx?.expect !== "exploited" && fx?.expect !== "blocked") fail(`verify.fixes[${i}].expect must be 'exploited' or 'blocked'`);
    if (fx?.expect === "blocked") { if (blocked >= 0) fail("verify.fixes has more than one 'blocked'"); blocked = i; }
    if (!Array.isArray(fx?.files) || fx.files.length === 0) fail(`verify.fixes[${i}].files must be a non-empty array`);
    for (const f of fx?.files || []) {
      if (!f?.name || typeof f.code !== "string") { fail(`verify.fixes[${i}] has a file missing name/code`); continue; }
      if (!snippetNames.has(f.name)) warn(`verify.fixes[${i}] patches '${f.name}', which is not a snippet file`);
    }
  });
  const ai = p.stages?.fix?.answerIndex;
  if (blocked === -1) fail("verify.fixes must mark exactly one 'blocked'");
  else if (blocked !== ai) fail(`verify: the 'blocked' fix is index ${blocked} but stages.fix.answerIndex is ${ai}`);
}
