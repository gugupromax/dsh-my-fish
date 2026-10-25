import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WorkspaceMigration } from '../lib/workspace-migration.js';

function fixture(t, { fresh = false, ...options } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'my-fish-workspace-test-'));
  const home = path.join(root, 'host'), source = path.join(home, 'my-fish'), target = path.join(root, 'chosen-workspace');
  fs.mkdirSync(home);
  if (!fresh) {
    fs.mkdirSync(path.join(source, 'assistant'), { recursive: true });
    fs.mkdirSync(path.join(source, 'workspace', 'empty-folder'), { recursive: true });
    fs.writeFileSync(path.join(source, 'credentials.json'), Buffer.from([0, 12, 200, 255, 13, 0, 41]));
    fs.writeFileSync(path.join(source, 'state.json'), '{"sessionId":"synthetic-main"}');
    fs.writeFileSync(path.join(source, 'assistant', 'memories.json'), '[{"text":"合成记忆"}]');
    fs.writeFileSync(path.join(source, 'workspace', 'example.txt'), 'synthetic personal workspace');
  }
  const store = { root: source, home, credentials: () => { throw Error('credentials must never be decrypted'); } };
  const cwdCalls = [], migration = new WorkspaceMigration({ store, getHome: () => home, updateWorkingDirectory: async (cwd, context) => cwdCalls.push({ cwd, context }), ...options });
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('my-fish-workspace-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, home, source, target, store, migration, cwdCalls };
}
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const locationFile = f => path.join(f.home, 'my-fish-location.json');
const journalFile = f => path.join(f.home, 'my-fish-migration.json');
function pending(f, { phase = 'published', committed = false } = {}) {
  const id = crypto.randomUUID(), staging = fs.mkdtempSync(path.join(f.root, '.my-fish-migration-' + id + '-'));
  fs.writeFileSync(path.join(staging, 'owner.json'), JSON.stringify({ version: 1, id, source: f.source, target: f.target }));
  if (phase === 'published') fs.cpSync(f.source, f.target, { recursive: true });
  else fs.mkdirSync(path.join(staging, 'payload'));
  const journal = { version: 1, id, source: f.source, target: f.target, staging, previousLocation: null, phase, createdAt: 1 };
  fs.writeFileSync(journalFile(f), JSON.stringify(journal));
  if (committed) fs.writeFileSync(locationFile(f), JSON.stringify({ version: 1, path: f.target, previousPath: f.source, lastMigration: { id, previousPath: f.source } }));
  return journal;
}
function heldLock(f) {
  const lock = path.join(f.source, '.operation.lock'), token = crypto.randomUUID(), fd = fs.openSync(lock, 'wx', 0o600);
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
  return { lease: { path: lock, fd, pid: process.pid, token }, close: () => { fs.closeSync(fd); if (fs.existsSync(lock)) fs.unlinkSync(lock); } };
}
function serializableLock(file, pid, token) {
  const stat = fs.lstatSync(file, { bigint: true });
  return { path: file, pid, token, identity: [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].map(String).join(':') };
}

test('migrate copies complete data and workspace with byte-identical encrypted files, retains source, then commits locator', async t => {
  const f = fixture(t), before = fs.readFileSync(path.join(f.source, 'credentials.json'));
  const result = await f.migration.migrate({ path: f.target });
  assert.equal(result.ok, true);
  assert.equal(f.store.root, f.target);
  assert.equal(result.files, 4);
  assert.deepEqual(fs.readFileSync(path.join(f.target, 'credentials.json')), before);
  assert.deepEqual(fs.readFileSync(path.join(f.source, 'credentials.json')), before);
  assert.equal(fs.readFileSync(path.join(f.target, 'workspace', 'example.txt'), 'utf8'), 'synthetic personal workspace');
  assert.ok(fs.statSync(path.join(f.target, 'workspace', 'empty-folder')).isDirectory());
  const locator = read(locationFile(f));
  assert.equal(locator.path, f.target);
  assert.equal(locator.previousPath, f.source);
  assert.equal(locator.lastMigration.previousPath, f.source);
  assert.equal(locator.lastMigration.verified, 'sha256-and-path-set');
  assert.equal(f.cwdCalls[0].context.rollback, false);
  assert.equal(f.cwdCalls[0].cwd, path.join(f.target, 'workspace'));
  assert.equal(fs.existsSync(journalFile(f)), false);
  assert.ok(!fs.readdirSync(f.root).some(name => name.startsWith('.my-fish-migration-')));
});

