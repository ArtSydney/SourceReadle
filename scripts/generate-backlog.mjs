#!/usr/bin/env node
// Keeps a buffer of upcoming days topped up with freshly drafted puzzles.
// Fills only MISSING (date, difficulty) slots for the next SRD_BUFFER days, so
// authored/curated days are respected and each run is incremental and cheap.
// Every draft is validated in-process; invalid drafts are discarded (rotation in
// build-site.mjs covers any gap), so a bad generation never breaks the site.
//
// Env:
//   ANTHROPIC_API_KEY   required for real generation (absent -> fake mode)
//   SRD_MODEL           default claude-sonnet-5-5
//   SRD_BUFFER          days ahead to keep filled (default 14)
//   SRD_DATE            "today" override (testing)
//   SRD_FAKE=1          clone catalog instead of calling the API (testing)
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePuzzle, DIFFS } from "./lib-validate.mjs";
import { draftOne } from "./lib-gen.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const puzzlesSrc = join(root, "puzzles");
const today = process.env.SRD_DATE || new Date().toISOString().slice(0, 10);
const buffer = parseInt(process.env.SRD_BUFFER || "14", 10);
const model = process.env.SRD_MODEL || "claude-sonnet-5-5";
const key = process.env.ANTHROPIC_API_KEY;
const fake = process.env.SRD_FAKE === "1" || !key;

if (fake && !process.env.SRD_FAKE) {
  console.log("ANTHROPIC_API_KEY not set — skipping generation (rotation will cover days).");
  process.exit(0);
}

const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// load existing catalog + max id + seen ids
const dates = readdirSync(puzzlesSrc).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const catalog = { easy: [], medium: [], hard: [] };
const seenIds = new Set();
let maxId = 0;
for (const date of dates) for (const diff of DIFFS) {
  const p = join(puzzlesSrc, date, `${diff}.json`);
  if (!existsSync(p)) continue;
  const o = JSON.parse(readFileSync(p, "utf8"));
  catalog[diff].push(o); seenIds.add(o.id);
  const m = /srd-(\d+)/.exec(o.id || ""); if (m) maxId = Math.max(maxId, +m[1]);
}

// CVEs already used anywhere in the catalog — never reproduce one.
const allCves = new Set();
for (const diff of DIFFS) for (const o of catalog[diff]) if (o.source?.cve) allCves.add(o.source.cve);
const recentClasses = (diff) => catalog[diff].slice(-6).map((o) => o.stages?.bugClass?.answer).filter(Boolean);

let created = 0, skipped = 0, nextId = maxId;
for (let i = 1; i <= buffer; i++) {
  const date = addDays(today, i);
  const usedClass = [], usedLang = [];              // keep the day's 3 puzzles varied
  for (const diff of DIFFS) {
    const target = join(puzzlesSrc, date, `${diff}.json`);
    if (existsSync(target)) continue;                 // respect authored/already-filled

    const avoid = { classes: [...usedClass], langs: [...usedLang], cves: [...allCves], recentClasses: recentClasses(diff) };
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      const idNum = nextId + 1;
      try {
        const obj = await draftOne({ diff, idNum, date, key, model, fake, catalog, avoid });
        const { errors } = validatePuzzle(obj, { date, diff, seenIds: new Set(seenIds) });
        if (errors.length) { console.error(`  ${date}/${diff} attempt ${attempt} invalid: ${errors[0]}`); continue; }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, JSON.stringify(obj, null, 2) + "\n");
        seenIds.add(obj.id); catalog[diff].push(obj); nextId = idNum; created++; ok = true;
        usedClass.push(obj.stages?.bugClass?.answer); usedLang.push(obj.language);
        if (obj.source?.cve) allCves.add(obj.source.cve);
        console.log(`  + ${date}/${diff} -> ${obj.id} (${obj.language}, ${obj.stages?.bugClass?.answer})`);
      } catch (e) {
        console.error(`  ${date}/${diff} attempt ${attempt} failed: ${e.message}`);
      }
    }
    if (!ok) { skipped++; }
  }
}

console.log(`\nBacklog top-up for ${buffer} day(s) after ${today}: ${created} created, ${skipped} left for rotation.${fake ? " (FAKE mode)" : ""}`);
