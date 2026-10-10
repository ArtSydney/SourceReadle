#!/usr/bin/env node
// Validates every puzzle against the structural rules the player and apps rely on.
// Zero dependencies. Exits non-zero on any error so CI fails loudly.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePuzzle, DIFFS } from "./lib-validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const puzzlesDir = join(root, "puzzles");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const errors = [], warnings = [];
let count = 0;
const seenIds = new Set();

if (!existsSync(puzzlesDir)) { console.error("No puzzles/ directory."); process.exit(1); }

for (const date of readdirSync(puzzlesDir).sort()) {
  // The 'intro' folder holds the guided onboarding set (not dated, not rotated).
  if (date === "intro") {
    for (const f of readdirSync(join(puzzlesDir, "intro")).filter((x) => x.endsWith(".json")).sort()) {
      count++;
      let p;
      try { p = JSON.parse(readFileSync(join(puzzlesDir, "intro", f), "utf8")); }
      catch (e) { errors.push(`intro/${f}: invalid JSON — ${e.message}`); continue; }
      if (p.difficulty !== "intro") errors.push(`intro/${f}: difficulty must be "intro"`);
      const r = validatePuzzle(p, { seenIds });
      errors.push(...r.errors); warnings.push(...r.warnings);
    }
    continue;
  }
  // 'examples' holds reference puzzles (e.g. the verification-contract demo) — not served, not rotated.
  if (date === "examples") {
    for (const f of readdirSync(join(puzzlesDir, "examples")).filter((x) => x.endsWith(".json")).sort()) {
      count++;
      let p;
      try { p = JSON.parse(readFileSync(join(puzzlesDir, "examples", f), "utf8")); }
      catch (e) { errors.push(`examples/${f}: invalid JSON — ${e.message}`); continue; }
      const r = validatePuzzle(p, { seenIds });
      errors.push(...r.errors); warnings.push(...r.warnings);
    }
    continue;
  }
  if (!DATE_RE.test(date)) { errors.push(`Folder '${date}' is not a YYYY-MM-DD date.`); continue; }
  for (const diff of DIFFS) {
    const file = join(puzzlesDir, date, `${diff}.json`);
    if (!existsSync(file)) { warnings.push(`${date}: missing ${diff}.json`); continue; }
    count++;
    let p;
    try { p = JSON.parse(readFileSync(file, "utf8")); }
    catch (e) { errors.push(`${date}/${diff}.json: invalid JSON — ${e.message}`); continue; }
    const r = validatePuzzle(p, { date, diff, seenIds });
    errors.push(...r.errors); warnings.push(...r.warnings);
  }
}

console.log(`Checked ${count} puzzle(s).`);
if (warnings.length) { console.log(`\n${warnings.length} warning(s):`); warnings.forEach(w => console.log("  ⚠ " + w)); }
if (errors.length) { console.error(`\n${errors.length} error(s):`); errors.forEach(e => console.error("  ✗ " + e)); process.exit(1); }
console.log("\nAll puzzles valid ✓");
