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
import { draftOne, VERIFY_IMAGES } from "./lib-gen.mjs";
import { runVerification, resolveRunner } from "./lib-verify.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const puzzlesSrc = join(root, "puzzles");
const today = process.env.SRD_DATE || new Date().toISOString().slice(0, 10);
const buffer = parseInt(process.env.SRD_BUFFER || "14", 10);
const maxNew = parseInt(process.env.SRD_MAX_NEW || "0", 10);   // 0 = unlimited; cap puzzles per run to limit API calls
const model = process.env.SRD_MODEL || "claude-sonnet-5-5";
const key = process.env.ANTHROPIC_API_KEY;
const fake = process.env.SRD_FAKE === "1" || !key;
// SRD_VERIFY=1 asks the model for a `verify` block (runnable languages only) and
// gates on execution. Independently, ANY draft that carries a verify block is
// always execution-gated. The runner is picked once (Docker in CI, else local).
const wantVerify = process.env.SRD_VERIFY === "1";
const vrunner = resolveRunner(process.env.SRD_VERIFY_RUNNER || "auto");

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
outer:
for (let i = 1; i <= buffer; i++) {
  const date = addDays(today, i);
  const usedClass = [], usedLang = [];              // keep the day's 3 puzzles varied
  for (const diff of DIFFS) {
    if (maxNew && created >= maxNew) break outer;    // per-run cap reached
    const target = join(puzzlesSrc, date, `${diff}.json`);
    if (existsSync(target)) continue;                 // respect authored/already-filled

    const avoid = { classes: [...usedClass], langs: [...usedLang], cves: [...allCves], recentClasses: recentClasses(diff) };
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      const idNum = nextId + 1;
      try {
        const obj = await draftOne({ diff, idNum, date, key, model, fake, catalog, avoid, wantVerify });
        const { errors } = validatePuzzle(obj, { date, diff, seenIds: new Set(seenIds) });
        if (errors.length) { console.error(`  ${date}/${diff} attempt ${attempt} invalid: ${errors[0]}`); continue; }
        // Trust gate: any draft with a verify block must prove its answer key by
        // execution (original exploited, correct fix blocked, wrong fixes still
        // exploited). A draft that doesn't verify is discarded, not shipped.
        if (obj.verify) {
          if (!VERIFY_IMAGES[obj.language]) { console.error(`  ${date}/${diff} attempt ${attempt} discarded: verify block for unrunnable language '${obj.language}'`); continue; }
          const vr = runVerification(obj, { runner: vrunner });
          if (!vr.ok) {
            const bad = vr.variants.find((x) => !x.pass);
            console.error(`  ${date}/${diff} attempt ${attempt} FAILED execution-verification: ${bad.variant} (${bad.role}) expected ${bad.expect}, got ${bad.got}`);
            continue;
          }
          console.log(`  ✓ execution-verified ${obj.id}`);
        }
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
