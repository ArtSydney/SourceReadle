# SourceReadle

A daily, Wordle-style puzzle for reading code the way an attacker does. Each day
has three puzzles — **Easy**, **Medium**, **Hard** — and each is a short snippet
with exactly one real vulnerability. You solve it in four stages:

1. **Find the line.** Tap where the bug lives. 🟩 exact · 🟨 within a few lines · ⬜ cold.
2. **Name the bug class.** 🟩 exact · 🟨 right family, wrong class.
3. **Why is it exploitable?** Pick the explanation of the actual mechanism — the training step.
4. **Pick the fix.** One patch truly closes the hole; the others look right but don't.

Then you get a spoiler-free share grid, a concrete "what the attack looks like"
example, and a write-up that points you at the real CVE, advisory, and upstream fix.

Two learning aids, available any time:

- **🔍 Explain** — tap any line to read a plain-English note on what it does (great for the C puzzles).
- **🎓 Learn** — unlimited guesses plus a per-stage hint, with no effect on your streak, for practising older days.

The player is mobile-first and works in iOS Safari and Chrome (and every desktop browser).

| Tier | Time | Source |
|------|------|--------|
| Easy | ~5 min | Hand-written single functions |
| Medium | ~15 min | Simplified real-world patterns |
| Hard | ~30 min | Pre-patch code from real CVEs (OSCP/OSWE level) |

## Play locally

No dependencies beyond Node 18+.

```bash
npm run serve        # builds and serves at http://localhost:8731
```

The dev server shows every authored puzzle regardless of date. In production the
daily GitHub Action only publishes puzzles dated on or before today.

Other commands:

```bash
npm run validate     # structural + answer-key checks on every puzzle
npm run build        # assemble _site/ for today's cutoff (SRD_DATE=YYYY-MM-DD to override)
npm run backlog      # how many future days of puzzles are queued
```

## How it ships

- `puzzles/<date>/<easy|medium|hard>.json` — one puzzle per file. The
  [schema](schema/puzzle.schema.json) is the contract the web player, the
  validator, and the future Swift app all read.
- `schema/taxonomy.json` — the bug-class list. "Right family" feedback in stage 2
  comes from the `family` of each class.
- `site/` — the static player (vanilla HTML/CSS/JS, no build step, no framework).
- `.github/workflows/daily.yml` — runs daily: validates, builds the site with
  today's cutoff, deploys to GitHub Pages, and opens an issue when the backlog is low.

### Always-fresh puzzles (auto-generation)

[.github/workflows/generate.yml](.github/workflows/generate.yml) runs daily and keeps
a rolling **buffer** of upcoming days drafted and committed, so every day gets a new
puzzle with no manual work:

1. [scripts/generate-backlog.mjs](scripts/generate-backlog.mjs) fills only the
   *missing* (date, difficulty) slots for the next `SRD_BUFFER` days (default 14),
   drafting each via the Anthropic API against the schema.
2. Every draft is **self-validated in-process** ([lib-validate.mjs](scripts/lib-validate.mjs));
   anything structurally invalid is discarded and retried, so only valid puzzles are committed.
3. New puzzles are committed to `main`; the daily publish serves each one when its date arrives.

**To turn it on:** add the repository secret `ANTHROPIC_API_KEY`
(Settings → Secrets and variables → Actions). Optional variables: `SRD_MODEL`
(default `claude-sonnet-5-5`), `SRD_BUFFER` (default 14).

Cost is ~3 API calls per day (one per difficulty), only for slots not already filled.

Test the pipeline locally without a key:

```bash
npm run generate:fake    # clones catalog entries to exercise the plumbing
```

### Rotation (the safety net)

If generation is ever unavailable — no API key, an API outage, or a day where fewer
than three valid puzzles were produced — the build falls back to **rotation**: it
recycles the existing catalog deterministically (`day number % catalog size`, shuffled)
so the daily feed never goes empty. Progress is keyed by date, so a recycled puzzle
plays fresh. Disable with `SRD_ROTATE=0`; `SRD_WINDOW` (default 365) bounds how many
trailing days are materialized.

So the layering is: **auto-generated fresh puzzles first, rotation only as a fallback,
and your hand-authored days always take priority on their dates.**

> **Correctness caveat.** The validator checks structure, not truth — it can't confirm
> an auto-generated bug is real or its "correct" fix actually works. Committed drafts
> go live when their date arrives. If you'd rather review first, switch the workflow's
> commit step to open a pull request instead of pushing to `main`.

### Enabling GitHub Pages

In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The `daily` workflow does the rest. The "Report this puzzle" link in
[site/app.js](site/app.js) points at `github.com/ArtSydney/SourceReadle`.

## Adding puzzles

See [CONTRIBUTING.md](CONTRIBUTING.md) for the low-effort generation pipeline:
draft from a CVE + its fix commit, then let `npm run validate` gate it.

## Content

14 days / 42 puzzles ship in `puzzles/` (2026-10-10 → 2026-10-23), spanning 19
bug classes across C, C#, Go, Java, JavaScript, PHP, Python and Ruby. Ten of the
Hard puzzles are drawn from real CVEs (Heartbleed, Shellshock, GHOST, Log4Shell,
Baron Samedit, Struts2, PHPMailer, nginx range, Text4Shell, php-cgi); the rest are
original snippets of real-world patterns.

## Roadmap

- [x] Puzzle schema + validator
- [x] Web player (4 stages, streaks, share grid, write-ups)
- [x] Training: "why is it exploitable?" stage, Explain-mode line notes, Learn mode
- [x] Mobile-first layout (iOS Safari / Chrome)
- [x] 14 days of content
- [x] Daily publish + backlog alerting
- [x] Auto-generation (daily buffer top-up, self-validated) + rotation fallback
- [ ] Add a compile/parse check per generated snippet (deeper correctness gate)
- [ ] SwiftUI app reading the same JSON feed

## Licensing

Code in this repo is MIT. Each puzzle carries its own `source.license` and
attribution. Hard puzzles quote small, transformed excerpts of real projects for
education under their respective licenses; the write-up links the upstream source.
