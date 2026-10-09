"use strict";

// ---- data loading ----------------------------------------------------------
let INDEX = null;
let TAX = null;
const puzzleCache = new Map();

const STAGES = ["line", "bugClass", "why", "fix"]; // ordered; stage index 1..4, 5 = done
const state = { date: null, diff: "easy", puzzle: null, prog: null, explain: false, selectedNote: null };

const $ = (id) => document.getElementById(id);

async function loadJSON(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function getPuzzle(date, diff) {
  const key = `${date}/${diff}`;
  if (puzzleCache.has(key)) return puzzleCache.get(key);
  try { const p = await loadJSON(`puzzles/${date}/${diff}.json`); puzzleCache.set(key, p); return p; }
  catch { puzzleCache.set(key, null); return null; }
}

// ---- persistence -----------------------------------------------------------
const PKEY = "sourcereadle:progress:v1";
const SKEY = "sourcereadle:streak:v1";
const LKEY = "sourcereadle:learn:v1";

function allProgress() { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch { return {}; } }
function saveProgress(key, data) { const all = allProgress(); all[key] = data; try { localStorage.setItem(PKEY, JSON.stringify(all)); } catch {} }
function getProgress(key) { return allProgress()[key] || null; }
// Progress is keyed by the day it was played, not the puzzle id, so a puzzle that
// recurs via rotation plays fresh instead of showing as already solved.
function progKey() { return `${state.date}/${state.diff}`; }
function learnOn() { try { return localStorage.getItem(LKEY) === "1"; } catch { return false; } }
function setLearn(v) { try { localStorage.setItem(LKEY, v ? "1" : "0"); } catch {} }

function freshProgress(p) {
  return {
    id: p.id, stage: 1,
    lineGuesses: [], lineSolved: false,
    classPick: null, classResult: null,
    whyPick: null, whyResult: null,
    fixPick: null, fixResult: null,
    completedAt: null, learn: learnOn(),
  };
}

// ---- streak ----------------------------------------------------------------
function getStreak() { try { return JSON.parse(localStorage.getItem(SKEY)) || { cur: 0, max: 0, last: null }; } catch { return { cur: 0, max: 0, last: null }; } }
function bumpStreak(date) {
  const s = getStreak();
  if (s.last === date) return s;
  const prev = new Date(date + "T00:00:00Z"); prev.setUTCDate(prev.getUTCDate() - 1);
  s.cur = (s.last === prev.toISOString().slice(0, 10)) ? s.cur + 1 : 1;
  s.last = date; s.max = Math.max(s.max, s.cur);
  try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch {}
  return s;
}
function renderStreak() { const s = getStreak(); $("streak").textContent = `🔥 ${s.cur}` + (s.max > s.cur ? ` / ${s.max}` : ""); }

// ---- helpers ---------------------------------------------------------------
const LANG_LABEL = { python: "Python", csharp: "C#", c: "C", cpp: "C++", javascript: "JavaScript", go: "Go", java: "Java", ruby: "Ruby", php: "PHP", rust: "Rust" };
const SYM = { green: "🟩", yellow: "🟨", grey: "⬜" };
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function mdLite(s) { return escapeHtml(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"); }
function fileLines(f) { const a = f.code.split("\n"); if (a.length && a[a.length - 1] === "") a.pop(); return a; }

// ---- meta ------------------------------------------------------------------
function renderMeta(p) {
  const src = p.source.origin === "cve"
    ? `<span class="pill">${escapeHtml(p.source.cve)}</span><span class="pill">${escapeHtml(p.source.project || "")}</span>`
    : `<span class="pill">original</span>`;
  $("meta").innerHTML =
    `<span class="pill">${p.id}</span><span class="pill">${p.difficulty}</span>` +
    `<span class="pill">${LANG_LABEL[p.language] || p.language}</span>` +
    `<span class="pill">~${p.estimatedMinutes || "?"} min</span>` + src;
  $("reportLink").href = `https://github.com/ArtSydney/SourceReadle/issues/new?title=${encodeURIComponent("Puzzle issue: " + p.id)}&body=${encodeURIComponent("Puzzle: " + p.id + "\n\nWhat's wrong:")}`;
}

// ---- code ------------------------------------------------------------------
function renderCode(p, prog) {
  const panel = $("codePanel");
  const ans = p.stages.line;
  const guessing = prog.stage === 1 && !state.explain;
  panel.className = "code" + (guessing || state.explain ? " clickable" : "");
  panel.innerHTML = "";

  for (const f of p.snippet.files) {
    const head = document.createElement("div");
    head.className = "filename"; head.textContent = f.name;
    panel.appendChild(head);

    fileLines(f).forEach((text, i) => {
      const lineNo = i + 1;
      const row = document.createElement("div");
      row.className = "coderow";
      if (f.name === ans.file) {
        const g = prog.lineGuesses.find((x) => x.line === lineNo);
        if (g) row.classList.add("g-" + g.result);
      }
      if (prog.stage > 1 && f.name === ans.file && lineNo === ans.line) row.classList.add("reveal");
      if (state.explain && state.selectedNote && state.selectedNote.file === f.name && state.selectedNote.line === lineNo) row.classList.add("noted");
      if (f.notes && f.notes[String(lineNo)]) row.classList.add("has-note");

      const ln = document.createElement("span"); ln.className = "ln"; ln.textContent = lineNo;
      const src = document.createElement("span"); src.className = "src"; src.textContent = text;
      row.append(ln, src);

      row.addEventListener("click", () => {
        if (state.explain) showNote(f, lineNo);
        else if (guessing) guessLine(lineNo, f.name);
      });
      panel.appendChild(row);
    });
  }
}

function showNote(f, lineNo) {
  const note = f.notes && f.notes[String(lineNo)];
  state.selectedNote = { file: f.name, line: lineNo };
  const box = $("notePanel");
  box.classList.remove("hidden");
  box.innerHTML = `<span class="notehdr">${escapeHtml(f.name)}:${lineNo}</span>` +
    (note ? mdLite(note) : `<span class="muted">No note for this line — it's ordinary plumbing.</span>`);
  renderCode(state.puzzle, state.prog);
}

// ---- stage panel -----------------------------------------------------------
function hintBtn(stageKey) {
  const h = state.puzzle.training?.hints?.[stageKey];
  if (!h || !state.prog.learn) return "";
  return `<details class="hint-d"><summary>💡 Hint</summary><div>${mdLite(h)}</div></details>`;
}

function renderStage(p, prog) {
  const el = $("stagePanel");
  if (prog.stage === 1) {
    const unlimited = prog.learn;
    const left = p.stages.line.maxGuesses - prog.lineGuesses.length;
    const dots = prog.lineGuesses.map((g) => SYM[g.result]).join("") || "—";
    el.innerHTML =
      `<h2>Stage 1 of 4 — Find the vulnerable line</h2>` +
      `<p class="hint">Tap the line where the bug lives. 🟩 exact · 🟨 within ${p.stages.line.yellowRadius} lines · ⬜ cold.` +
      (unlimited ? ` <em>Learn mode: unlimited guesses.</em>` : ` ${left} guess${left === 1 ? "" : "es"} left.`) + `</p>` +
      `<div class="guessdots">${dots}</div>` + hintBtn("line") +
      (prog.learn ? `<button class="btn secondary sm" id="revealLine">Reveal the line</button>` : "");
    const rb = $("revealLine"); if (rb) rb.addEventListener("click", () => { prog.stage = 2; persistAndRender(); });
  } else if (prog.stage === 2) {
    const opts = p.stages.bugClass.options.map((c) =>
      `<button class="opt${classStateClass(prog, c)}" data-class="${c}">${escapeHtml(TAX.classes[c].label)}</button>`).join("");
    el.innerHTML = `<h2>Stage 2 of 4 — Name the bug class</h2>` +
      `<p class="hint">What kind of vulnerability is it? 🟨 = right family, wrong class.</p>` +
      hintBtn("bugClass") + `<div class="options">${opts}</div>`;
    if (!prog.classResult) el.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => guessClass(b.dataset.class)));
  } else if (prog.stage === 3) {
    const w = p.stages.why;
    const opts = w.options.map((o, i) =>
      `<button class="opt${whyStateClass(prog, p, i)}" data-i="${i}"><span>${escapeHtml(o.label)}</span>` +
      (prog.whyPick != null && o.whyWrong ? `<span class="why">${escapeHtml(o.whyWrong)}</span>` : "") + `</button>`).join("");
    el.innerHTML = `<h2>Stage 3 of 4 — Why is it exploitable?</h2>` +
      `<p class="hint">${escapeHtml(w.prompt || "Pick the explanation that describes the actual mechanism.")}</p>` +
      hintBtn("why") + `<div class="options">${opts}</div>`;
    if (prog.whyPick == null) el.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => guessWhy(parseInt(b.dataset.i, 10))));
  } else if (prog.stage === 4) {
    const opts = p.stages.fix.options.map((o, i) =>
      `<button class="opt${fixStateClass(prog, p, i)}" data-i="${i}"><strong>${escapeHtml(o.label)}</strong>` +
      `<pre>${diffHtml(o.diff)}</pre>` +
      (prog.fixPick != null && o.whyWrong ? `<span class="why">${escapeHtml(o.whyWrong)}</span>` : "") + `</button>`).join("");
    el.innerHTML = `<h2>Stage 4 of 4 — Pick the fix that closes the hole</h2>` +
      `<p class="hint">One patch truly fixes it; the others look right but don't.</p>` +
      hintBtn("fix") + `<div class="options">${opts}</div>`;
    if (prog.fixPick == null) el.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => guessFix(parseInt(b.dataset.i, 10))));
  } else { el.innerHTML = ""; }
}

