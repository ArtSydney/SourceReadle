#!/usr/bin/env node
// Execution-verifies puzzles that carry a `verify` block (see CONTRIBUTING.md).
//
// For each such puzzle it materializes the baseline (snippet.files + harness) and,
// for every fix option, overlays that fix's files, then builds+runs the PoC. The
// PoC's exit code is the oracle: 0 == exploited (bug present), non-zero == blocked.
// It checks each variant's result against the declared `expect` and the answer key,
// writes a JSON report, and exits non-zero if anything doesn't match.
//
// Backends:
//   --runner docker   hardened container per puzzle's `verify.image` (used in CI)
//   --runner local    runs on the host (dev fallback; NOT sandboxed)
//   --runner auto      docker if its daemon is up, else local (default)
//
// Usage:
//   node scripts/verify.mjs [puzzle.json ...]      # specific files, or
//   node scripts/verify.mjs                        # every puzzle with a verify block
//   node scripts/verify.mjs --report verify-report.json
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync, statSync, existsSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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

// ---- backend selection -----------------------------------------------------
function dockerUp() {
  const r = spawnSync("docker", ["info"], { stdio: "ignore" });
  return r.status === 0;
}
function resolveRunner() {
  if (runnerArg === "docker" || runnerArg === "local") return runnerArg;
  return dockerUp() ? "docker" : "local";
}

// ---- execution -------------------------------------------------------------
// Run one shell command in `dir`; returns { status, timedOut, stderr }.
function sh(cmd, dir, timeoutMs) {
  const r = spawnSync("/bin/sh", ["-c", cmd], { cwd: dir, timeout: timeoutMs, encoding: "utf8" });
  return { status: r.status, timedOut: r.error && r.error.code === "ETIMEDOUT", stderr: r.stderr || "" };
}
const UID = typeof process.getuid === "function" ? process.getuid() : null;
const GID = typeof process.getgid === "function" ? process.getgid() : null;
function dockerArgs(image, dir) {
  const a = [
    "run", "--rm", "--network=none", "--cap-drop=ALL", "--security-opt=no-new-privileges",
    "--memory=256m", "--memory-swap=256m", "--pids-limit=256", "--cpus=1",
    "--read-only", "--tmpfs", "/tmp:exec",
    // Run as the host user so files the PoC/compiler create under /work are owned
    // by us (host cleanup works) and the container is non-root. HOME points at the
    // writable tmpfs; skip .pyc so /work stays clean.
    "-e", "HOME=/tmp", "-e", "PYTHONDONTWRITEBYTECODE=1",
  ];
  if (UID != null) a.push("--user", `${UID}:${GID}`);
  a.push("-v", `${dir}:/work`, "-w", "/work", image);
  return a;
}
function dockerSh(image, cmd, dir, timeoutMs) {
  const r = spawnSync("docker", [...dockerArgs(image, dir), "sh", "-c", cmd], { timeout: timeoutMs + 20000, encoding: "utf8" });
  return { status: r.status, timedOut: r.error && r.error.code === "ETIMEDOUT", stderr: r.stderr || "" };
}

// Build (if any) then run one variant. Returns { got, exitCode, timedOut, stderr }.
// got: "exploited" | "blocked" | "error" (build/setup failed — never a valid outcome).
function runVariant(v, runner, fileMap) {
  const dir = mkdtempSync(join(tmpdir(), "srd-verify-"));
  try {
    // The container may run as a different (even remapped) uid than the host user
    // that wrote these files, so make the dir world-read/write/exec and the files
    // world-readable — otherwise the PoC can't be read, and compilers can't write
    // their output into /work.
    chmodSync(dir, 0o777);
    for (const [name, code] of Object.entries(fileMap)) {
      const fp = join(dir, name);
      writeFileSync(fp, code);
      chmodSync(fp, 0o644);
    }
    const timeoutMs = (v.timeoutSec || 10) * 1000;
    const build = (v.build || []).join(" && ");
    const exec = runner === "docker"
      ? (cmd, extraMs = 0) => dockerSh(v.image, cmd, dir, timeoutMs + extraMs)
      : (cmd) => sh(cmd, dir, timeoutMs);

    if (build) {
      const b = exec(build, 60000);
      if (b.status !== 0 || b.timedOut) return { got: "error", exitCode: b.status, timedOut: b.timedOut, stderr: b.stderr };
    }
    // In-container timeout guards runaway PoCs; the host timeout is the backstop.
    const runCmd = runner === "docker" ? `timeout ${v.timeoutSec || 10} ${v.run}` : v.run;
    const r = exec(runCmd);
    const got = r.timedOut ? "blocked" : (r.status === 0 ? "exploited" : "blocked");
    return { got, exitCode: r.status, timedOut: r.timedOut, stderr: r.stderr };
  } finally {
    // A sandbox may leave files we can't delete from the host; don't let cleanup
    // failure abort the run.
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// ---- per-puzzle verification ----------------------------------------------
function verifyPuzzle(file, p, runner) {
  const v = p.verify;
  const base = Object.fromEntries((p.snippet?.files || []).map((f) => [f.name, f.code]));
  const harness = Object.fromEntries((v.harness || []).map((f) => [f.name, f.code]));
  const answerIndex = p.stages?.fix?.answerIndex;
  const variants = [];

  const record = (name, role, expect, fileMap) => {
    const started = Date.now();
    const res = runVariant(v, runner, fileMap);
    variants.push({
      variant: name, role, expect, got: res.got, pass: res.got === expect,
      exitCode: res.exitCode, timedOut: res.timedOut, durationMs: Date.now() - started,
      stderrTail: res.got === expect ? undefined : (res.stderr || "").split("\n").slice(-6).join("\n").trim() || undefined,
    });
  };

  record("original", "baseline", v.original?.expect || "exploited", { ...base, ...harness });
  (v.fixes || []).forEach((fx, i) => {
    const overlay = Object.fromEntries((fx.files || []).map((f) => [f.name, f.code]));
    record(`fix#${i}`, i === answerIndex ? "correct" : "wrong", fx.expect, { ...base, ...harness, ...overlay });
  });

  return { id: p.id, file: file.replace(root + "/", ""), language: p.language, ok: variants.every((x) => x.pass), variants };
}

// ---- main ------------------------------------------------------------------
const picked = puzzlesToCheck();
if (!picked.length) { console.log("No puzzles with a `verify` block found."); process.exit(0); }

const runner = resolveRunner();
if (runner === "local") console.log("⚠ Running with the LOCAL backend (no sandbox). Use Docker in CI for isolation.\n");
else console.log(`Running with the Docker backend.\n`);

const results = [];
for (const { file, p } of picked) results.push(verifyPuzzle(file, p, runner));

for (const r of results) {
  console.log(`${r.ok ? "✓" : "✗"} ${r.id}  (${r.language})  ${r.file}`);
  for (const x of r.variants) {
    const line = `    ${x.pass ? "PASS" : "FAIL"}  ${x.variant.padEnd(10)} ${String(x.role).padEnd(9)} expect=${x.expect.padEnd(9)} got=${x.got.padEnd(9)} exit=${x.exitCode}${x.timedOut ? " (timeout)" : ""}`;
    console.log(line);
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
