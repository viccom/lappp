// Orphan guard: every tests/*.test.mjs must be reachable from a package.json
// script. Invisible tests are how the v0.4.0 sync shipped with green gates
// while 26 test files never ran anywhere.
//
// The guard also refuses *.test.ts files: node cannot execute them on the
// CI's node 20, so a TypeScript test would silently never run. The two that
// existed (imageNavigator, montageLayout) were ported to .mjs and load their
// subject through tests/helpers/ts-module.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const testsDir = dirname(fileURLToPath(import.meta.url));
const viteRoot = dirname(testsDir);
const pkg = JSON.parse(await readFile(join(viteRoot, "package.json"), "utf8"));

const referenced = new Set();
for (const cmd of Object.values(pkg.scripts)) {
  for (const m of cmd.matchAll(/tests\/[\w.-]+\.mjs/g)) referenced.add(m[0].replace(/^tests\//, ""));
}

const entries = await readdir(testsDir);
const files = entries.filter((f) => f.endsWith(".test.mjs"));
const orphans = files.filter((f) => !referenced.has(f));
const typescriptTests = entries.filter((f) => f.endsWith(".test.ts"));

test("every test file is wired into a script (no silent orphans)", () => {
  assert.deepEqual(orphans, [], [
    "test files not referenced by any package.json script:",
    orphans.join(", "),
    "- add them to a test:* domain",
  ].join(" "));
});

test("no TypeScript test files: node 20 cannot run them, so they would never run", () => {
  assert.deepEqual(typescriptTests, [], [
    "TypeScript test files found (they would never execute on CI):",
    typescriptTests.join(", "),
    "- port them to .mjs and load the module through tests/helpers/ts-module.mjs",
  ].join(" "));
});

test("no quarantine test domain bypasses aggregate execution", () => {
  assert.equal(pkg.scripts["test:quarantine"], undefined);
});