function classStateClass(prog, c) {
  if (!prog.classResult) return "";
  if (c === prog.classPick) return prog.classResult === "green" ? " correct" : prog.classResult === "yellow" ? " family" : " wrong";
  if (c === prog.puzzleAnswerClass) return " correct";
  return "";
}
function whyStateClass(prog, p, i) {
  if (prog.whyPick == null) return "";
  if (i === p.stages.why.answerIndex) return " correct";
  if (i === prog.whyPick) return " wrong";
  return "";
}
function fixStateClass(prog, p, i) {
  if (prog.fixPick == null) return "";
  if (i === p.stages.fix.answerIndex) return " correct";
  if (i === prog.fixPick) return " wrong";
  return "";
}
function diffHtml(diff) {
  return diff.split("\n").map((l) => {
    const e = escapeHtml(l);
    if (l.startsWith("+")) return `<span class="add">${e}</span>`;
    if (l.startsWith("-")) return `<span class="del">${e}</span>`;
    return e;
  }).join("\n");
}

// ---- actions ---------------------------------------------------------------
function guessLine(line, file) {
  const p = state.puzzle, prog = state.prog, ans = p.stages.line;
  if (prog.stage !== 1 || prog.lineGuesses.some((g) => g.line === line && (file || ans.file) === ans.file)) {
    if (prog.lineGuesses.some((g) => g.line === line)) return;
  }
  const sameFile = !file || file === ans.file;
  let result = "grey";
  if (sameFile && line === ans.line) result = "green";
  else if (sameFile && Math.abs(line - ans.line) <= ans.yellowRadius) result = "yellow";
  prog.lineGuesses.push({ line, result });
  if (result === "green") { prog.lineSolved = true; prog.stage = 2; }
  else if (!prog.learn && prog.lineGuesses.length >= ans.maxGuesses) { prog.stage = 2; }
  persistAndRender();
}
function guessClass(c) {
  const p = state.puzzle, prog = state.prog, ans = p.stages.bugClass.answer;
  if (prog.classResult) return;
  prog.classPick = c; prog.puzzleAnswerClass = ans;
  prog.classResult = (c === ans) ? "green" : (TAX.classes[c].family === TAX.classes[ans].family ? "yellow" : "grey");
  prog.stage = 3; persistAndRender();
}
function guessWhy(i) {
  const p = state.puzzle, prog = state.prog;
  if (prog.whyPick != null) return;
  prog.whyPick = i;
  prog.whyResult = (i === p.stages.why.answerIndex) ? "green" : "grey";
  prog.stage = 4; persistAndRender();
}
function guessFix(i) {
  const p = state.puzzle, prog = state.prog;
  if (prog.fixPick != null) return;
  prog.fixPick = i;
  prog.fixResult = (i === p.stages.fix.answerIndex) ? "green" : "grey";
  prog.stage = 5; prog.completedAt = new Date().toISOString();
  if (!prog.learn) bumpStreak(p.date);
  persistAndRender();
}
function persistAndRender() { saveProgress(progKey(), state.prog); render(); }

