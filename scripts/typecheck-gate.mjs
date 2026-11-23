// Frontend typecheck baseline gate (SOP-上游同步升级.md §4).
//
// The repo carries a quantified backlog of pre-existing type errors
// (311 across 42 files at adoption time, 2026-11-18). Burning it down takes
// multiple batches, but syncs must not ADD to it in the meantime — that is
// exactly how the v0.4.0 sync shipped a dangling shortcut id that no build
// step ever saw.
//
//   node scripts/typecheck-gate.mjs           gate: fail if NEW errors appear
//   node scripts/typecheck-gate.mjs --update  re-baseline after a burn-down
//                                             batch lands (never to silence a
//                                             new error)
//
// Baseline: src-vite/typecheck-baseline.json, keyed by file :: code :: message
// (message text, not line numbers, so ordinary edits don't churn the keys).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evaluateTypecheckResult } from "./typecheck-gate-logic.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const viteRoot = join(here, "..", "src-vite");
const baselinePath = join(viteRoot, "typecheck-baseline.json");
const vueTscEntry = join(viteRoot, "node_modules", "vue-tsc", "bin", "vue-tsc.js");

const DIAG = /^([^(]+)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

function runVueTsc() {
  const res = spawnSync(process.execPath, [vueTscEntry, "--noEmit"], {
    cwd: viteRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${res.stdout || ""}\n${res.stderr || ""}`;
  const counts = new Map();
  for (const line of output.split(/\r?\n/)) {
    const m = DIAG.exec(line);
    if (!m) continue;
    // Key by file :: code :: normalized message. The message is cut before the
    // embedded type strings ("... on type 'Store<...>'", "... to type 'X'",
    // "... because the types ..."): those restate whole types and churn on
    // unrelated-but-correct type changes, which once made 23 healthy fixes
    // look like 23 new errors. Count tracking still catches additions.
    const message = m[5].trim().split(/\s+(?:on|to|from|in)\s+type\s+|\s+because\s+/)[0];
    const key = `${m[1]} :: ${m[4]} :: ${message.slice(0, 200)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return { status: res.status, signal: res.signal, error: res.error, counts };
}

function loadBaseline() {
  if (!existsSync(baselinePath)) {
    console.error("[typecheck-gate] no baseline file. Run with --update to create one.");
    process.exit(2);
  }
  return JSON.parse(readFileSync(baselinePath, "utf8"));
}

const update = process.argv.includes("--update");
const result = runVueTsc();
const { counts } = result;
const validation = evaluateTypecheckResult(result, { update });

if (!validation.ok && validation.reason) {
  console.error(`[typecheck-gate] FAIL — ${validation.reason}`);
  process.exit(2);
}

if (update) {
  writeFileSync(baselinePath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    ...validation.baselineUpdate,
  }, null, 2) + "\n");
  console.log(`[typecheck-gate] baseline updated: ${validation.total} errors, ${counts.size} keys`);
  process.exit(0);
}

const baseline = loadBaseline();
const comparison = evaluateTypecheckResult(result, { baselineEntries: baseline.entries || {} });
const { added, removed, total } = comparison;

if (added.length > 0) {
  console.error(`[typecheck-gate] FAIL — ${added.length} NEW type error(s) vs baseline (total now ${total}):`);
  for (const line of added.slice(0, 20)) console.error(`  + ${line}`);
  if (added.length > 20) console.error(`  ... and ${added.length - 20} more`);
  console.error("Fix the new errors, or (after a burn-down batch) re-baseline with --update.");
  process.exit(1);
}

console.log(`[typecheck-gate] OK — no new type errors (total ${total}, baseline ${baseline.total}${removed.length ? `, ${removed.length} key(s) fixed since baseline — re-baseline with --update` : ""})`);
