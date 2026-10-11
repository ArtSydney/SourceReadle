# Contributing puzzles

The goal is **low curator effort**: generate puzzles in batches, let automated
checks catch most mistakes, and only eyeball the ones that matter (Hard CVEs).

## The pipeline

1. **Pick a source.** For Hard, find a CVE with a public fix commit (the diff is
   your answer key). Good hunting grounds: GitHub Security Advisories, the
   project's `git log`, [NVD](https://nvd.nist.gov/). For Easy/Medium, pick a
   classic class from `schema/taxonomy.json` and write a small, realistic snippet.

2. **Draft the JSON.** Use the prompt below with any capable LLM. Output goes to
   `puzzles/<date>/<difficulty>.json`.

3. **Validate.** `npm run validate` enforces the schema, that the marked line
   exists and isn't blank, that the bug class is in the taxonomy, that exactly one
   fix is correct, and that licensing/attribution are present.

4. **Spot-check Hard puzzles.** For CVE-derived puzzles, confirm:
   - the snippet is pre-patch code (the bug is actually present);
   - the "correct" fix matches what upstream actually did;
   - the wrong-fix options are plausible but genuinely insufficient — this is
     where trust is won or lost;
   - no *second*, unintended bug is more obvious than the intended one.

5. **Commit.** The daily Action publishes each file on its `date`.

## Drafting prompt

> You are writing one SourceReadle puzzle as JSON conforming to
> `schema/puzzle.schema.json`. Input: a vulnerability (ideally a CVE with its fix
> commit URL and the pre-patch source).
>
> Produce:
> - `snippet.files`: the smallest faithful excerpt that still contains the bug.
>   For Hard, lightly simplify real pre-patch code but keep the vulnerable logic
>   verbatim. 1-indexed lines.
> - `stages.line`: the exact file + line of the vulnerability.
> - `stages.bugClass`: the correct class plus 3–7 distractors, all keys from
>   `schema/taxonomy.json`. Include at least one distractor from the *same family*
>   so the 🟨 feedback is meaningful.
> - `stages.why`: 3–4 explanations of the *mechanism*, exactly one correct. This
>   is the training stage — the wrong options should be plausible misreadings
>   (a lesser/adjacent bug, a performance red herring, a too-late check).
> - `stages.fix`: 3–4 patch options, exactly one correct (matching the upstream
>   fix for CVEs). Every incorrect option needs a `whyWrong` that names the
>   specific reason it fails (bypassable denylist, wrong layer, too late, treats a
>   symptom, introduces a new bug). Do not make the correct one obviously longest
>   or most "secure-sounding".
> - `training.exploit`: a concrete "what the attacker sends and what happens"
>   paragraph. `training.hints`: one short nudge per stage for Learn mode.
> - `snippet.files[].notes`: a sparse map of line number → plain-English note for
>   Explain mode. Annotate the non-obvious lines (essential for C/assembly-ish
>   snippets); keep notes neutral so they don't reveal which line is the bug.
> - `source`: origin, and for CVEs the cve id, project, fixCommit, advisory,
>   SPDX `license`, and attribution.
> - `writeup.summary`: 3–6 sentences — why it's exploitable, what the attacker
>   sends, and how the real fix closes it. Plus `readNext` links to the advisory
>   and fix commit.
>
> Keep it about reading code and understanding the fix. Do not include working
> exploit payloads beyond the minimum needed to explain the bug.

## Difficulty calibration

- **Easy** (~5 min, 10–25 lines): one obvious sink, single file, written by us.
- **Medium** (~15 min, 40–100 lines): a realistic function where the bug needs a
  moment's thought; the tempting-but-wrong fix should be believable.
- **Hard** (~30 min, up to ~250 lines): real pre-patch CVE code. The wrong fixes
  should be the kind of patch a competent dev might actually propose and that
  *looks* like it works.

## The verification contract (`verify` block)

`validate.mjs` is structural — it can't tell you the bug is *real* or that the
"correct" fix truly works. The optional **`verify`** block makes that claim
*executable*: a sandboxed runner builds the snippet, runs a proof-of-concept
against the original and against **every** fix option, and checks that reality
matches the answer key. This is the Phase 1 trust mechanism. A complete, runnable
example lives in
[`puzzles/examples/verify-command-injection.json`](puzzles/examples/verify-command-injection.json).