// ---- result ----------------------------------------------------------------
function shareText(p, prog) {
  const line = prog.lineGuesses.map((g) => SYM[g.result]).join("") || "⬜";
  const cls = SYM[prog.classResult] || "⬜";
  const why = prog.whyResult === "green" ? "🟩" : "🟥";
  const fix = prog.fixResult === "green" ? "🟩" : "🟥";
  const cap = p.difficulty[0].toUpperCase() + p.difficulty.slice(1);
  return `SourceReadle ${p.id} · ${cap} (${LANG_LABEL[p.language] || p.language})\n` +
    `Line  ${line}\nClass ${cls}\nWhy   ${why}\nFix   ${fix}` + (prog.learn ? "\n(learn mode)" : "");
}
function renderResult(p, prog) {
  const el = $("resultPanel");
  if (prog.stage < 5) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  const win = prog.lineSolved && prog.classResult === "green" && prog.whyResult === "green" && prog.fixResult === "green";
  const share = shareText(p, prog);
  const rn = (p.writeup.readNext || []).map((r) => `<a href="${r.url}" target="_blank" rel="noopener">${escapeHtml(r.label)} ↗</a>`).join("");
  el.innerHTML =
    `<h2>${win ? "Clean sweep 🎉" : "Solved — the breakdown"}</h2>` +
    `<div class="sharegrid">${escapeHtml(share)}</div>` +
    `<div class="row"><button class="btn" id="shareBtn">Share result</button></div>` +
    (p.training?.exploit ? `<div class="writeup"><h3>What the attack looks like</h3><p>${mdLite(p.training.exploit)}</p></div>` : "") +
    `<div class="writeup"><h3>Why it's vulnerable</h3><p>${mdLite(p.writeup.summary)}</p>` +
    (rn ? `<div class="readnext"><strong>Read next</strong>${rn}</div>` : "") +
    (p.source.fixCommit ? `<p class="readnext"><a href="${p.source.fixCommit}" target="_blank" rel="noopener">Upstream fix commit ↗</a></p>` :
      (p.source.advisory ? `<p class="readnext"><a href="${p.source.advisory}" target="_blank" rel="noopener">Advisory ↗</a></p>` : "")) +
    `</div>`;
  $("shareBtn").addEventListener("click", async () => {
    const text = share + "\n" + location.href;
    if (navigator.share) { try { await navigator.share({ text }); return; } catch {} }
    try { await navigator.clipboard.writeText(text); $("shareBtn").textContent = "Copied ✓"; }
    catch { $("shareBtn").textContent = "Copy failed"; }
    setTimeout(() => { const b = $("shareBtn"); if (b) b.textContent = "Share result"; }, 1500);
  });
}