test('fresh install initializes the selected data root and workspace without creating a phantom old source', async t => {
  const f = fixture(t, { fresh: true, getWorkingDirectory: async () => null });
  const result = await f.migration.migrate({ path: f.target });
  assert.equal(result.files, 0);
  assert.equal(result.bytes, 0);
  assert.equal(fs.existsSync(f.source), false);
  assert.ok(fs.statSync(path.join(f.target, 'workspace')).isDirectory());
  assert.equal(read(locationFile(f)).path, f.target);
});

test('existing empty destination is accepted, existing content is never overwritten', async t => {
  const f = fixture(t); fs.mkdirSync(f.target);
  fs.writeFileSync(path.join(f.target, 'keep.txt'), 'user data');
  await assert.rejects(f.migration.migrate({ path: f.target }), /为空|覆盖/);
  assert.equal(fs.readFileSync(path.join(f.target, 'keep.txt'), 'utf8'), 'user data');
  fs.unlinkSync(path.join(f.target, 'keep.txt'));
  assert.equal((await f.migration.migrate({ path: f.target })).ok, true);
});

test('absolute paths, drive/home/code roots and mutually nested roots are refused before copying', async t => {
  const f = fixture(t), project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const target of ['relative-folder', path.parse(f.root).root, os.homedir(), f.home, path.join(f.source, 'child'), path.dirname(f.source), project, path.join(project, 'private-data')]) await assert.rejects(f.migration.migrate({ path: target }));
  assert.equal(f.store.root, f.source);
  assert.equal(fs.existsSync(locationFile(f)), false);
});

test('active work rejects before target creation and busy status prevents concurrent migration', async t => {
  const f = fixture(t, { canMigrate: async () => ({ allowed: false, reason: 'synthetic active task' }) });
  await assert.rejects(f.migration.migrate({ path: f.target }), /synthetic active task/);
  assert.equal(fs.existsSync(f.target), false);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let first = true;
  const migration = new WorkspaceMigration({ store: f.store, getHome: () => f.home, canMigrate: async () => { if (first) { first = false; await blocked; } return true; } });
  const operation = migration.migrate({ path: f.target });
  assert.equal(migration.status().migrationInProgress, true);
  await assert.rejects(migration.migrate({ path: path.join(f.root, 'another') }), /正在进行/);
  release(); await operation;
  assert.equal(migration.status().migrationInProgress, false);
});

test('source edits during transaction fail the final source comparison without publishing', async t => {
  const f = fixture(t); let checks = 0;
  const migration = new WorkspaceMigration({ store: f.store, getHome: () => f.home, canMigrate: async () => { if (++checks === 2) fs.appendFileSync(path.join(f.source, 'workspace', 'example.txt'), ' changed'); return true; } });
  await assert.rejects(migration.migrate({ path: f.target }), /发生变化/);
  assert.equal(f.store.root, f.source);
  assert.equal(fs.existsSync(f.target), false);
  assert.equal(fs.existsSync(locationFile(f)), false);
  assert.ok(fs.readFileSync(path.join(f.source, 'workspace', 'example.txt'), 'utf8').endsWith(' changed'));
});

test('staging changes after its first verification are detected again before publishing', async t => {
  const f = fixture(t); let checks = 0;
  const migration = new WorkspaceMigration({ store: f.store, getHome: () => f.home, canMigrate: async () => {
    if (++checks === 2) {
      const staging = fs.readdirSync(f.root).find(name => name.startsWith('.my-fish-migration-'));
      fs.writeFileSync(path.join(f.root, staging, 'payload', 'credentials.json'), 'synthetic tamper');
    }
    return true;
  } });
  await assert.rejects(migration.migrate({ path: f.target }), /暂存副本.*变化/);
  assert.equal(fs.existsSync(f.target), false);
  assert.equal(f.store.root, f.source);
});

