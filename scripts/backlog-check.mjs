#!/usr/bin/env node
// Reports how many days of puzzles are queued beyond today, so CI can warn
// before the well runs dry. Prints a short status and, with --github, writes
// outputs for the workflow to act on.
import { readdirSync, existsSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const puzzlesDir = join(root, "puzzles");
const today = process.env.SRD_DATE || new Date().toISOString().slice(0, 10);
const THRESHOLD = parseInt(process.env.SRD_BACKLOG_MIN || "7", 10);
const DIFFS = ["easy", "medium", "hard"];

let futureDays = 0, futurePuzzles = 0, incompleteDays = [];
for (const date of readdirSync(puzzlesDir).sort()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
  if (date <= today) continue;
  const present = DIFFS.filter((d) => existsSync(join(puzzlesDir, date, `${d}.json`)));
  if (present.length === 0) continue;
  futureDays++;
  futurePuzzles += present.length;
  if (present.length < DIFFS.length) incompleteDays.push(`${date} (missing ${DIFFS.filter(d => !present.includes(d)).join(", ")})`);
}

const low = futureDays < THRESHOLD;
console.log(`Backlog beyond ${today}: ${futureDays} day(s), ${futurePuzzles} puzzle(s). Threshold ${THRESHOLD}. ${low ? "LOW ⚠" : "OK ✓"}`);
if (incompleteDays.length) console.log("Incomplete days:\n  " + incompleteDays.join("\n  "));

if (process.argv.includes("--github") && process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT,
    `low=${low}\nfuture_days=${futureDays}\nfuture_puzzles=${futurePuzzles}\n`);
}
