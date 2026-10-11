# SourceReadle — Build Roadmap

This is the durable plan. It is designed to survive context resets: any new session
should read this file first, find **NOW / NEXT**, and continue. Update the
**Status** and the checkboxes as tasks complete, and commit this file with the work.

---

## Resume pointer

- **NOW:** _nothing in progress_
- **NEXT:** `T1.5` (Backfill verify blocks for existing CVE hard puzzles) — see Phase 1 ⭐.
- **Last updated:** 2026-10-10

When you finish a task: tick its box, move the pointer to the next task, add a one-line
note under "Changelog" at the bottom, and commit.

---

## Current state (what already exists)

- Static site: vanilla HTML/CSS/JS player in `site/`, built to `_site/` by `scripts/build-site.mjs`, deployed to GitHub Pages by `.github/workflows/daily.yml`.
- Puzzle model: `puzzles/<date>/<easy|medium|hard>.json`, schema in `schema/puzzle.schema.json`, taxonomy in `schema/taxonomy.json`.
- 4 stages: find line → name bug class → why exploitable → pick fix. Explain mode (line notes), Learn mode (hints, no streak). Streaks + share grid. Local-date clamp. Language filter. Mobile layout with wrapping.
- Content: 42 authored + auto-generated puzzles; rotation recycles the catalog so the feed never empties.
- Generation: `scripts/generate-backlog.mjs` + `scripts/lib-gen.mjs` (Anthropic API), self-validates via `scripts/lib-validate.mjs`, scrubs secret-shaped strings, avoids duplicate CVEs, caps per run. On-demand only (`.github/workflows/generate.yml`, `workflow_dispatch`).
- Live: https://artsydney.github.io/SourceReadle/ (repo `ArtSydney/SourceReadle`).

## Guiding principles

1. **Trust is sacred.** Security people abandon a product after one wrong answer key. Prefer provable correctness over volume.
2. **Teach the real skill** (trace taint, read diffs, run payloads) over trivia recognition.
3. **Keep the daily free + light** as the funnel; depth lives in opt-in modes.
4. **Ship small, verify in the real app, keep the static-first architecture** until a feature genuinely needs a backend (flagged per task).

## Hosting feasibility (static GitHub Pages, like Wordle)

The original Wordle was 100% static (word list in the client, stats in localStorage, no
accounts, no server) and still went viral. The same holds here. Three buckets:

- **Runs in the browser — 100% static, no server:** the whole player; Phase 0; Phase 2
  (source→sink is just client logic + puzzle data); **Phase 3 the exploit sandbox** —
  WASM (Pyodide/QuickJS/wasm) executes *in the visitor's browser*, so "run the payload"
  needs no backend at all. This is the key insight: our two flashiest features don't need a server.
- **Runs at build time in CI — still no live server:** **Phase 1 execution-verification**
  runs in **GitHub Actions** (free for public repos), bakes a `verified` flag into the
  static JSON; generation already works this way. Diff-review sourcing (Phase 5) is also a
  build-time pipeline.
- **Genuinely needs a backend (NOT static):** cross-device sync (`T4.1`), leaderboards
  (`T6.1`), async duels (`T6.2`), teams/SSO (`T6.3`). These require shared, persistent,
  server-validated state. That's also the monetizable layer — so add a lightweight backend
  (e.g. Cloudflare Workers + D1/KV) *when* you reach Phase 4/6, keeping this static site as
  the frontend. Everything before Phase 4 ships on Pages as-is.

**Pages limits to watch:** ~1 GB site size, ~100 GB/month soft bandwidth, 10 builds/hr.
Pyodide adds ~6–12 MB (cached after first load) — fine. If the game goes viral and
bandwidth is a problem, move the *same* static bundle to Cloudflare Pages or Netlify (free,
bigger limits) with zero code changes. Verdict: **build Phases 0–3 (and 5) entirely on
GitHub Pages; only Phases 4 & 6 require introducing a backend.**

## Decisions needed (resolve before the phases that depend on them)

- **D1 — Backend/accounts?** Progression, leaderboards, and teams need identity + server state. Options: stay static + localStorage (no cross-device), or add a lightweight backend (e.g. Cloudflare Workers + D1/KV, or Supabase). Needed for Phase 4+.
- **D2 — Execution runtime for verification/sandbox?** Server-side containers (CI) vs in-browser WASM (Pyodide for Python, QuickJS for JS, Wasmer/wasm for C). Needed for Phase 1 and Phase 3. Likely: CI containers for verification (Phase 1), WASM for the in-browser exploit sandbox (Phase 3).
- **D3 — Monetization shape?** Free daily / Pro / Teams. Affects Phase 6 and any auth work.

