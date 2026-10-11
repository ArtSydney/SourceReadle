"use strict";

// ---- data loading ----------------------------------------------------------
let INDEX = null;
let TAX = null;
const puzzleCache = new Map();

const STAGES = ["line", "bugClass", "why", "fix"]; // ordered; stage index 1..4, 5 = done
const state = { date: null, diff: "easy", puzzle: null, prog: null, explain: false, selectedNote: null, lang: "", introIndex: 0, verifiedOnly: false };

const $ = (id) => document.getElementById(id);
// Push a short message to the polite live region for screen-reader feedback.
function announce(msg) { const el = $("live"); if (el) { el.textContent = ""; requestAnimationFrame(() => { el.textContent = msg; }); } }

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
function progKey() { return state.diff === "intro" ? `intro/${state.introIndex}` : `${state.date}/${state.diff}`; }
// Scaffolding (Intro tier): highlight the answer line, unlimited taps, 2 options, hints shown.
function isScaffold() { return !!(state.puzzle && state.puzzle.scaffold); }
function seedOf(p) { return parseInt(String(p.id || "").replace(/\D/g, "").slice(-3) || "0", 10); }
function twoPos(ansPos, seed) { const w = ansPos === 0 ? 1 : 0; return (seed % 2) ? [w, ansPos] : [ansPos, w]; }
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
function renderStreak() {
  const s = getStreak();
  // A streak whose last play is older than yesterday has lapsed, even if not yet overwritten.
  const y = new Date(localToday() + "T00:00:00Z"); y.setUTCDate(y.getUTCDate() - 1);
  const cur = s.last && s.last >= y.toISOString().slice(0, 10) ? s.cur : 0;
  $("streak").textContent = `🔥 ${cur}` + (s.max > cur ? ` / ${s.max}` : "");
}

// ---- helpers ---------------------------------------------------------------
const LANG_LABEL = { python: "Python", csharp: "C#", c: "C", cpp: "C++", javascript: "JavaScript", go: "Go", java: "Java", ruby: "Ruby", php: "PHP", rust: "Rust" };
const SYM = { green: "🟩", yellow: "🟨", grey: "⬜" };
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
// Puzzle content is LLM-generated; only ever emit http(s) links from it.
function safeUrl(u) { try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? escapeHtml(x.href) : null; } catch { return null; } }
function mdLite(s) { return escapeHtml(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"); }
function fileLines(f) { const a = f.code.split("\n"); if (a.length && a[a.length - 1] === "") a.pop(); return a; }

// ---- meta ------------------------------------------------------------------
function renderMeta(p) {
  // Keep it minimal: language + time, and credit the CVE/project when there is one.
  const src = p.source.origin === "cve"
    ? `<span class="pill cve">${escapeHtml(p.source.cve)}</span>` +
      (p.source.project ? `<span class="pill">${escapeHtml(p.source.project)}</span>` : "")
    : "";
  const verified = p.verified
    ? `<span class="pill verified" title="Answer key proven by running it: the correct fix blocks a real exploit; the wrong ones don't.">✓ Verified</span>` : "";
  $("meta").innerHTML =
    `<span class="pill">${escapeHtml(LANG_LABEL[p.language] || p.language)}</span>` +
    `<span class="pill">~${p.estimatedMinutes || "?"} min</span>` + verified + src;
  // The report link opens a structured modal (wired in wireReport); keep href inert.
  $("reportLink").setAttribute("href", "#");
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
      const g = prog.lineGuesses.find((x) => x.line === lineNo && (x.file || ans.file) === f.name);
      if (g) row.classList.add("g-" + g.result);
      if (prog.stage > 1 && f.name === ans.file && lineNo === ans.line) row.classList.add("reveal");
      if (isScaffold() && prog.stage === 1 && f.name === ans.file && lineNo === ans.line) row.classList.add("target");
      if (state.explain && state.selectedNote && state.selectedNote.file === f.name && state.selectedNote.line === lineNo) row.classList.add("noted");
      if (f.notes && f.notes[String(lineNo)]) row.classList.add("has-note");

      const ln = document.createElement("span"); ln.className = "ln"; ln.textContent = lineNo;
      const src = document.createElement("span"); src.className = "src"; src.textContent = text;
      row.append(ln, src);

      // Non-colour cue: a short word label beside any line that carries a verdict,
      // so the feedback reads without relying on the green/yellow/grey fill.
      const markText = g ? { green: "exact", yellow: "near", grey: "cold" }[g.result]
        : (row.classList.contains("reveal") ? "the bug" : "");
      if (markText) {
        const m = document.createElement("span"); m.className = "mark"; m.textContent = markText;
        row.append(m);
      }

      const interactive = state.explain || guessing;
      if (interactive) {
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        row.setAttribute("aria-label",
          (state.explain ? "Explain line " : "Line ") + lineNo + ": " + (text.trim() || "blank line"));
        const activate = () => { if (state.explain) showNote(f, lineNo); else guessLine(lineNo, f.name); };
        row.addEventListener("click", activate);
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); }
        });
      } else if (markText) {
        row.setAttribute("aria-label", "Line " + lineNo + ": " + (text.trim() || "blank line") + " — " + markText);
      }
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
  if (!h || (!state.prog.learn && !isScaffold())) return "";
  return `<details class="hint-d"${isScaffold() ? " open" : ""}><summary>Hint</summary><div>${mdLite(h)}</div></details>`;
}