test('cancellation before publishing retains source and removes only owned staging', async t => {
  const f = fixture(t), abort = new AbortController(); let checks = 0;
  const migration = new WorkspaceMigration({ store: f.store, getHome: () => f.home, getSignal: () => abort.signal, canMigrate: async () => { if (++checks === 2) abort.abort(Error('synthetic cancellation')); return true; } });
  await assert.rejects(migration.migrate({ path: f.target }), /synthetic cancellation/);
  assert.equal(f.store.root, f.source);
  assert.equal(fs.existsSync(f.target), false);
  assert.equal(fs.existsSync(locationFile(f)), false);
  assert.equal(fs.existsSync(journalFile(f)), false);
  assert.ok(!fs.readdirSync(f.root).some(name => name.startsWith('.my-fish-migration-')));
});

test('cancellation after cwd switch rolls back before writing locator and preserves published copy', async t => {
  const f = fixture(t), abort = new AbortController(), calls = [];
  const migration = new WorkspaceMigration({ store: f.store, getHome: () => f.home, getSignal: () => abort.signal, updateWorkingDirectory: async (cwd, context) => { calls.push({ cwd, context }); if (!context.rollback) abort.abort(Error('synthetic stop after switch')); } });
  await assert.rejects(migration.migrate({ path: f.target }), /synthetic stop after switch/);
  assert.equal(f.store.root, f.source);
  assert.equal(calls[1].context.rollback, true);
  assert.equal(fs.existsSync(locationFile(f)), false);
  assert.ok(fs.existsSync(path.join(f.target, 'credentials.json')));
});

test('cwd switch failure rolls back actual prior cwd and locator, preserving verified destination as an unused copy', async t => {
  const f = fixture(t), actualCwd = path.join(f.root, 'some-other-folder'); fs.mkdirSync(actualCwd);
  fs.writeFileSync(locationFile(f), JSON.stringify({ version: 1, path: f.source, previousPath: 'historical-value' }));
  const calls = [];
  const migration = new WorkspaceMigration({ store: f.store, getHome: () => f.home, getWorkingDirectory: async () => actualCwd, updateWorkingDirectory: async (cwd, context) => { calls.push({ cwd, context }); if (!context.rollback) throw Error('synthetic host failure'); } });
  await assert.rejects(migration.migrate({ path: f.target }), /已恢复原工作区/);
  assert.equal(f.store.root, f.source);
  assert.equal(calls[1].cwd, actualCwd);
  assert.equal(calls[1].context.rollback, true);
  assert.equal(read(locationFile(f)).previousPath, 'historical-value');
  assert.ok(fs.statSync(f.target).isDirectory());
  assert.ok(fs.statSync(f.source).isDirectory());
  assert.equal(fs.existsSync(journalFile(f)), false);
});

test('failed cwd rollback leaves a recovery journal, then recovery uses its saved actual cwd', async t => {
  const f = fixture(t), actualCwd = path.join(f.root, 'actual-cwd'); fs.mkdirSync(actualCwd);
  const broken = new WorkspaceMigration({ store: f.store, getHome: () => f.home, getWorkingDirectory: async () => actualCwd, updateWorkingDirectory: async () => { throw Error('synthetic cwd unavailable'); } });
  await assert.rejects(broken.migrate({ path: f.target }), /回滚失败/);
  assert.equal(read(journalFile(f)).previousCwd, actualCwd);
  assert.equal(broken.status().pendingRecovery, true);
  const calls = [], recovery = new WorkspaceMigration({ store: f.store, getHome: () => f.home, updateWorkingDirectory: async (cwd, context) => calls.push({ cwd, context }) });
  const recovered = await recovery.recover();
  assert.equal(recovered.committed, false);
  assert.equal(calls[0].cwd, actualCwd);
  assert.equal(calls[0].context.rollback, true);
  assert.equal(f.store.root, f.source);
  assert.ok(fs.existsSync(f.target));
  assert.equal(fs.existsSync(journalFile(f)), false);
});