Run it with `npm run verify` (all puzzles with a `verify` block) or
`node scripts/verify.mjs <file.json>`. It uses Docker when the daemon is up
(`--runner docker`, per-puzzle `image`, `--network=none`, dropped capabilities,
memory/pids/cpu limits, in-container timeout) and falls back to an **unsandboxed**
local run for dev (`--runner local`). It writes `verify-report.json` and exits
non-zero on any mismatch. CI runs it in Docker on every change to `puzzles/` or
`schema/` (`.github/workflows/verify.yml`).

**The oracle is the PoC's exit code:** `exit 0` means the vulnerability was
successfully exploited; any non-zero exit (assertion, error, crash, timeout)
counts as *blocked*. Write the PoC so it asserts the malicious effect and exits
accordingly.

The block:

- `version` — always `1`.
- `image` — the container image the runner uses (`python:3.12-slim`, `gcc:13`, …).
- `build` — optional shell steps before running (compiling, etc.); omit for
  interpreted languages.
- `run` — the command that runs the PoC. Its exit code is the oracle.
- `timeoutSec` (≤60), `network` (default `false` — keep it off unless the PoC
  genuinely needs loopback).
- `harness` — extra files (a PoC driver, a `Makefile`) written next to the snippet
  to make it runnable. Not shown to the player.
- `original: { expect: "exploited" }` — the baseline (`snippet.files` + `harness`,
  no patch) must be exploitable.
- `fixes` — **index-aligned with `stages.fix.options`.** For each option the
  runner overlays its `files` onto the baseline snippet (matched by file name) and
  re-runs the PoC. Each carries `expect: "blocked" | "exploited"` and the full
  content of every file it changes. The contract (enforced by `validate.mjs`):
  **exactly the correct fix (`stages.fix.answerIndex`) is `"blocked"`; every other
  option is `"exploited"`.**

**Design the PoC and the wrong fixes together.** The *same* PoC runs against all
variants, so a wrong fix must stay exploitable by that one payload. In the example,
the payload uses `|` precisely so the "strip semicolons" wrong fix can't
accidentally block it — only the real fix (drop the shell) does. Prefer storing the
full patched file per variant over fuzzy diff application, so the result is
deterministic.

A `verify` block is optional per puzzle, but it's what turns "trust us" into
"run it yourself." Hard CVE puzzles are the priority to backfill (`T1.5`).

**Generation is gated on it.** `generate-backlog.mjs` discards any draft whose
`verify` block doesn't pass execution — a wrong "correct" fix (one that doesn't
actually block the PoC) or a wrong fix that accidentally blocks it is rejected and
never shipped, not merely structurally checked. Run generation with `SRD_VERIFY=1`
(and Docker available) to ask the model for verify blocks and enforce this;
regardless of the flag, *any* draft that already carries a verify block is always
execution-gated. Verify blocks are only requested for languages the runner can
execute (`python`, `javascript`, `ruby`, `php`, `go`, `c`, `cpp`).

**The "verified" stamp.** A puzzle that passes gets `"verified": true` written
into it — by the generation gate, or by `node scripts/verify.mjs <file> --stamp`
for hand-authored ones (stamp sets it on a pass, strips it on a fail, so it never
lies). The build surfaces it: served puzzles keep the `verified` flag (but the
`verify` block itself is stripped — it's author-time data), and `index.json` gets
`verifiedByDate`/`verifiedCount`. The player shows a green "✓ Verified" badge and a
"✓ Verified only" filter. So the trust claim is visible to players, end to end.

**When a puzzle can't be auto-verified (`verifyExempt`).** Most CVE "hard"
puzzles are faithful *excerpts* of large systems (OpenSSL's TLS handler, Log4j's
JNDI lookup, Struts' OGNL path). Exploiting them needs the real library, the
network, or a specific vulnerable build — not reproducible in a self-contained
offline harness — and some have more than one fix that technically blocks the
exploit, so the single-correct-fix contract doesn't fit. Those carry
`"verifyExempt": "<reason>"`: the key was reviewed against the upstream fix but is
not machine-proven. It's mutually exclusive with `verify`/`verified`. `validate.mjs`
prints a tally (verified / exempt / unmarked). A fragment-style snippet that *is*
self-contained can still be verified by having the harness carry a complete
runnable form (see `srd-0042`: the snippet is a body fragment, the harness compiles
a full `target.c`, and the oversized copy crashes — so a non-zero exit means
exploited).
