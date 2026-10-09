// Shared puzzle-generation helpers. Real path calls the Anthropic Messages API;
// fake path (SRD_FAKE=1 / no key in tests) clones a catalog puzzle so the
// backlog plumbing can be exercised without network access.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = readFileSync(join(root, "schema", "puzzle.schema.json"), "utf8");
const taxonomy = JSON.parse(readFileSync(join(root, "schema", "taxonomy.json"), "utf8"));
const classKeys = Object.keys(taxonomy.classes);

const GUIDE = {
  easy: { lang: "python, javascript, php, ruby or go", mins: 5, origin: "an original single-function snippet (10-25 lines)" },
  medium: { lang: "csharp, java, go or python", mins: 15, origin: "an original realistic snippet (40-100 lines)" },
  hard: { lang: "c, cpp or java", mins: 30, origin: "code simplified from a real, well-known CVE you are confident about" },
};

export function buildPrompt(diff, idNum, date) {
  const g = GUIDE[diff];
  return `You are drafting ONE SourceReadle puzzle. Output ONLY a single JSON object, no prose, no markdown fences.

It MUST conform to this JSON Schema:
${schema}

Bug-class keys you may use for stages.bugClass (pick real ones): ${classKeys.join(", ")}

Requirements for THIS puzzle:
- "id": "srd-${String(idNum).padStart(4, "0")}"
- "date": "${date}"
- "difficulty": "${diff}"
- "language": one of ${g.lang}
- "estimatedMinutes": ~${g.mins}
- snippet: ${g.origin}. Include a sparse "notes" map (line number -> plain-English description) for the non-obvious lines; keep notes neutral so they don't reveal the bug.
- Exactly one real vulnerability. stages.line points at it (1-indexed, within the file).
- stages.bugClass: the correct key plus 3-7 distractors from the list; include at least one from the SAME family as the answer.
- stages.why: 3-4 explanations of the mechanism, exactly one correct; wrong ones get a "whyWrong". The correct option has NO whyWrong.
- stages.fix: 3-4 patch options with unified-diff "diff" strings, exactly one correct; wrong ones get "whyWrong". Don't make the correct one the longest or most "secure-sounding".
- source: ${diff === "hard" ? 'origin "cve" with the real cve id, project, the NVD advisory URL (https://nvd.nist.gov/vuln/detail/<CVE>), an SPDX license, and attribution ending in ", simplified"' : 'origin "original", license "CC0-1.0", attribution "SourceReadle original"'}.
- training.exploit: a concrete "what the attacker sends and what happens" paragraph (explanatory, not a weaponized tool). training.hints: one short nudge per stage.
- writeup.summary: 3-6 sentences. writeup.readNext: 1-2 real reference links.
- Pick a vulnerability class you have not already been asked about recently; vary languages and classes.

Return only the JSON object.`;
}

function stripFences(t) { return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(); }

// Returns a puzzle object (id/date/difficulty are forced regardless of model output).
export async function draftOne({ diff, idNum, date, key, model, fake, catalog }) {
  let obj;
  if (fake) {
    // Clone a same-difficulty catalog entry; valid by construction. Testing only.
    const pool = (catalog && catalog[diff]) || [];
    if (!pool.length) throw new Error("fake mode needs a non-empty catalog");
    obj = JSON.parse(JSON.stringify(pool[idNum % pool.length]));
  } else {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: "user", content: buildPrompt(diff, idNum, date) }] }),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    obj = JSON.parse(stripFences((data.content || []).map((b) => b.text || "").join("")));
  }
  obj.id = `srd-${String(idNum).padStart(4, "0")}`;
  obj.date = date;
  obj.difficulty = diff;
  return obj;
}