---

## Phase 0 — Quick wins (low risk, high value, no backend)

Small, self-contained, each ~one session. Do these first to build momentum and fix the leakiest parts of the funnel.

- [x] **T0.1 — First-run tutorial.** ✅ Done. 5-step overlay (welcome + the 4 stages) shown on first load, gated on `localStorage` `sourcereadle:tutorial:v1`; "?" button in the header replays it; Back/Next/Skip/Esc; mobile-tested. Files: `site/index.html`, `site/style.css`, `site/app.js` (wireTutorial/openTutorial/maybeShowTutorial).
- [x] **T0.2 — Intro tier (below Easy).** ✅ Done. Separate guided 5-lesson set (`puzzles/intro/intro-1..5.json`, `difficulty:"intro"`, `scaffold:true`). "Intro" tab enters a lesson-navigator mode (date nav → "Lesson N/5", language selector hidden). Scaffolding: the vulnerable line is pre-highlighted (pulsing), unlimited taps, only 2 options per choice stage (answer + one distractor, index-preserving), hints shown open. Does **not** affect the daily streak; progress keyed `intro/<index>`. Schema adds `difficulty:"intro"` + `scaffold`; `lib-validate` relaxes option minimums for scaffold puzzles; `build-site` copies `puzzles/intro/` → `_site/intro/` and lists them in `index.json.intro`; validator handles the non-dated `intro/` folder. Tested full solve + navigation + Intro↔daily toggle on desktop & mobile.
- [x] **T0.3 — Better feedback loop.** ✅ Report 👎 now opens a structured modal (which stage felt wrong, free-text details) that builds a prefilled, `player-report`-labeled GitHub issue with puzzle context + result glyphs auto-attached. Static-friendly (no backend); swap to a serverless endpoint later if D1 resolves.
  - Steps: replace the raw GitHub-issue link with a small form (prefilled issue body, or a serverless endpoint if D1 resolved); label issues `player-report`.
  - Accept: a report tells us the puzzle id, the stage, and the complaint without the player writing boilerplate.
- [x] **T0.4 — Meaningful share grid.** ✅ Share text is now a solid 4-row square grid: row 1 is the line-search journey (one cell per tap, in order), rows 2–4 are the Class/Why/Fix verdicts centered in ⬛ bands so the block stays a rectangle. Header carries a `score/4` hook (🎯 on a clean sweep) + learn tag. On-screen legend maps the rows; ⬛ padding is distinct from a ⬜ cold miss. Mobile font shrinks so a 5-wide block fits with no overflow.
  - Steps: design the glyph language; implement in `shareText()`; keep it spoiler-free.
  - Accept: two different solves produce visibly different, interesting grids; posting one makes a non-player curious.
- [x] **T0.5 — Accessibility & polish pass.** ✅ Code lines are keyboard-operable (role=button, tabindex, Enter/Space) with aria-labels; a polite live region announces every stage result for screen readers; difficulty tabs use roving tabindex + arrow/Home/End nav; global `:focus-visible` ring; broad reduced-motion guard. Colour-blind safety via words, not colour: line feedback shows `exact / near / cold` text markers, and the breakdown has a text scorecard (`Find: Solved in N taps`, `Class: Right family…`, etc.) beside the colour grid. Also an emoji cleanup pass (per user feedback) — removed decorative emoji from chrome (buttons, hints, headers, legends, report); kept only functional glyphs (the Wordle feedback/share squares, the streak flame, the ✕ close).
  - Accept: fully keyboard-playable; passes a contrast checker; feedback distinguishable without color.

## Phase 1 — Trust: execution-verified answer keys  ⭐ highest leverage

Turn the biggest risk (wrong answer keys) into the biggest selling point. Needs **D2**.

- [x] **T1.1 — Define the verification contract.** ✅ Added an optional `verify` block to the schema: `image`/`build`/`run`, a `harness` (runnable PoC driver), and a `fixes` array index-aligned to `stages.fix.options` with the full patched files per option. Oracle = PoC exit code (0 = exploited). `validate.mjs` enforces the core contract (fixes aligned; exactly the correct fix expects `blocked`); documented in CONTRIBUTING; example in `puzzles/examples/verify-command-injection.json` (a non-served reference folder).
  - Accept: ✅ the example carries a complete, runnable `verify` block — proven by actually executing it (original=exploited, correct fix=blocked, both wrong fixes=still exploited), and the validator catches a deliberately mismatched key.