function verdictBanner(result, headline, detail) {
  const v = result === "green" ? "v-green" : result === "yellow" ? "v-yellow" : "v-grey";
  return `<div class="verdict ${v}"><strong>${headline}</strong>${detail ? " " + detail : ""}</div>`;
}
const continueBar = (label) => `<div class="row"><button class="btn" id="stageNext">${label}</button></div>`;
function wireContinue() {
  const b = $("stageNext");
  if (b) { b.addEventListener("click", advanceStage); b.focus(); }
}

function renderStage(p, prog) {
  const el = $("stagePanel");
  const scaf = isScaffold();
  const seed = scaf ? seedOf(p) : 0;
  if (prog.stage === 1) {
    const unlimited = prog.learn || scaf;
    const left = p.stages.line.maxGuesses - prog.lineGuesses.length;
    const dots = prog.lineGuesses.map((g) => SYM[g.result]).join("") || "—";
    const hintP = scaf
      ? `The bug is on the <strong>highlighted</strong> line. Tap it to confirm.`
      : `Tap the line where the bug lives. Feedback: exact, near (within ${p.stages.line.yellowRadius} lines), or cold.` +
        (unlimited ? ` <em>Learn mode: unlimited guesses.</em>` : ` ${left} guess${left === 1 ? "" : "es"} left.`);
    el.innerHTML =
      `<h2>Stage 1 of 4 — Find the vulnerable line</h2>` +
      `<p class="hint">${hintP}</p>` +
      `<div class="guessdots">${dots}</div>` + hintBtn("line") +
      (prog.learn && !scaf ? `<button class="btn secondary sm" id="revealLine">Reveal the line</button>` : "");
    const rb = $("revealLine"); if (rb) rb.addEventListener("click", () => { prog.stage = 2; announce("Line revealed. Stage 2 of 4: name the bug class."); persistAndRender(); });
  } else if (prog.stage === 2) {
    let classes = p.stages.bugClass.options;
    if (scaf) { const ai = classes.indexOf(p.stages.bugClass.answer); const [a, b] = twoPos(ai < 0 ? 0 : ai, seed); classes = [classes[a], classes[b]]; }
    const opts = classes.map((c) =>
      `<button class="opt${classStateClass(prog, c)}" data-class="${escapeHtml(c)}">${escapeHtml(TAX.classes[c]?.label || c)}</button>`).join("");
    let tail = "";
    if (prog.classResult) {
      const ansLabel = escapeHtml(TAX.classes[p.stages.bugClass.answer]?.label || p.stages.bugClass.answer);
      const pickLabel = escapeHtml(TAX.classes[prog.classPick]?.label || prog.classPick);
      const head = prog.classResult === "green" ? "Correct." : prog.classResult === "yellow" ? "Right family." : "Not quite.";
      const detail = prog.classResult === "green" ? `It's <strong>${ansLabel}</strong>.`
        : `You picked <strong>${pickLabel}</strong>; it's <strong>${ansLabel}</strong>.`;
      tail = verdictBanner(prog.classResult, head, detail) + continueBar("Continue");
    }
    el.innerHTML = `<h2>Stage 2 of 4 — Name the bug class</h2>` +
      `<p class="hint">What kind of vulnerability is it?${scaf ? "" : " A near miss means the right family but the wrong class."}</p>` +
      hintBtn("bugClass") + `<div class="options">${opts}</div>` + tail;
    if (!prog.classResult) el.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => guessClass(b.dataset.class)));
    else wireContinue();
  } else if (prog.stage === 3) {
    const w = p.stages.why;
    let items = w.options.map((o, i) => ({ o, i }));
    if (scaf) { const [a, b] = twoPos(w.answerIndex, seed); items = [items[a], items[b]]; }
    const opts = items.map(({ o, i }) =>
      `<button class="opt${whyStateClass(prog, p, i)}" data-i="${i}"><span>${escapeHtml(o.label)}</span>` +
      (prog.whyPick != null && o.whyWrong ? `<span class="why">${escapeHtml(o.whyWrong)}</span>` : "") + `</button>`).join("");
    let tail = "";
    if (prog.whyPick != null) {
      tail = (prog.whyResult === "green"
        ? verdictBanner("green", "Correct.", "")
        : verdictBanner("grey", "Not quite.", "The correct answer is highlighted below.")) + continueBar("Continue");
    }
    el.innerHTML = `<h2>Stage 3 of 4 — Why is it exploitable?</h2>` +
      `<p class="hint">${escapeHtml(w.prompt || "Pick the explanation that describes the actual mechanism.")}</p>` +
      hintBtn("why") + `<div class="options">${opts}</div>` + tail;
    if (prog.whyPick == null) el.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => guessWhy(parseInt(b.dataset.i, 10))));
    else wireContinue();
  } else if (prog.stage === 4) {
    const fx = p.stages.fix;
    let items = fx.options.map((o, i) => ({ o, i }));
    if (scaf) { const [a, b] = twoPos(fx.answerIndex, seed); items = [items[a], items[b]]; }
    const opts = items.map(({ o, i }) =>
      `<button class="opt${fixStateClass(prog, p, i)}" data-i="${i}"><strong>${escapeHtml(o.label)}</strong>` +
      `<pre>${diffHtml(o.diff)}</pre>` +
      (prog.fixPick != null && o.whyWrong ? `<span class="why">${escapeHtml(o.whyWrong)}</span>` : "") + `</button>`).join("");
    let tail = "";
    if (prog.fixPick != null) {
      tail = (prog.fixResult === "green"
        ? verdictBanner("green", "Correct.", "That patch closes the hole.")
        : verdictBanner("grey", "Not quite.", "The fix that works is highlighted below.")) + continueBar("See results");
    }
    el.innerHTML = `<h2>Stage 4 of 4 — Pick the fix that closes the hole</h2>` +
      `<p class="hint">One patch truly fixes it; the others look right but don't.</p>` +
      hintBtn("fix") + `<div class="options">${opts}</div>` + tail;
    if (prog.fixPick == null) el.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => guessFix(parseInt(b.dataset.i, 10))));
    else wireContinue();
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
  if (prog.stage !== 1) return;
  const f = file || ans.file;
  if (prog.lineGuesses.some((g) => g.line === line && (g.file || ans.file) === f)) return;
  const sameFile = f === ans.file;
  let result = "grey";
  if (sameFile && line === ans.line) result = "green";
  else if (sameFile && Math.abs(line - ans.line) <= ans.yellowRadius) result = "yellow";
  prog.lineGuesses.push({ line, file: f, result });
  if (result === "green") { prog.lineSolved = true; prog.stage = 2; announce("Exact. Stage 2 of 4: name the bug class."); }
  else if (!prog.learn && !isScaffold() && prog.lineGuesses.length >= ans.maxGuesses) { prog.stage = 2; announce("Out of guesses. Stage 2 of 4: name the bug class."); }
  else announce(result === "yellow" ? "Near — within a few lines. Try again." : "Cold. Try again.");
  persistAndRender();
}
// Choice stages record the pick and reveal the verdict, but DON'T auto-advance —
// the player sees whether they were right, then taps Continue (advanceStage).
function guessClass(c) {
  const p = state.puzzle, prog = state.prog, ans = p.stages.bugClass.answer;
  if (prog.classResult) return;
  prog.classPick = c; prog.puzzleAnswerClass = ans;
  prog.classResult = (c === ans) ? "green" : (TAX.classes[c]?.family && TAX.classes[c].family === TAX.classes[ans]?.family ? "yellow" : "grey");
  announce(prog.classResult === "green" ? "Correct." : prog.classResult === "yellow" ? "Right family, wrong class." : "Wrong.");
  persistAndRender();
}
function guessWhy(i) {
  const p = state.puzzle, prog = state.prog;
  if (prog.whyPick != null) return;
  prog.whyPick = i;
  prog.whyResult = (i === p.stages.why.answerIndex) ? "green" : "grey";
  announce(prog.whyResult === "green" ? "Correct." : "Not quite.");
  persistAndRender();
}
function guessFix(i) {
  const p = state.puzzle, prog = state.prog;
  if (prog.fixPick != null) return;
  prog.fixPick = i;
  prog.fixResult = (i === p.stages.fix.answerIndex) ? "green" : "grey";
  prog.completedAt = new Date().toISOString();
  if (state.diff !== "intro" && !prog.learn && !prog.usedLearn && state.date === localToday()) bumpStreak(state.date);
  announce(prog.fixResult === "green" ? "Correct fix." : "Wrong fix.");
  persistAndRender();
}
// Move to the next stage after a revealed verdict (5 = the breakdown).
function advanceStage() {
  state.prog.stage++;
  if (state.prog.stage === 5) announce("Solved — scored " + stageScore(state.prog) + " of 4. See the breakdown below.");
  persistAndRender();
}
function persistAndRender() { saveProgress(progKey(), state.prog); render(); }