test('uncommitted crash recovery selects source and keeps a published target copy', async t => {
  const f = fixture(t), journal = pending(f);
  await assert.rejects(f.migration.migrate({ path: path.join(f.root, 'next') }), /未恢复/);
  const result = await f.migration.recover();
  assert.equal(result.recovered, true);
  assert.equal(result.committed, false);
  assert.equal(f.store.root, f.source);
  assert.ok(fs.existsSync(path.join(f.target, 'credentials.json')));
  assert.equal(fs.existsSync(journal.staging), false);
  assert.equal(fs.existsSync(journalFile(f)), false);
  assert.equal(fs.existsSync(locationFile(f)), false);
});

test('committed crash recovery follows the stable locator and retains original directory', async t => {
  const f = fixture(t); pending(f, { committed: true });
  const result = await f.migration.recover();
  assert.equal(result.committed, true);
  assert.equal(f.store.root, f.target);
  assert.equal(f.cwdCalls[0].cwd, path.join(f.target, 'workspace'));
  assert.ok(fs.existsSync(path.join(f.source, 'credentials.json')));
  assert.equal(fs.existsSync(journalFile(f)), false);
});

test('recovery failing before cwd service is available remains pending and can retry later', async t => {
  const f = fixture(t); pending(f, { committed: true });
  const unavailable = new WorkspaceMigration({ store: f.store, getHome: () => f.home, updateWorkingDirectory: async () => { throw Error('service not ready'); } });
  await assert.rejects(unavailable.recover(), /service not ready/);
  assert.equal(unavailable.status().pendingRecovery, true);
  assert.equal((await f.migration.recover()).committed, true);
});

test('forged journal staging cannot delete a user directory', async t => {
  const f = fixture(t), journal = pending(f, { phase: 'prepared' }), keep = path.join(f.root, 'keep-directory');
  fs.mkdirSync(keep); fs.writeFileSync(path.join(keep, 'keep.txt'), 'keep');
  fs.writeFileSync(journalFile(f), JSON.stringify({ ...journal, staging: keep }));
  await assert.rejects(f.migration.recover(), /日志目录关系无效/);
  assert.equal(fs.readFileSync(path.join(keep, 'keep.txt'), 'utf8'), 'keep');
  assert.ok(fs.existsSync(journal.staging));
});

test('source junctions and target parent junctions are refused without traversing their data', async t => {
  const f = fixture(t), external = path.join(f.root, 'external'); fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, 'keep.txt'), 'never follow or remove');
  const link = path.join(f.source, 'workspace', 'linked');
  try { fs.symlinkSync(external, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('symlink creation unavailable'); return; } throw error; }
  await assert.rejects(f.migration.migrate({ path: f.target }), /链接|junction|重解析/);
  fs.unlinkSync(link);
  const parentLink = path.join(f.root, 'linked-parent'); fs.symlinkSync(external, parentLink, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.migration.migrate({ path: path.join(parentLink, 'new-folder') }), /链接|junction|重解析/);
  assert.equal(fs.readFileSync(path.join(external, 'keep.txt'), 'utf8'), 'never follow or remove');
  assert.equal(fs.existsSync(path.join(external, 'new-folder')), false);
});

test('only the verified live lease is excluded from copied data and its source lock remains with the engine', async t => {
  const f = fixture(t), lock = heldLock(f);
  try {
    const migration = new WorkspaceMigration({ store: f.store, getHome: () => f.home, getOperationLock: () => lock.lease });
    const result = await migration.migrate({ path: f.target });
    assert.equal(result.files, 4);
    assert.equal(fs.existsSync(path.join(f.target, '.operation.lock')), false);
    assert.equal(fs.existsSync(lock.lease.path), true);
    assert.equal(read(locationFile(f)).path, f.target);
  } finally { lock.close(); }
});

