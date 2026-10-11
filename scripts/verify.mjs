#!/usr/bin/env node
// Execution-verifies puzzles that carry a `verify` block (see CONTRIBUTING.md).
//
// For each such puzzle it runs the PoC against the original and every fix option
// and checks the result against the answer key via the exit-code oracle (0 ==
// exploited, non-zero == blocked). Writes a JSON report and exits non-zero on any
// mismatch. The execution engine lives in lib-verify.mjs.
//
// Backends: --runner docker | local | auto (default: docker if its daemon is up).
//
// Usage:
//   node scripts/verify.mjs [puzzle.json ...]      # specific files, or
//   node scripts/verify.mjs                        # every puzzle with a verify block
//   node scripts/verify.mjs --report verify-report.json
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRunner, runVerification } from "./lib-verify.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
let runnerArg = "auto", reportPath = join(root, "verify-report.json");
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--runner") runnerArg = argv[++i];
  else if (argv[i] === "--report") reportPath = argv[++i];
  else files.push(argv[i]);
}

// ---- discover puzzles ------------------------------------------------------
function walk(dir, out) {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (e.endsWith(".json")) out.push(full);
  }
}
function puzzlesToCheck() {
  let candidates = files;
  if (!candidates.length) { const all = []; walk(join(root, "puzzles"), all); candidates = all; }
  const picked = [];
  for (const f of candidates) {
    let p; try { p = JSON.parse(readFileSync(f, "utf8")); } catch { continue; }
    if (p && p.verify) picked.push({ file: f, p });
  }
  return picked;
}

// ---- main ------------------------------------------------------------------
const picked = puzzlesToCheck();
if (!picked.length) { console.log("No puzzles with a `verify` block found."); process.exit(0); }

const runner = resolveRunner(runnerArg);
console.log(runner === "local"
  ? "⚠ Running with the LOCAL backend (no sandbox). Use Docker in CI for isolation.\n"
  : "Running with the Docker backend.\n");

const results = [];
for (const { file, p } of picked) {
  const r = runVerification(p, { runner });
  r.file = file.replace(root + "/", "");
  results.push(r);
}

for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.id}  (${r.language})  ${r.file}`);
  for (const x of r.variants) {
    console.log(`    ${x.pass ? "PASS" : "FAIL"}  ${x.variant.padEnd(10)} ${String(x.role).padEnd(9)} expect=${x.expect.padEnd(9)} got=${x.got.padEnd(9)} exit=${x.exitCode}${x.timedOut ? " (timeout)" : ""}`);
    if (!x.pass && x.stderrTail) console.log(x.stderrTail.split("\n").map((l) => "        " + l).join("\n"));
  }
}

const failed = results.filter((r) => !r.ok);
const report = {
  generatedAt: new Date().toISOString(),
  runner,
  summary: { puzzles: results.length, verified: results.length - failed.length, failed: failed.length },
  results,
};
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(`\n${report.summary.verified}/${report.summary.puzzles} verified. Report: ${reportPath.replace(root + "/", "")}`);
if (failed.length) { console.error(`\n${failed.length} puzzle(s) failed verification.`); process.exit(1); }
console.log("All verified ✓");
