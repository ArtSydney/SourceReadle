# SourceReadle — Roadmap (v2: real code, real answers)

The durable plan. It's designed to survive context resets: any new session should
read this file first, find **NOW / NEXT**, and continue. Update the checkboxes and
the resume pointer as tasks complete, and commit this file with the work.

> The earlier plan (the trust/verification phases — contract, Docker runner,
> generation gate, badge) is archived in [`ROADMAP-v1-trust.md`](ROADMAP-v1-trust.md).
> That machinery is **done and dormant, not deleted** — we can revisit it someday.
> This v2 plan supersedes it.

---

## Resume pointer

- **NOW:** _nothing in progress_
- **NEXT:** `A1` — prove one puzzle from a real CVE fix commit, end to end.
- **Last updated:** 2026-10-12

When you finish a task: tick its box, move the pointer to the next task, add a
one-line note under "Changelog" at the bottom, and commit.

---

## North star

A Wordle-like **daily game to get better at reading real source code**, by finding
real vulnerabilities in it. Bite-sized (5–30 min), easy/medium/hard, multiple
languages. Static site on GitHub Pages. **Minimal upkeep** — content should flow
automatically.

## The pivot (why v2 exists)

v1 drifted into heavy *trust* infrastructure: an LLM invented whole puzzles, so we
built a Docker sandbox to catch its wrong answer keys. The simpler truth:

- **Use real code with real answers.** Source puzzles from **real vulnerability fix
  commits**. The vulnerable code, the vulnerable line, and the correct fix are all
  *ground truth* — straight from what the project actually shipped.
- **The LLM only decorates.** It writes the *wrong* fix options, the "why", and the
  hints — never the core answer. So its worst failure is a weak distractor, not a
  wrong lesson.
- **This retires verification.** If the answer is the real upstream fix, there's
  nothing to prove by execution. Phase 1's machinery becomes unnecessary (kept
  dormant per the archive note).
- **Automation becomes safe.** Automatic generation's failure mode drops from
  "teaches the wrong fix" to "occasionally a dull puzzle" — an acceptable price.

## Decisions (v2)

- **D-A — Content is real.** Puzzles are built from real vuln→fix commits, not
  invented. Real code verbatim (lightly trimmed for size is OK; the vulnerable logic
  stays faithful). _[revisit if real snippets prove unusable as-is → A1 decides]_
- **D-B — Stay vuln-focused.** Keep the loop: find the line → name the bug class →
  why it's exploitable → pick the real fix. Security is the skill lens.
- **D-C — Automatic sourcing.** Pull candidates from a public feed/dataset; no
  hand-curation required to keep the daily fresh. _[source TBD in A3]_
- **D-D — LLM is decoration only.** It never authors the vulnerable code, the
  answer line, or the correct fix.
- **D-E — Mothball v1 verification.** Don't run `SRD_VERIFY`, don't expand the
  verify engine. Leave the code in place.
- **D-F — Experience focus after content: fun & stickiness.**

---

## Current state (what already exists and still applies)

- Full player: find-line → class → why → fix, with per-stage verdicts + Continue,
  Explain mode (tap a line → what it does), Learn mode, streak, share grid,
  structured report. Mobile-first, accessible. Static on GitHub Pages.
- Intro tier (5 guided scaffolded lessons).
- Puzzle schema + taxonomy (bug classes → families). Schema already carries
  `source` (cve/project/fixCommit/advisory/license/attribution) — built for real
  provenance.
- ~42 authored daily puzzles + rotation fallback. Some are real CVEs but **LLM-
  simplified**; the easy/medium ones are LLM-invented. v2 shifts new content to
  real code.
- Dormant from v1: `verify` block, `scripts/verify.mjs` + `lib-verify.mjs`, the
  generation gate, `verifyExempt` flags on CVE hard puzzles. Left as-is.

---

## Phase A — Real content pipeline  ⭐ the foundation

Replace "invent a puzzle" with "assemble a puzzle from a real fix commit."

- [ ] **A1 — Prove one real-code puzzle.** Take one real, well-known vuln fix
  commit (ideally small, a language we support), fetch the actual pre-patch file and
  the patch, and assemble a complete puzzle JSON by hand: real snippet, real answer
  line, CWE→class, real fix as the correct option; draft the wrong options + why.
  - Accept: one puzzle built from real code+commit, playable, that reads well.
    Decide D-A: is real code game-ready as-is, or does it need shaping rules?
- [ ] **A2 — Write the assembly recipe.** Document how a `(repo, commit, file)`
  becomes a puzzle: what's taken verbatim, how the snippet window is chosen, how the
  answer line maps from the diff, how CWE maps to a taxonomy class, and exactly what
  the LLM is asked for (wrong options / why / hints only). Put it in CONTRIBUTING.
- [ ] **A3 — Pick & wire an automatic source.** Evaluate options (OSV / GitHub
  Advisory Database / a CVE-fix dataset). Fetch a batch of candidate vuln→fix pairs
  with real code + patch. No hand-picking.
  - Accept: a script that outputs N real candidates (commit, file, diff, CWE, lang).
- [ ] **A4 — Filter for game-ready candidates.** Keep only bite-sized, single-file,
  supported-language, clean examples (size caps, one logical change, readable).
  - Accept: the filter turns a raw batch into a short list that pass A2's shape.
- [ ] **A5 — Build the assembler.** Turn a filtered candidate into puzzle JSON:
  real parts from the data, LLM decoration for the rest (low-stakes prompt), then
  structural validation. Secret-scrub still applies.
  - Accept: run it on A3/A4 output → valid puzzles whose answers are the real fixes.
- [ ] **A6 — Swap the daily pipeline over.** Point the generate action at the new
  assembler; stop inventing puzzles. Keep rotation as the gap fallback. Turn
  `SRD_VERIFY` off for good (D-E).
  - Accept: a daily run produces real-sourced puzzles end to end.
- [ ] **A7 — Licensing & attribution.** Ensure every real excerpt ships its SPDX
  license + a link to the source commit/advisory, and excerpts stay short.
  - Accept: validator enforces license+attribution on real-sourced puzzles.

## Phase B — Fun & stickiness  (chosen next experience focus)

Make people want to come back. Build on real content, keep it light.

- [ ] **B1 — Make the daily feel like an event.** A clear "today's puzzle," a
  satisfying solve moment, a reason to return tomorrow (streak that feels good,
  not punishing).
- [ ] **B2 — Sharpen the share.** The grid exists; make what's shared enticing to
  non-players and easy to post.
- [ ] **B3 — Practice / endless mode.** Let people play past puzzles freely without
  touching the daily streak (partly exists via date nav — formalize it).
- [ ] **B4 — Small delight pass.** Micro-animations, sounds off by default, a
  streak milestone moment — whatever makes a solve feel good. Keep it tasteful.

## Phase C — Learning payoff  (secondary; serves the north star)

- [ ] **C1 — Explain mode on real code.** The "tap a line to see what it does"
  feature is the heart of *reading* — make its notes richer on real snippets.
- [ ] **C2 — Post-solve: learn from the real fix.** Show the real commit/advisory
  prominently; "here's what the maintainers actually changed, and why."

---

## Changelog

- 2026-10-12 — v2 roadmap created after a replan: pivot to real code / real answers
  / automatic sourcing, vuln-focused; pulled the "Verified" badge; mothballed the v1
  trust/verification work (archived in ROADMAP-v1-trust.md).