test('unknown lock or a forged descriptor cannot be silently skipped or copied', async t => {
  const f = fixture(t), lock = heldLock(f);
  const another = path.join(f.root, 'another-lock'), fd = fs.openSync(another, 'wx');
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token: lock.lease.token }));
  try {
    await assert.rejects(f.migration.migrate({ path: f.target }), /操作锁无法核对/);
    const forged = new WorkspaceMigration({ store: f.store, getHome: () => f.home, getOperationLock: () => ({ ...lock.lease, fd }) });
    await assert.rejects(forged.migrate({ path: f.target }), /句柄与路径不匹配/);
    assert.equal(fs.existsSync(f.target), false);
    assert.equal(fs.existsSync(lock.lease.path), true);
  } finally { fs.closeSync(fd); lock.close(); }
});

test('live lease nonce replacement during copy is detected instead of excluding an unrelated lock', async t => {
  const f = fixture(t), lock = heldLock(f); let checks = 0;
  try {
    const migration = new WorkspaceMigration({ store: f.store, getHome: () => f.home, getOperationLock: () => lock.lease, canMigrate: async () => {
      if (++checks === 2) fs.writeSync(lock.lease.fd, Buffer.from(JSON.stringify({ pid: process.pid, token: crypto.randomUUID() })), 0, Buffer.byteLength(JSON.stringify({ pid: process.pid, token: lock.lease.token })), 0);
      return true;
    } });
    await assert.rejects(migration.migrate({ path: f.target }), /操作锁.*替换或修改/);
    assert.equal(fs.existsSync(f.target), false);
    assert.equal(fs.existsSync(lock.lease.path), true);
  } finally { lock.close(); }
});

test('crash recovery refuses an exact lock while its recorded process is still live', async t => {
  const f = fixture(t), lock = heldLock(f);
  try {
    const journal = pending(f, { phase: 'prepared' });
    journal.operationLock = serializableLock(lock.lease.path, process.pid, lock.lease.token);
    fs.writeFileSync(journalFile(f), JSON.stringify(journal));
    await assert.rejects(f.migration.recover(), /进程仍在运行/);
    assert.ok(fs.existsSync(journalFile(f)));
    assert.ok(fs.existsSync(lock.lease.path));
  } finally { lock.close(); }
});

test('crash recovery removes only the matching dead-process source lock and retains all data', async t => {
  const f = fixture(t), journal = pending(f, { phase: 'prepared' });
  const pid = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', ''], { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject); child.once('close', () => resolve(child.pid));
  });
  assert.throws(() => process.kill(pid, 0), /ESRCH|no such process/);
  const lock = path.join(f.source, '.operation.lock'), token = crypto.randomUUID();
  fs.writeFileSync(lock, JSON.stringify({ pid, token }));
  journal.operationLock = serializableLock(lock, pid, token);
  fs.writeFileSync(journalFile(f), JSON.stringify(journal));
  assert.equal((await f.migration.recover()).recovered, true);
  assert.equal(fs.existsSync(lock), false);
  assert.ok(fs.existsSync(path.join(f.source, 'credentials.json')));
  assert.equal(fs.existsSync(journalFile(f)), false);
});

test('crash recovery never removes a source lock whose nonce was replaced', async t => {
  const f = fixture(t), journal = pending(f, { phase: 'prepared' }), lock = path.join(f.source, '.operation.lock');
  const token = crypto.randomUUID();
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token }));
  journal.operationLock = serializableLock(lock, process.pid, token);
  fs.writeFileSync(journalFile(f), JSON.stringify(journal));
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token: crypto.randomUUID() }));
  await assert.rejects(f.migration.recover(), /被其他实例替换/);
  assert.ok(fs.existsSync(lock));
  assert.ok(fs.existsSync(journalFile(f)));
  assert.ok(fs.existsSync(path.join(f.source, 'credentials.json')));
});