// ---- render ----------------------------------------------------------------
function render() {
  const p = state.puzzle;
  if (!p) {
    $("meta").innerHTML = "";
    $("codePanel").innerHTML = `<div class="filename">No ${state.diff} puzzle for ${state.date}.</div>`;
    $("stagePanel").innerHTML = ""; $("notePanel").classList.add("hidden"); $("resultPanel").classList.add("hidden");
    return;
  }
  renderMeta(p);
  renderCode(p, state.prog);
  renderStage(p, state.prog);
  renderResult(p, state.prog);
  renderStreak();
  $("explainBtn").setAttribute("aria-pressed", state.explain ? "true" : "false");
  $("learnBtn").setAttribute("aria-pressed", state.prog.learn ? "true" : "false");
  if (!state.explain) { $("notePanel").classList.add("hidden"); state.selectedNote = null; }
}

function fmtDate(d) { return new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }

async function load() {
  const p = await getPuzzle(state.date, state.diff);
  state.puzzle = p; state.explain = false; state.selectedNote = null;
  if (p) {
    state.prog = getProgress(progKey()) || freshProgress(p);
    if (state.prog.learn === undefined) state.prog.learn = learnOn();
    if (state.prog.stage > 1) state.prog.puzzleAnswerClass = p.stages.bugClass.answer;
  }
  $("dateLabel").textContent = fmtDate(state.date);
  document.querySelectorAll("#difftabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.diff === state.diff ? "true" : "false"));
  $("prevDay").disabled = INDEX.dates.indexOf(state.date) <= 0;
  $("nextDay").disabled = INDEX.dates.indexOf(state.date) >= INDEX.dates.length - 1;
  render();
}

function wire() {
  document.querySelectorAll("#difftabs button").forEach((b) => b.addEventListener("click", () => { state.diff = b.dataset.diff; load(); }));
  $("prevDay").addEventListener("click", () => { const i = INDEX.dates.indexOf(state.date); if (i > 0) { state.date = INDEX.dates[i - 1]; load(); } });
  $("nextDay").addEventListener("click", () => { const i = INDEX.dates.indexOf(state.date); if (i < INDEX.dates.length - 1) { state.date = INDEX.dates[i + 1]; load(); } });
  $("explainBtn").addEventListener("click", () => { state.explain = !state.explain; if (!state.explain) $("notePanel").classList.add("hidden"); render(); });
  $("learnBtn").addEventListener("click", () => {
    const now = !state.prog.learn; setLearn(now); state.prog.learn = now;
    saveProgress(progKey(), state.prog); render();
  });
}

async function main() {
  INDEX = await loadJSON("index.json");
  const tax = await loadJSON("taxonomy.json");
  TAX = { classes: tax.classes, families: tax.families };
  if (!INDEX.dates || INDEX.dates.length === 0) { $("codePanel").innerHTML = `<div class="filename">No puzzles published yet.</div>`; return; }
  state.date = INDEX.dates[INDEX.dates.length - 1];
  wire();
  await load();
}
main().catch((e) => { $("codePanel").innerHTML = `<div class="filename">Failed to load: ${escapeHtml(String(e.message || e))}</div>`; });