- [x] **T1.2 — Per-language runner.** ✅ `scripts/verify.mjs` materializes each variant (snippet + harness, with per-fix overlays) and builds+runs the PoC, with two backends: **Docker** (hardened — per-puzzle `image`, `--network=none`, `--cap-drop=ALL`, `no-new-privileges`, memory/pids/cpu limits, in-container `timeout`) and an unsandboxed **local** fallback for dev; auto-selects Docker when its daemon is up. Writes `verify-report.json`; exits non-zero on any mismatch. Language-agnostic via the exit-code oracle (works for Python + C today). CI workflow `.github/workflows/verify.yml` runs it in Docker on every change to `puzzles/`/`schema/`. `npm run verify`.
  - Accept: ✅ on the T1.1 example it proves original=vuln, correct fix=blocked, each wrong fix=still vuln (exit 0); a sabotaged "correct" fix is caught by execution → non-zero exit.
- [x] **T1.3 — Gate generation on verification.** ✅ Refactored the engine into `lib-verify.mjs` (reusable; `verify.mjs` is now a thin CLI). `generate-backlog.mjs` runs execution verification on any draft that carries a `verify` block and **discards** it if the answer key doesn't hold up — a mislabeled "correct" fix is rejected, not shipped. `SRD_VERIFY=1` asks the model for verify blocks (runnable languages only, via `VERIFY_IMAGES`) and enforces the gate; added as a `generate.yml` input. Documented in CONTRIBUTING.
  - Accept: ✅ demonstrated — a draft whose "correct" fix still uses the shell is auto-discarded (`fix#0/correct: expected blocked, got exploited`), while a sound draft is kept.
- [x] **T1.4 — "Verified by execution" badge.** ✅ Added a `verified` flag to the schema, stamped by the generation gate and by `verify.mjs --stamp`. `build-site` surfaces it in `index.json` (`verifiedByDate`, `verifiedCount`) and keeps the per-puzzle flag on served files (stripping the heavy `verify` block, which is author-time only). Player shows a green "✓ Verified" badge in the meta and a persisted "✓ Verified only" filter (graceful empty state, hidden in Intro). Proved the whole chain by adding a real, passing verify block to `srd-0004` (today-ish easy) so the badge/filter light up with genuine content. Assets → `?v=11`.
  - Accept: ✅ verified puzzles show the badge; the filter narrows to verified-only (and empties cleanly where nothing is verified yet).
- [ ] **T1.5 — Backfill.** Add `verify` blocks + run verification for the existing CVE hard puzzles (Heartbleed, Shellshock, GHOST, Log4Shell, Baron Samedit, Struts2, PHPMailer, nginx, Text4Shell, php-cgi).
  - Accept: each either passes verification or is flagged for manual correction.

## Phase 2 — Core mechanic: source → sink + compounding feedback

Fix the weak "tap one line" stage. Make it teach data flow and make guesses deductive.

- [ ] **T2.1 — Schema: source & sink.** Add `stages.flow` with `source` (where input enters) and `sink` (where damage happens) line locations; keep `line` for backward compat during migration.
  - Accept: schema + validator updated; one example puzzle annotated with source+sink.
- [ ] **T2.2 — Interaction redesign.** Player stage 1 becomes "tap the source, then the sink." Compounding feedback: correct source locks in; sink feedback is directional (upstream/downstream, warmer/colder).
  - Accept: playable on the example; feedback helps you reason, not just guess.
- [ ] **T2.3 — Migrate content.** Add flow annotations to authored puzzles (script-assisted); update the generator prompt to emit source+sink.
  - Accept: all live puzzles have flow data; generator produces it and it validates.
- [ ] **T2.4 — Rework the share grid for flow.** Encode how efficiently the player traced source→sink.

## Phase 3 — Exploit sandbox (the "wow")

After identifying the bug, let the player write a payload and watch it fire, in-browser. Needs **D2** (WASM).

- [ ] **T3.1 — Runtime spike.** Prototype Pyodide (Python) running a vulnerable snippet + attacker input in-browser, sandboxed, with a verdict.
  - Accept: one Python puzzle where typing a payload triggers the bug and the UI confirms "exploited".
