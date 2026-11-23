import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = [
  'docs/dev/SOP-上游同步升级.md',
  'docs/dev/SOP-上游同步升级-历史记录.md',
  'docs/dev/SYNC-template.md',
];
const errors = [];
let links = 0;

for (const relative of docs) {
  const path = join(root, relative);
  const text = readFileSync(path, 'utf8');
  const fences = text.split(/\r?\n/).filter((line) => line.trim().startsWith('```')).length;
  if (fences % 2 !== 0) errors.push(`${relative}: unpaired code fences (${fences})`);
  for (const [, target] of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (/^(?:https?:\/\/|mailto:|#)/.test(target)) continue;
    links++;
    const destination = target.split('#', 1)[0];
    if (!existsSync(resolve(dirname(path), destination))) {
      errors.push(`${relative}: missing link target ${target}`);
    }
  }
}

const sop = readFileSync(join(root, docs[0]), 'utf8');
for (const required of [
  "@('fetch', 'upstream')",
  'merge --no-commit --no-ff',
  'typecheck:gate',
  'backup-library-db.py',
  'LAP_SMOKE_DATA_DIR',
  'build-windows.ps1',
  'test:crossrefs',
]) {
  if (!sop.includes(required)) errors.push(`SOP: missing required procedure ${required}`);
}
if (/bash\s+docs\/dev\/…/.test(sop)) errors.push('SOP: placeholder shell command remains');
if (/naturalWidth[^\n]{0,80}>\s*1500/.test(sop)) errors.push('SOP: stale 1500px smoke threshold remains');

console.log(`markdown_files=${docs.length} local_links=${links} errors=${errors.length}`);
for (const error of errors) console.error(error);
process.exit(errors.length ? 1 : 0);
