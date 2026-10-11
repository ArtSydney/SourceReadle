// Reusable execution-verification. runVerification(puzzle, { runner }) materializes
// each variant (snippet + harness, with per-fix file overlays), builds+runs the PoC,
// and checks the result against the answer key via the exit-code oracle (0 = exploited;
// non-zero = blocked). Used by verify.mjs (CLI) and generate-backlog.mjs (the gate).
import { writeFileSync, mkdtempSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const UID = typeof process.getuid === "function" ? process.getuid() : null;
const GID = typeof process.getgid === "function" ? process.getgid() : null;

export function dockerUp() {
  const r = spawnSync("docker", ["info"], { stdio: "ignore" });
  return r.status === 0;
}
// "docker" | "local" forced, or "auto" -> docker if its daemon is up, else local.
export function resolveRunner(pref = "auto") {
  if (pref === "docker" || pref === "local") return pref;
  return dockerUp() ? "docker" : "local";
}

function sh(cmd, dir, timeoutMs) {
  const r = spawnSync("/bin/sh", ["-c", cmd], { cwd: dir, timeout: timeoutMs, encoding: "utf8" });
  return { status: r.status, timedOut: r.error && r.error.code === "ETIMEDOUT", stderr: r.stderr || "" };
}
function dockerArgs(image, dir) {
  const a = [
    "run", "--rm", "--network=none", "--cap-drop=ALL", "--security-opt=no-new-privileges",
    "--memory=256m", "--memory-swap=256m", "--pids-limit=256", "--cpus=1",
    "--read-only", "--tmpfs", "/tmp:exec",
    // Run as the host user so files the PoC/compiler create under /work are owned by
    // us (host cleanup works) and the container is non-root. HOME is the writable
    // tmpfs; skip .pyc so /work stays clean.
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

// Build (if any) then run one variant. got: "exploited" | "blocked" | "error".
function runVariant(v, runner, fileMap) {
  const dir = mkdtempSync(join(tmpdir(), "srd-verify-"));
  try {
    // The container may run as a different (even remapped) uid than the host user
    // that wrote these files, so make the dir world-usable and files readable —
    // otherwise the PoC can't be read and compilers can't write into /work.
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
    const runCmd = runner === "docker" ? `timeout ${v.timeoutSec || 10} ${v.run}` : v.run;
    const r = exec(runCmd);
    const got = r.timedOut ? "blocked" : (r.status === 0 ? "exploited" : "blocked");
    return { got, exitCode: r.status, timedOut: r.timedOut, stderr: r.stderr };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* sandbox-owned files: best effort */ }
  }
}

// Verify one puzzle object. Returns { id, language, ok, variants }.
export function runVerification(p, { runner = "local" } = {}) {
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

  return { id: p.id, language: p.language, ok: variants.every((x) => x.pass), variants };
}