- [ ] **T3.2 — Sandbox UI.** Payload editor, run button, clear success/fail verdict, reset. Opt-in, after the fix stage.
- [ ] **T3.3 — Exploit harness data.** Per-puzzle: the runnable vulnerable program + a checker that detects successful exploitation.
- [ ] **T3.4 — Extend runtimes.** Add JS (QuickJS/web worker) and C (wasm) where feasible; gate puzzles that support the sandbox.

## Phase 4 — Progression & personalization  (needs D1)

- [ ] **T4.1 — Identity & sync.** Resolve D1; add accounts/sync (or anonymous device sync) so progress/rating persist cross-device.
- [ ] **T4.2 — Per-CWE skill rating.** Elo-style rating per bug family from solve outcomes.
- [ ] **T4.3 — Weakness Trainer mode.** Serve puzzles from the player's weakest classes.
- [ ] **T4.4 — Spaced repetition.** Resurface previously-missed classes on an interval.
- [ ] **T4.5 — Mastery tracks & seasons.** Per-class progress, badges, seasonal resets.

## Phase 5 — Real codebases / diff-review mode

- [ ] **T5.1 — Diff-review puzzle type.** "Ship it or block it?" — show a PR diff, player decides safe/unsafe and marks the risky hunk.
- [ ] **T5.2 — Sourcing pipeline.** Mine real vuln-introducing commits + their fixes (GHSA/CVE → commit) into diff-review puzzles, with verification (Phase 1 reused).
- [ ] **T5.3 — Larger-file mode.** Find the bug in a realistic multi-hundred-line file, with search/scroll, closer to real review.

## Phase 6 — Social & Teams (business)  (needs D1, D3)

- [ ] **T6.1 — Leaderboards.** Daily speed/clean-sweep boards with anti-cheat (server-validated times).
- [ ] **T6.2 — Async duels.** Challenge a friend on the same puzzle; compare paths.
- [ ] **T6.3 — Teams.** Org accounts, per-CWE literacy dashboard, SSO.
- [ ] **T6.4 — Custom content for teams.** Generate puzzles from a team's own codebase and CVE history (reuses generation + verification).
- [ ] **T6.5 — Monetization.** Free daily → Pro (archive, sandbox, practice-by-class, verified-only) → Teams.

---

## Sequencing rationale

Do **Phase 0** now (cheap, fixes the funnel). Then **Phase 1** (trust) because it de-risks everything downstream and makes auto-generation safe. Then **Phase 2** (core mechanic) for game feel, and **Phase 3** (sandbox) for word-of-mouth. Phases 4–6 are the platform/business and depend on the backend decision (D1).

## Changelog

- 2026-10-10 — Roadmap created.
- 2026-10-10 — T0.1 first-run tutorial shipped (5-step overlay + "?" replay).
- 2026-10-10 — T0.2 Intro tier shipped (5 guided scaffolded lessons + Intro tab).
- 2026-10-10 — T0.3 structured feedback shipped (👎 report modal → prefilled, labeled GitHub issue; assets bumped to ?v=7).
- 2026-10-10 — T0.4 meaningful share grid shipped (Wordle-style journey grid + score/4; assets bumped to ?v=8).
- 2026-10-10 — T0.5 accessibility & polish shipped (keyboard/ARIA/live region, roving tabs, focus ring, reduced-motion, colour-blind text cues) + emoji cleanup. Phase 0 complete. Assets bumped to ?v=9.
- 2026-10-10 — UX fix: choice stages now reveal a clear verdict (right answer highlighted + plain-language banner) and wait for Continue instead of auto-advancing, so correct/wrong is obvious during play. Assets bumped to ?v=10.
- 2026-10-10 — T1.1 verification contract defined: `verify` schema block + validator enforcement + CONTRIBUTING docs + a runnable example proven by execution. (No player/site change; examples/ folder is not served.)
- 2026-10-10 — T1.2 execution runner shipped: `scripts/verify.mjs` (Docker + local backends, resource/time/network limits, JSON report, non-zero on mismatch) + `verify.yml` CI + `npm run verify`.
- 2026-10-12 — T1.3 generation gated on verification: engine extracted to `lib-verify.mjs`; `generate-backlog.mjs` discards drafts whose `verify` answer key fails execution; `SRD_VERIFY` opt-in requests verify blocks for runnable languages.
- 2026-10-12 — T1.4 "Verified by execution" surfaced: `verified` schema flag + `verify.mjs --stamp`; `index.json` verifiedByDate/verifiedCount; player badge + "Verified only" filter; srd-0004 given a real passing verify block. Assets → ?v=11.
