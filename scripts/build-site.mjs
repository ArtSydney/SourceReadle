#!/usr/bin/env node
// Assembles _site/ for GitHub Pages:
//   - static player (site/*)
//   - shared taxonomy
//   - a puzzle for every day from launch up to the cutoff (default: today UTC)
//   - a generated index.json the player reads
//
// Scheduling model:
//   1. If an authored puzzle exists at puzzles/<date>/<diff>.json, it plays on that date.
//   2. Otherwise, if rotation is on (default), a puzzle is picked from the catalog of
//      all authored puzzles of that difficulty, cycling deterministically by day. This
//      means the game never runs dry with zero maintenance and no LLM; new puzzles you
//      add simply join the rotation.
//
// Env:
//   SRD_DATE=YYYY-MM-DD   cutoff / "today" (default: today UTC)
//   SRD_ROTATE=0          disable rotation (only authored dates are served)
//   SRD_WINDOW=365        how many trailing days to materialize (bounds feed size)
import { readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "_site");
const cutoff = process.env.SRD_DATE || new Date().toISOString().slice(0, 10);
const rotate = process.env.SRD_ROTATE !== "0";
const windowDays = parseInt(process.env.SRD_WINDOW || "365", 10);
const DIFFS = ["easy", "medium", "hard"];
const DAY = 86400000;

const dstr = (d) => d.toISOString().slice(0, 10);
const addDays = (date, n) => { const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return dstr(d); };
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "site"), out, { recursive: true });
cpSync(join(root, "schema", "taxonomy.json"), join(out, "taxonomy.json"));

// --- load the authored catalog -------------------------------------------------
const puzzlesSrc = join(root, "puzzles");
const authoredDates = readdirSync(puzzlesSrc).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
if (authoredDates.length === 0) { console.error("No authored puzzles."); process.exit(1); }

const authored = {};             // "date/diff" -> puzzle object
const catalog = { easy: [], medium: [], hard: [] };
for (const date of authoredDates) {
  for (const diff of DIFFS) {
    const p = join(puzzlesSrc, date, `${diff}.json`);
    if (!existsSync(p)) continue;
    const obj = JSON.parse(readFileSync(p, "utf8"));
    authored[`${date}/${diff}`] = obj;
    catalog[diff].push(obj);
  }
}
// Deterministic, stable rotation order: sort each difficulty by a hash of the id,
// so the cycle doesn't simply replay the authored calendar order.
for (const diff of DIFFS) {
  catalog[diff].sort((a, b) =>
    createHash("sha1").update(a.id).digest("hex").localeCompare(
    createHash("sha1").update(b.id).digest("hex")));
}

const START = authoredDates[0];
if (cutoff < START) {
  // Nothing has launched yet.
  writeFileSync(join(out, "index.json"), JSON.stringify({ generated: new Date().toISOString(), cutoff, dates: [], byDate: {}, count: 0 }, null, 2));
  console.log(`Built _site/ (cutoff ${cutoff}): 0 puzzles — launch date is ${START}.`);
  process.exit(0);
}

const windowStart = (() => {
  const earliest = addDays(cutoff, -(windowDays - 1));
  return earliest > START ? earliest : START;
})();

// --- materialize one puzzle per day/difficulty --------------------------------
const dates = [];
const byDate = {};
let count = 0;

for (let d = windowStart; d <= cutoff; d = addDays(d, 1)) {
  const dayIndex = daysBetween(START, d);          // stable across window changes
  const present = [];
  for (const diff of DIFFS) {
    let obj = authored[`${d}/${diff}`];
    if (!obj && rotate) {
      const pool = catalog[diff];
      if (pool.length) obj = pool[((dayIndex % pool.length) + pool.length) % pool.length];
    }
    if (!obj) continue;
    const served = JSON.parse(JSON.stringify(obj));  // clone
    served.date = d;                                 // the date it plays on
    mkdirSync(join(out, "puzzles", d), { recursive: true });
    writeFileSync(join(out, "puzzles", d, `${diff}.json`), JSON.stringify(served, null, 2));
    present.push(diff);
    count++;
  }
  if (present.length) { dates.push(d); byDate[d] = present; }
}

writeFileSync(join(out, "index.json"), JSON.stringify({
  generated: new Date().toISOString(),
  cutoff, rotation: rotate, launch: START,
  dates, byDate, count,
}, null, 2));

console.log(`Built _site/ (cutoff ${cutoff}, rotation ${rotate ? "on" : "off"}): ${dates.length} day(s), ${count} puzzle(s).`);
