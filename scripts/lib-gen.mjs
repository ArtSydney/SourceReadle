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

export function buildPrompt(diff, idNum, date, avoid = {}) {
  const g = GUIDE[diff];
  const av = [];
  if (avoid.classes?.length) av.push(`- Do NOT use these bug classes (already used elsewhere today): ${avoid.classes.join(", ")}.`);
  if (avoid.langs?.length) av.push(`- Do NOT use these languages (already used elsewhere today): ${avoid.langs.join(", ")}.`);
  if (avoid.recentClasses?.length) av.push(`- Prefer a class NOT in this recent set: ${avoid.recentClasses.join(", ")}.`);
  if (avoid.cves?.length) av.push(`- Do NOT base the puzzle on any of these already-used CVEs: ${avoid.cves.join(", ")}.`);
  const avoidBlock = av.length ? `\nVariety constraints:\n${av.join("\n")}\n` : "";
  return `You are drafting ONE SourceReadle puzzle. Output ONLY a single JSON object, no prose, no markdown fences.
${avoidBlock}

It MUST conform to this JSON Schema:
${schema}

Bug-class keys you may use for stages.bugClass (pick real ones): ${classKeys.join(", ")}

Requirements for THIS puzzle:
- "id": "srd-${String(idNum).padStart(4, "0")}"
- "date": "${date}"
- "difficulty": "${diff}"
- "language": one of ${g.lang}
- "estimatedMinutes": ~${g.mins}
- snippet: ${g.origin}. IMPORTANT: give each file's source as "code" = an ARRAY of line strings (one element per line, NO embedded newline characters, no trailing empty element). Include a sparse "notes" map (line-number string -> plain-English description) for the non-obvious lines; keep notes neutral so they don't reveal the bug.
- Exactly one real vulnerability. stages.line points at it (1-indexed, within the file).
- stages.bugClass: the correct key plus 3-7 distractors from the list; include at least one from the SAME family as the answer.
- stages.why: 3-4 explanations of the mechanism, exactly one correct; wrong ones get a "whyWrong". The correct option has NO whyWrong.
- stages.fix: 3-4 patch options, exactly one correct; wrong ones get "whyWrong". Each option's "diff" MUST be an ARRAY of unified-diff line strings (each element starts with ' ', '+', or '-'; no embedded newlines). Don't make the correct one the longest or most "secure-sounding".
- source: ${diff === "hard" ? 'origin "cve" with the real cve id, project, the NVD advisory URL (https://nvd.nist.gov/vuln/detail/<CVE>), an SPDX license, and attribution ending in ", simplified"' : 'origin "original", license "CC0-1.0", attribution "SourceReadle original"'}.
- training.exploit: a concrete "what the attacker sends and what happens" paragraph (explanatory, not a weaponized tool). training.hints: one short nudge per stage.
- writeup.summary: 3-6 sentences. writeup.readNext: 1-2 real reference links.
- Pick a vulnerability class you have not already been asked about recently; vary languages and classes.

Keep it tight so the JSON stays complete: the snippet file is at most 35 lines, at most ~12 notes, each fix "diff" at most ~8 lines, and each label/explanation one or two sentences.

Output STRICTLY valid JSON. Because code and diffs are arrays of line strings, no string in your output should contain a raw newline. Return only the JSON object.`;
}

function stripFences(t) { return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(); }

// Defuse secret-shaped strings an LLM might emit (e.g. in a hardcoded-secret
// puzzle) so they can't trip GitHub push protection. Replacements keep the
// recognizable prefix for teaching but break the scanner's pattern.
const SECRET_SUBS = [
  [/\b([sprk]k)_(live|test)_[A-Za-z0-9]{6,}/g, "$1_$2_EXAMPLE_not_a_real_key"],
  [/\bsk-ant-[A-Za-z0-9_\-]{10,}/g, "sk-ant-EXAMPLE-not-a-real-key"],
  [/\bsk-(?:proj-)?[A-Za-z0-9]{20,}/g, "sk-EXAMPLE-not-a-real-key"],
  [/\bAKIA[0-9A-Z]{6,}/g, "AKIA_EXAMPLE_NOT_REAL"],
  [/\bgh[pousr]_[A-Za-z0-9]{10,}/g, "ghp_EXAMPLE_not_a_real_token"],
  [/\bAIza[0-9A-Za-z_\-]{10,}/g, "AIza_EXAMPLE_not_real_key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "xoxb-EXAMPLE-not-real"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "-----BEGIN PRIVATE KEY----- EXAMPLE_not_a_real_key -----END PRIVATE KEY-----"],
];
function scrubStr(s) { let t = s; for (const [re, rep] of SECRET_SUBS) t = t.replace(re, rep); return t; }
function scrubDeep(x) {
  if (typeof x === "string") return scrubStr(x);
  if (Array.isArray(x)) return x.map(scrubDeep);
  if (x && typeof x === "object") { const o = {}; for (const k in x) o[k] = scrubDeep(x[k]); return o; }
  return x;
}

// Returns a puzzle object (id/date/difficulty are forced regardless of model output).
export async function draftOne({ diff, idNum, date, key, model, fake, catalog, avoid }) {
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
      body: JSON.stringify({ model, max_tokens: diff === "hard" ? 32000 : 12000, messages: [{ role: "user", content: buildPrompt(diff, idNum, date, avoid) }] }),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const raw = stripFences((data.content || []).map((b) => b.text || "").join(""));
    try { obj = JSON.parse(raw); }
    catch (e) { throw new Error(`${e.message} | stop=${data.stop_reason} len=${raw.length} tail=${JSON.stringify(raw.slice(-70))}`); }
  }
  // The model returns code/diffs as arrays of lines (far more reliable JSON);
  // join them into the newline strings the schema and player expect.
  for (const f of obj?.snippet?.files || []) if (Array.isArray(f.code)) f.code = f.code.join("\n");
  for (const o of obj?.stages?.fix?.options || []) if (Array.isArray(o.diff)) o.diff = o.diff.join("\n");
  obj = scrubDeep(obj);                              // defuse any secret-shaped strings
  obj.id = `srd-${String(idNum).padStart(4, "0")}`;
  obj.date = date;
  obj.difficulty = diff;
  return obj;
}
