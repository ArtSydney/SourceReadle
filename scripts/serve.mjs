#!/usr/bin/env node
// Local dev server. Rebuilds _site with an all-inclusive cutoff (so you can
// see future-dated puzzles while authoring) and serves it. Zero dependencies.
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { join, extname, dirname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "_site");
const port = process.env.PORT || 8731;

// Preview the curated days plus ~3 weeks of rotation: cutoff = last authored date + 21.
async function previewCutoff() {
  if (process.env.SRD_DATE) return process.env.SRD_DATE;
  const dates = (await readdir(join(root, "puzzles"))).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const last = dates[dates.length - 1] || new Date().toISOString().slice(0, 10);
  const d = new Date(last + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 21);
  return d.toISOString().slice(0, 10);
}
const cutoff = await previewCutoff();
spawnSync(process.execPath, [join(root, "scripts", "build-site.mjs")],
  { stdio: "inherit", env: { ...process.env, SRD_DATE: cutoff } });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const full = normalize(join(out, p));
    if (!full.startsWith(out + sep)) { res.writeHead(403).end("forbidden"); return; }
    const body = await readFile(full);
    res.writeHead(200, { "content-type": TYPES[extname(full)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`SourceReadle dev server → http://localhost:${port}`));