// ---- result ----------------------------------------------------------------
// Stages fully nailed (green), out of 4 — the headline "score" for sharing.
function stageScore(prog) {
  return (prog.lineSolved ? 1 : 0) + (prog.classResult === "green" ? 1 : 0) +
    (prog.whyResult === "green" ? 1 : 0) + (prog.fixResult === "green" ? 1 : 0);
}
// A solid 4-row square grid, Wordle-style. Row 1 is the line-search journey
// (one cell per tap, in order); rows 2-4 are the Class/Why/Fix verdicts,
// each centered in a band of ⬛ "inactive" cells so the block stays a rectangle.
// ⬛ padding is deliberately distinct from ⬜ (an actual cold miss).
function shareGrid(prog) {
  const taps = prog.lineGuesses.map((g) => SYM[g.result]);
  if (!taps.length) taps.push("⬜");
  const trimmed = taps.length > 6 ? taps.slice(-6) : taps;   // keep the block tidy
  const W = trimmed.length;
  const center = Math.floor((W - 1) / 2);
  const band = (glyph) => Array.from({ length: W }, (_, i) => (i === center ? glyph : "⬛")).join("");
  const cls = SYM[prog.classResult] || "⬜";
  const why = prog.whyResult === "green" ? "🟩" : "🟥";
  const fix = prog.fixResult === "green" ? "🟩" : "🟥";
  return [trimmed.join(""), band(cls), band(why), band(fix)].join("\n");
}
function shareText(p, prog) {
  const cap = p.difficulty[0].toUpperCase() + p.difficulty.slice(1);
  const score = stageScore(prog);
  return `SourceReadle ${p.id} · ${cap}\n` +
    `${LANG_LABEL[p.language] || p.language} · ${score}/4` +
    (prog.learn ? " · learn" : "") + "\n\n" + shareGrid(prog);
}
// Words, not just colour — a text readout of each stage's result for the breakdown.
function scorecardHtml(prog) {
  const taps = prog.lineGuesses.length;
  const row = (dt, text, result) => `<dt>${dt}</dt><dd class="r-${result}">${text}</dd>`;
  const clsText = prog.classResult === "green" ? "Correct" : prog.classResult === "yellow" ? "Right family, wrong class" : "Wrong";
  return `<dl class="scorecard">` +
    row("Find", prog.lineSolved ? `Solved in ${taps} tap${taps === 1 ? "" : "s"}` : "Not found", prog.lineSolved ? "green" : "grey") +
    row("Class", clsText, prog.classResult || "grey") +
    row("Why", prog.whyResult === "green" ? "Correct" : "Wrong", prog.whyResult === "green" ? "green" : "grey") +
    row("Fix", prog.fixResult === "green" ? "Correct" : "Wrong", prog.fixResult === "green" ? "green" : "grey") +
    `</dl>`;
}
function renderResult(p, prog) {
  const el = $("resultPanel");
  if (prog.stage < 5) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  const win = prog.lineSolved && prog.classResult === "green" && prog.whyResult === "green" && prog.fixResult === "green";
  const share = shareText(p, prog);
  const rn = (p.writeup.readNext || []).map((r) => { const u = safeUrl(r.url); return u ? `<a href="${u}" target="_blank" rel="noopener">${escapeHtml(r.label)} ↗</a>` : ""; }).join("");
  const fixUrl = safeUrl(p.source.fixCommit), advUrl = safeUrl(p.source.advisory);
  el.innerHTML =
    `<h2>${win ? "Clean sweep" : "Solved — the breakdown"}</h2>` +
    `<div class="sharegrid">${escapeHtml(share)}</div>` +
    `<div class="sharelegend">rows, top to bottom: find&nbsp;·&nbsp;class&nbsp;·&nbsp;why&nbsp;·&nbsp;fix</div>` +
    scorecardHtml(prog) +
    `<div class="row"><button class="btn" id="shareBtn">Share result</button></div>` +
    (p.training?.exploit ? `<div class="writeup"><h3>What the attack looks like</h3><p>${mdLite(p.training.exploit)}</p></div>` : "") +
    `<div class="writeup"><h3>Why it's vulnerable</h3><p>${mdLite(p.writeup.summary)}</p>` +
    (rn ? `<div class="readnext"><strong>Read next</strong>${rn}</div>` : "") +
    (fixUrl ? `<p class="readnext"><a href="${fixUrl}" target="_blank" rel="noopener">Upstream fix commit ↗</a></p>` :
      (advUrl ? `<p class="readnext"><a href="${advUrl}" target="_blank" rel="noopener">Advisory ↗</a></p>` : "")) +
    `</div>`;
  $("shareBtn").addEventListener("click", async () => {
    const text = share + "\n" + location.href;
    if (navigator.share) { try { await navigator.share({ text }); return; } catch {} }
    try { await navigator.clipboard.writeText(text); $("shareBtn").textContent = "Copied"; }
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

// Mark the active difficulty tab and apply roving tabindex (only the selected
// tab is in the tab order; arrows move between the rest).
function setDiffTabs(active) {
  document.querySelectorAll("#difftabs button").forEach((b) => {
    const on = b.dataset.diff === active;
    b.setAttribute("aria-selected", on ? "true" : "false");
    b.tabIndex = on ? 0 : -1;
  });
}

function fmtDate(d) { return new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); }

// ---- date clamping + language filter --------------------------------------
const LANGKEY = "sourcereadle:lang:v1";
function getLangPref() { try { return localStorage.getItem(LANGKEY) || ""; } catch { return ""; } }
function setLangPref(v) { try { v ? localStorage.setItem(LANGKEY, v) : localStorage.removeItem(LANGKEY); } catch {} }
// "Verified by execution" filter: show only puzzles whose answer key was proven by running it.
const VFKEY = "sourcereadle:verifiedonly:v1";
function verifiedOnlyPref() { try { return localStorage.getItem(VFKEY) === "1"; } catch { return false; } }
function setVerifiedOnly(v) { try { v ? localStorage.setItem(VFKEY, "1") : localStorage.removeItem(VFKEY); } catch {} }
function isVerified(date, diff) { return !!(INDEX.verifiedByDate && INDEX.verifiedByDate[date] && INDEX.verifiedByDate[date][diff]); }

function localToday() { const n = new Date(); const p = (x) => String(x).padStart(2, "0"); return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`; }
// Latest published date not past the viewer's own local date — so nobody plays ahead.
function maxPlayable() { const t = localToday(); const le = INDEX.dates.filter((d) => d <= t); return le.length ? le[le.length - 1] : INDEX.dates[0]; }
// Dates the viewer may open, honoring the language filter for the current difficulty.
function playableDates() {
  const max = maxPlayable();
  return INDEX.dates.filter((d) => d <= max
    && (!state.lang || (INDEX.byDate[d] && INDEX.byDate[d][state.diff] === state.lang))
    && (!state.verifiedOnly || isVerified(d, state.diff)));
}
function resolveDate(prefer) {
  const pd = playableDates();
  if (!pd.length) return null;
  const le = pd.filter((d) => d <= (prefer || pd[pd.length - 1]));
  return le.length ? le[le.length - 1] : pd[0];
}

// Only offer languages that actually have a playable puzzle at the current
// difficulty, so no dropdown choice leads to an empty screen.
function populateLangs() {
  const max = maxPlayable();
  const langs = new Set();
  for (const d of INDEX.dates) { if (d > max) continue; if (state.verifiedOnly && !isVerified(d, state.diff)) continue; const m = INDEX.byDate[d]; if (m && m[state.diff]) langs.add(m[state.diff]); }
  const list = [...langs].sort();
  if (state.lang && !list.includes(state.lang)) state.lang = "";
  $("langSelect").innerHTML = `<option value="">All languages</option>` +
    list.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(LANG_LABEL[l] || l)}</option>`).join("");
  $("langSelect").value = state.lang;
}

async function loadIntro() {
  const list = INDEX.intro || [];
  $("langSelect").style.display = "none";
  $("verifiedBtn").style.display = "none";
  setDiffTabs("intro");
  if (!list.length) {
    state.puzzle = null; $("meta").innerHTML = ""; $("stagePanel").innerHTML = ""; $("notePanel").classList.add("hidden"); $("resultPanel").classList.add("hidden");
    $("dateLabel").textContent = "Intro"; $("codePanel").className = "code";
    $("codePanel").innerHTML = `<div class="filename">No intro lessons yet.</div>`;
    $("prevDay").disabled = $("nextDay").disabled = true; return;
  }
  state.introIndex = Math.max(0, Math.min(state.introIndex, list.length - 1));
  let p = null;
  try { p = await loadJSON(`intro/${list[state.introIndex]}`); } catch {}
  state.puzzle = p; state.explain = false; state.selectedNote = null;
  if (p) {
    state.prog = getProgress(progKey()) || freshProgress(p);
    if (state.prog.learn === undefined) state.prog.learn = learnOn();
    if (state.prog.stage > 1) state.prog.puzzleAnswerClass = p.stages.bugClass.answer;
  }
  $("dateLabel").innerHTML = `Intro · Lesson ${state.introIndex + 1} / ${list.length}`;
  $("prevDay").disabled = state.introIndex <= 0;
  $("nextDay").disabled = state.introIndex >= list.length - 1;
  render();
}

async function load() {
  if (state.diff === "intro") return loadIntro();
  $("langSelect").style.display = "";
  $("verifiedBtn").style.display = "";
  populateLangs();
  const pd = playableDates();
  if (!pd.includes(state.date)) state.date = pd.length ? pd[pd.length - 1] : null;

  setDiffTabs(state.diff);

  if (!state.date) {
    $("meta").innerHTML = ""; $("stagePanel").innerHTML = ""; $("notePanel").classList.add("hidden"); $("resultPanel").classList.add("hidden");
    $("dateLabel").textContent = "—";
    $("codePanel").className = "code";
    const langPhrase = state.lang ? `${LANG_LABEL[state.lang] || state.lang} ` : "";
    $("codePanel").innerHTML = state.verifiedOnly
      ? `<div class="filename">No execution-verified ${langPhrase}puzzles at this difficulty yet — turn off "Verified only", or try another difficulty.</div>`
      : `<div class="filename">No ${langPhrase}puzzles at this difficulty yet — try another language or difficulty.</div>`;
    $("prevDay").disabled = $("nextDay").disabled = true;
    return;
  }

  const p = await getPuzzle(state.date, state.diff);
  state.puzzle = p; state.explain = false; state.selectedNote = null;
  if (p) {
    state.prog = getProgress(progKey()) || freshProgress(p);
    if (state.prog.learn === undefined) state.prog.learn = learnOn();
    if (state.prog.stage > 1) state.prog.puzzleAnswerClass = p.stages.bugClass.answer;
  }
  const isToday = state.date === localToday();
  $("dateLabel").innerHTML = fmtDate(state.date) + (isToday ? ` <span class="todaytag">Today</span>` : "");
  const i = pd.indexOf(state.date);
  $("prevDay").disabled = i <= 0;
  $("nextDay").disabled = i < 0 || i >= pd.length - 1;
  render();
}

// ---- first-run tutorial ----------------------------------------------------
const TKEY = "sourcereadle:tutorial:v1";
let tutIndex = 0;
const TUT_STEPS = [
  { title: "Welcome to SourceReadle", body:
    `<p>Find the hidden security bug in a short piece of real code — a new puzzle every day.</p>
     <p class="muted">Four quick stages. Here's how each one works.</p>` },
  { title: "1 · Find the line", body:
    `<p>Tap the line of code where the vulnerability lives.</p>
     <div class="glyphs">🟩 🟨 ⬜</div>
     <p class="muted">Green is exact, yellow is within a few lines, grey is cold. You get 5 taps.</p>` },
  { title: "2 · Name the bug class", body:
    `<p>What <em>kind</em> of flaw is it — SQL injection, path traversal, use-after-free…?</p>
     <p class="muted">A near miss means the right family but the wrong specific class.</p>` },
  { title: "3 · Why is it exploitable?", body:
    `<p>Pick the explanation of how an attacker actually abuses it.</p>
     <p class="muted">This is the part that makes you better — understand the mechanism, not just spot it.</p>` },
  { title: "4 · Pick the fix", body:
    `<p>One patch truly closes the hole; the others look right but don't.</p>
     <p class="muted">Stuck? Tap <strong>Explain</strong> to see what any line does, or <strong>Learn</strong> for hints with no streak pressure. Tap <strong>?</strong> anytime to replay this.</p>` },
];
function renderTut() {
  const s = TUT_STEPS[tutIndex];
  $("tutBody").innerHTML = `<h2>${s.title}</h2>${s.body}`;
  $("tutDots").innerHTML = TUT_STEPS.map((_, i) => `<span class="dot${i === tutIndex ? " on" : ""}"></span>`).join("");
  $("tutNext").textContent = tutIndex === TUT_STEPS.length - 1 ? "Play ▶" : "Next";
  $("tutBack").style.visibility = tutIndex === 0 ? "hidden" : "visible";
}
function openTutorial() { tutIndex = 0; $("tutorial").classList.remove("hidden"); renderTut(); }
function closeTutorial() { $("tutorial").classList.add("hidden"); try { localStorage.setItem(TKEY, "1"); } catch {} }
function wireTutorial() {
  $("helpBtn").addEventListener("click", openTutorial);
  $("tutSkip").addEventListener("click", closeTutorial);
  $("tutBack").addEventListener("click", () => { if (tutIndex > 0) { tutIndex--; renderTut(); } });
  $("tutNext").addEventListener("click", () => { if (tutIndex < TUT_STEPS.length - 1) { tutIndex++; renderTut(); } else closeTutorial(); });
  document.addEventListener("keydown", (e) => { if (!$("tutorial").classList.contains("hidden") && e.key === "Escape") closeTutorial(); });
}
function maybeShowTutorial() { let seen; try { seen = localStorage.getItem(TKEY); } catch {} if (!seen) openTutorial(); }

// ---- report ----------------------------------------------------------------
const REPO = "ArtSydney/SourceReadle";
const REPORT_STAGES = [
  ["line", "Finding the line"],
  ["bugClass", "Naming the bug class"],
  ["why", "Why it's exploitable"],
  ["fix", "Picking the fix"],
  ["code", "The code / snippet itself"],
  ["other", "Something else"],
];
let reportStage = null;
function reportWhere(p) {
  return state.diff === "intro" ? `Intro · Lesson ${state.introIndex + 1}` : `${p.date} · ${p.difficulty}`;
}
function reportContext(p, prog) {
  const cap = p.difficulty[0].toUpperCase() + p.difficulty.slice(1);
  let ctx = `Puzzle: ${p.id} — ${cap} (${LANG_LABEL[p.language] || p.language})\nWhere: ${reportWhere(p)}\nApp: v11`;
  if (p.source && p.source.origin === "cve" && p.source.cve) ctx += `\nSource: ${p.source.cve}`;
  if (prog && prog.stage >= 5) ctx += `\n\n${shareText(p, prog)}`;
  return ctx;
}
function renderReportChips() {
  $("reportStages").innerHTML = REPORT_STAGES
    .map(([k, label]) => `<button type="button" data-k="${k}" aria-pressed="${reportStage === k}">${label}</button>`)
    .join("");
  $("reportStages").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => { reportStage = b.dataset.k; renderReportChips(); }));
}
function openReport() {
  if (!state.puzzle) return;
  reportStage = null;
  renderReportChips();
  $("reportText").value = "";
  $("reportCtx").textContent = reportContext(state.puzzle, state.prog);
  $("report").classList.remove("hidden");
}
function closeReport() { $("report").classList.add("hidden"); }
function submitReport() {
  const p = state.puzzle; if (!p) return;
  const stageLabel = (REPORT_STAGES.find(([k]) => k === reportStage) || [, "Unspecified"])[1];
  const details = $("reportText").value.trim();
  const body =
    `**Which part seemed wrong:** ${stageLabel}\n\n` +
    `**Details:**\n${details || "_(none provided)_"}\n\n` +
    `---\n\`\`\`\n${reportContext(p, state.prog)}\n\`\`\`\n`;
  const url = `https://github.com/${REPO}/issues/new` +
    `?labels=${encodeURIComponent("player-report")}` +
    `&title=${encodeURIComponent(`Puzzle report: ${p.id} — ${stageLabel}`)}` +
    `&body=${encodeURIComponent(body)}`;
  window.open(url, "_blank", "noopener");
  closeReport();
}
function wireReport() {
  $("reportLink").addEventListener("click", (e) => { e.preventDefault(); openReport(); });
  $("reportClose").addEventListener("click", closeReport);
  $("reportCancel").addEventListener("click", closeReport);
  $("reportSubmit").addEventListener("click", submitReport);
  document.addEventListener("keydown", (e) => { if (!$("report").classList.contains("hidden") && e.key === "Escape") closeReport(); });
}

