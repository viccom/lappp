import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const backupScript = join(repoRoot, 'scripts', 'backup-library-db.py');

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'lappp-db-backup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function runPython(args) {
  return spawnSync('python', ['-I', ...args], { encoding: 'utf8' });
}

function createLibraryDb(path) {
  const code = [
    'import sqlite3,sys',
    'db=sqlite3.connect(sys.argv[1])',
    'db.executescript("PRAGMA user_version=31; CREATE TABLE afiles(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE albums(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE afolders(id INTEGER PRIMARY KEY,name TEXT);")',
    'db.executemany("INSERT INTO afiles(name) VALUES (?)",[("one",),("two",)])',
    'db.execute("INSERT INTO albums(name) VALUES (?)",("trip",))',
    'db.executemany("INSERT INTO afolders(name) VALUES (?)",[("a",),("b",),("c",)])',
    'db.commit();db.close()',
  ].join(';');
  const result = runPython(['-c', code, path]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

function runBackup(source, target) {
  return spawnSync('python', ['-I', backupScript, source, target], { encoding: 'utf8' });
}

test('backs up a library database with matching rows and valid integrity', (t) => {
  const dir = tempDir(t);
  const source = join(dir, 'source%# snapshot.sqlite');
  const target = join(dir, 'backup.sqlite');
  createLibraryDb(source);

  const result = runBackup(source, target);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  if (process.platform !== 'win32') {
    assert.equal(statSync(target).mode & 0o777, 0o600);
  }
  assert.match(result.stdout, /source user_version:\s*31/);
  assert.match(result.stdout, /destination user_version:\s*31/);
  assert.match(result.stdout, /source row counts:.*afiles=2.*albums=1.*afolders=3/);
  assert.match(result.stdout, /destination row counts:.*afiles=2.*albums=1.*afolders=3/);
  assert.match(result.stdout, /integrity_check: ok/);
  assert.match(result.stdout, /does not copy app-config, sidecars, thumbnail cache, or external db_storage_dir targets/i);

  const inspect = runPython(['-c', [
    'import json,sqlite3,sys',
    'db=sqlite3.connect(sys.argv[1])',
    'print(json.dumps({"integrity":db.execute("PRAGMA integrity_check").fetchone()[0],"version":db.execute("PRAGMA user_version").fetchone()[0],"files":db.execute("SELECT name FROM afiles ORDER BY id").fetchall(),"albums":db.execute("SELECT name FROM albums").fetchall(),"folders":db.execute("SELECT name FROM afolders ORDER BY id").fetchall()}))',
  ].join(';'), target]);
  assert.equal(inspect.status, 0, inspect.stdout + inspect.stderr);
  assert.deepEqual(JSON.parse(inspect.stdout), {
    integrity: 'ok',
    version: 31,
    files: [['one'], ['two']],
    albums: [['trip']],
    folders: [['a'], ['b'], ['c']],
  });
});

test('captures committed WAL data while the source connection remains open', (t) => {
  const dir = tempDir(t);
  const source = join(dir, 'wal-source.sqlite');
  const target = join(dir, 'wal-backup.sqlite');
  const code = [
    'import runpy,sqlite3,sys',
    'source=sqlite3.connect(sys.argv[2])',
    'source.execute("PRAGMA journal_mode=WAL")',
    'source.execute("PRAGMA wal_autocheckpoint=0")',
    'source.execute("CREATE TABLE sample(value TEXT)")',
    'source.execute("INSERT INTO sample VALUES (\'committed-in-wal\')")',
    'source.commit()',
    'runpy.run_path(sys.argv[1])["backup"](sys.argv[2],sys.argv[3])',
    'assert sqlite3.connect(sys.argv[3]).execute("SELECT value FROM sample").fetchone()[0]=="committed-in-wal"',
    'source.close()',
  ].join("\n");

  const result = runPython(['-c', code, backupScript, source, target]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /integrity_check: ok/);
});

test('reports common row counts as unavailable for a generic database', (t) => {
  const dir = tempDir(t);
  const source = join(dir, 'generic.sqlite');
  const target = join(dir, 'generic-backup.sqlite');
  const fixture = runPython(['-c', 'import sqlite3,sys;db=sqlite3.connect(sys.argv[1]);db.execute("CREATE TABLE sample(value TEXT)");db.commit();db.close()', source]);
  assert.equal(fixture.status, 0, fixture.stdout + fixture.stderr);

  const result = runBackup(source, target);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /source row counts:.*afiles=unavailable.*albums=unavailable.*afolders=unavailable/);
  assert.match(result.stdout, /destination row counts:.*afiles=unavailable.*albums=unavailable.*afolders=unavailable/);
});

test('refuses an existing target without modifying it', (t) => {
  const dir = tempDir(t);
  const source = join(dir, 'source.sqlite');
  const target = join(dir, 'existing.sqlite');
  createLibraryDb(source);
  const original = Buffer.from('do not overwrite this target');
  writeFileSync(target, original);

  const result = runBackup(source, target);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /target.*already exists/i);
  assert.deepEqual(readFileSync(target), original);
});

test('rejects a missing source without creating the target', (t) => {
  const dir = tempDir(t);
  const source = join(dir, 'missing.sqlite');
  const target = join(dir, 'backup.sqlite');

  const result = runBackup(source, target);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source/i);
  assert.equal(existsSync(target), false);
});

test('removes a created target after injected backup verification failure', (t) => {
  const dir = tempDir(t);
  const source = join(dir, 'source.sqlite');
  const target = join(dir, 'partial.sqlite');
  createLibraryDb(source);
  const code = [
    'import os,runpy,sqlite3,sys',
    'namespace=runpy.run_path(sys.argv[1])',
    'def fail_verification(connection):',
    '    assert os.path.exists(sys.argv[3]), "target was not created before verification"',
    '    raise sqlite3.DatabaseError("injected verification failure")',
    'namespace["backup"](sys.argv[2],sys.argv[3],verifier=fail_verification)',
  ].join('\n');

  const result = runPython(['-c', code, backupScript, source, target]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /injected verification failure/);
  assert.equal(existsSync(target), false, result.stdout + result.stderr);
});
