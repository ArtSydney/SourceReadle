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

## A note on the answer-key check

`validate.mjs` is structural. It cannot tell you the bug is *real* or that the
"correct" fix truly works — only a human (or a future compile/run harness) can.
That verification is the one job that stays manual, and it's why Hard puzzles get
reviewed and Easy/Medium mostly don't.