function wire() {
  wireTutorial();
  wireReport();
  const tabs = [...document.querySelectorAll("#difftabs button")];
  tabs.forEach((b) => b.addEventListener("click", () => { state.diff = b.dataset.diff; load(); }));
  // Arrow-key navigation within the tablist (ARIA roving-tabindex pattern).
  $("difftabs").addEventListener("keydown", (e) => {
    const i = tabs.findIndex((b) => b.dataset.diff === state.diff);
    let j = i;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = tabs.length - 1;
    else return;
    e.preventDefault();
    state.diff = tabs[j].dataset.diff; tabs[j].focus(); load();
  });
  $("prevDay").addEventListener("click", () => {
    if (state.diff === "intro") { if (state.introIndex > 0) { state.introIndex--; load(); } return; }
    const pd = playableDates(); const i = pd.indexOf(state.date); if (i > 0) { state.date = pd[i - 1]; load(); }
  });
  $("nextDay").addEventListener("click", () => {
    if (state.diff === "intro") { if (state.introIndex < (INDEX.intro || []).length - 1) { state.introIndex++; load(); } return; }
    const pd = playableDates(); const i = pd.indexOf(state.date); if (i >= 0 && i < pd.length - 1) { state.date = pd[i + 1]; load(); }
  });
  $("langSelect").addEventListener("change", () => { state.lang = $("langSelect").value; setLangPref(state.lang); state.date = resolveDate(state.date); load(); });
  $("verifiedBtn").addEventListener("click", () => {
    state.verifiedOnly = !state.verifiedOnly; setVerifiedOnly(state.verifiedOnly);
    $("verifiedBtn").setAttribute("aria-pressed", state.verifiedOnly ? "true" : "false");
    if (state.diff !== "intro") state.date = resolveDate(state.date);
    load();
  });
  $("explainBtn").addEventListener("click", () => { state.explain = !state.explain; if (!state.explain) $("notePanel").classList.add("hidden"); render(); });
  $("learnBtn").addEventListener("click", () => {
    const now = !state.prog.learn; setLearn(now); state.prog.learn = now;
    if (now && state.prog.stage < 5) state.prog.usedLearn = true;   // hints/reveals seen: no streak credit
    saveProgress(progKey(), state.prog); render();
  });
}

async function main() {
  INDEX = await loadJSON("index.json");
  const tax = await loadJSON("taxonomy.json");
  TAX = { classes: tax.classes, families: tax.families };
  if (!INDEX.dates || INDEX.dates.length === 0) { $("codePanel").innerHTML = `<div class="filename">No puzzles published yet — check back on launch day.</div>`; return; }
  state.lang = getLangPref();
  state.verifiedOnly = verifiedOnlyPref();
  $("verifiedBtn").setAttribute("aria-pressed", state.verifiedOnly ? "true" : "false");
  state.date = resolveDate(maxPlayable());
  if (!state.date && state.verifiedOnly) { state.verifiedOnly = false; setVerifiedOnly(false); $("verifiedBtn").setAttribute("aria-pressed", "false"); state.date = resolveDate(maxPlayable()); }  // nothing verified yet -> don't strand on empty
  if (!state.date) { state.lang = ""; setLangPref(""); state.date = resolveDate(maxPlayable()); }  // bad pref -> reset
  wire();
  await load();
  maybeShowTutorial();
}
main().catch((e) => { $("codePanel").innerHTML = `<div class="filename">Failed to load: ${escapeHtml(String(e.message || e))}</div>`; });
