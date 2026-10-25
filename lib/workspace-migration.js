import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCATION = 'my-fish-location.json';
const JOURNAL = 'my-fish-migration.json';
const OWNER = 'owner.json';
const PHASES = new Set(['prepared', 'copied', 'published', 'cwd-updated', 'committed', 'rollback-needed']);
const exists = value => { try { return fs.lstatSync(value); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const same = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
const inside = (candidate, parent) => same(candidate, parent) || (!path.relative(parent, candidate).startsWith('..' + path.sep) && path.relative(parent, candidate) !== '..' && !path.isAbsolute(path.relative(parent, candidate)));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function absolute(value, label) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.includes('\0') || !path.isAbsolute(value)) throw Error(label + '必须是完整绝对目录');
  if (process.platform === 'win32' && (value.startsWith('\\\\') || value.startsWith('\\?\\') || value.split(/[\\/]/).slice(1).some(part => /[. ]$/.test(part) || /[:<>"|?*]/.test(part)))) throw Error(label + '需要不含设备路径、网络共享或特殊名称的本机目录');
  return path.resolve(value);
}
function noLink(stat) { if (stat?.isSymbolicLink()) throw Error('工作区迁移不接受符号链接、junction 或重解析点'); }
function ancestors(candidate) {
  const result = [], root = path.parse(candidate).root;
  let current = candidate;
  while (true) { result.push(current); if (same(current, root)) break; current = path.dirname(current); }
  return result.reverse();
}
function assertAncestors(candidate) {
  const present = [];
  for (const item of ancestors(candidate)) {
    const stat = exists(item);
    if (!stat) continue;
    noLink(stat);
    if (!same(item, candidate) && !stat.isDirectory()) throw Error('目录的父路径不是文件夹');
    present.push(item);
  }
  return present;
}
function canonicalCandidate(candidate, knownUserHome = false) {
  let current = candidate;
  const missing = [];
  while (!exists(current)) { missing.unshift(path.basename(current)); const parent = path.dirname(current); if (same(parent, current)) throw Error('目录根路径不可用'); current = parent; }
  let resolved;
  try { resolved = fs.realpathSync.native(current); }
  catch (error) {
    // Windows may deny native GetFinalPathNameByHandle on the OS-reported user
    // home itself. Only this known comparison root gets the lstat/readlink path;
    // user-supplied source and target paths remain fail-closed.
    if (!knownUserHome || error.code !== 'EPERM') throw error;
    resolved = fs.realpathSync(current);
  }
  return path.join(resolved, ...missing);
}
function readMetadata(file) {
  const stat = exists(file); if (!stat) return null;
  noLink(stat);
  if (!stat.isFile() || stat.size > 128000) throw Error('工作区定位或迁移日志无效');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw Error('工作区定位或迁移日志损坏，请保留现场后修复'); }
}
async function atomicMetadata(file, value) {
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  let handle;
  try {
    handle = await fs.promises.open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); await handle.close(); handle = null;
    noLink(exists(file));
    await fs.promises.rename(temporary, file);
  } finally {
    await handle?.close();
    if (exists(temporary)) await fs.promises.unlink(temporary);
  }
}
/** Read only file attributes; PowerShell never receives file contents or executable paths from the user. */
async function windowsReparseCheck(paths, trees = []) {
  if (process.platform !== 'win32') return;
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = `$ErrorActionPreference='Stop';$q=[Console]::In.ReadToEnd()|ConvertFrom-Json;function Check($v){if(($v.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'reparse'}};foreach($p in $q.paths){Check (Get-Item -LiteralPath $p -Force)};$stack=New-Object 'System.Collections.Generic.Stack[string]';foreach($p in $q.trees){$stack.Push($p)};while($stack.Count -gt 0){$p=$stack.Pop();$v=Get-Item -LiteralPath $p -Force;Check $v;if($v.PSIsContainer){foreach($c in Get-ChildItem -LiteralPath $p -Force){Check $c;if($c.PSIsContainer){$stack.Push($c.FullName)}}}};[Console]::Out.Write('ok')`;
  await new Promise((resolve, reject) => {
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', settled = false;
    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => { child.kill(); finish(Error('Windows 目录属性检查超时，迁移未继续')); }, 30000);
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 100) child.kill(); });
    child.stderr.on('data', () => {});
    child.on('error', () => finish(Error('无法完成 Windows 重解析点检查，迁移未继续')));
    child.on('close', code => finish(code === 0 && output.trim() === 'ok' ? null : Error('目录包含重解析点或无法安全检查，迁移未继续')));
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ paths: [...new Set(paths)], trees }));
  });
}
function identity(stat) { return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].map(String).join(':'); }
function lockContents(file, descriptor) {
  const info = fs.lstatSync(file, { bigint: true }); noLink(info);
  if (!info.isFile() || info.size < 1n || info.size > 4096n) throw Error('操作锁格式无效，迁移已停止');
  let bytes;
  if (descriptor !== undefined) {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (identity(opened) !== identity(info)) throw Error('操作锁句柄与路径不匹配，迁移已停止');
  }
  // Engine owns a write-only wx descriptor. Read through a second no-follow
  // handle and prove it is the very same file before inspecting the nonce.
  const readDescriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    if (identity(fs.fstatSync(readDescriptor, { bigint: true })) !== identity(info)) throw Error('操作锁在核对期间已改变，迁移已停止');
    bytes = fs.readFileSync(readDescriptor);
    if (identity(fs.fstatSync(readDescriptor, { bigint: true })) !== identity(info)) throw Error('操作锁在核对期间已改变，迁移已停止');
  } finally { fs.closeSync(readDescriptor); }
  const after = fs.lstatSync(file, { bigint: true }); noLink(after);
  if (identity(after) !== identity(info)) throw Error('操作锁在核对期间已改变，迁移已停止');
  let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { throw Error('操作锁不是可核对的迁移锁，迁移已停止'); }
  if (!value || Object.keys(value).some(key => !['pid', 'token'].includes(key)) || !Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.token !== 'string' || !/^[a-zA-Z0-9-]{16,128}$/.test(value.token)) throw Error('操作锁身份无效，迁移已停止');
  return { value, identity: identity(info) };
}
function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw Error('无法核对上次迁移进程是否仍在运行'); }
}
async function fileHash(file, expected, check = () => {}) {
  check();
  noLink(await fs.promises.lstat(file));
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0), handle = await fs.promises.open(file, flags);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || identity(before) !== expected) throw Error('源文件在迁移期间发生变化，迁移已停止');
    const digest = crypto.createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) { check(); digest.update(chunk); }
    if (identity(await handle.stat({ bigint: true })) !== expected) throw Error('源文件在迁移期间发生变化，迁移已停止');
    noLink(await fs.promises.lstat(file));
    return digest.digest('hex');
  } finally { await handle.close(); }
}
async function manifest(root, check = () => {}) {
  check();
  const rows = [];
  const rootStat = exists(root); if (!rootStat) return rows;
  noLink(rootStat); if (!rootStat.isDirectory()) throw Error('工作区来源必须是文件夹');
  async function walk(directory, relative = '') {
    check();
    const stat = await fs.promises.lstat(directory, { bigint: true }); noLink(stat);
    if (!stat.isDirectory()) throw Error('工作区目录在迁移期间发生变化');
    rows.push({ path: relative, type: 'directory', identity: identity(stat) });
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      check();
      const child = path.join(directory, entry.name), name = relative ? relative + '/' + entry.name : entry.name;
      const info = await fs.promises.lstat(child, { bigint: true }); noLink(info);
      if (info.isDirectory()) await walk(child, name);
      else if (info.isFile()) rows.push({ path: name, type: 'file', identity: identity(info), bytes: Number(info.size), sha256: await fileHash(child, identity(info), check), mode: Number(info.mode) & 0o777 });
      else throw Error('工作区包含不支持的特殊文件，迁移已停止');
    }
    const after = await fs.promises.lstat(directory, { bigint: true }); noLink(after);
    if (identity(after) !== identity(stat)) throw Error('工作区目录在迁移期间发生变化');
  }
  await walk(root);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}
function content(rows) { return rows.map(({ path, type, bytes, sha256 }) => ({ path, type, ...(type === 'file' ? { bytes, sha256 } : {}) })); }
function unchanged(before, after) { return JSON.stringify(before) === JSON.stringify(after); }
function validateJournal(journal, home) {
  if (!journal || journal.version !== 1 || !/^[a-f0-9-]{36}$/.test(journal.id) || !PHASES.has(journal.phase)) throw Error('迁移日志格式无效，已阻止自动恢复');
  for (const key of ['source', 'target', 'staging']) absolute(journal[key], '迁移日志目录');
  if (!same(path.dirname(journal.staging), path.dirname(journal.target)) || !path.basename(journal.staging).startsWith('.my-fish-migration-' + journal.id + '-') || inside(journal.staging, journal.source) || same(journal.target, home) || inside(journal.target, journal.source) || inside(journal.source, journal.target)) throw Error('迁移日志目录关系无效，已阻止自动恢复');
  if (journal.previousLocation !== null && (!journal.previousLocation || journal.previousLocation.version !== 1 || !same(absolute(journal.previousLocation.path, '原定位目录'), journal.source))) throw Error('原工作区定位与迁移日志不匹配');
  return journal;
}

/** Full private data-root migration. Keeps the source directory intact as a rollback copy. */
export class WorkspaceMigration {
  constructor({ store, getHome = () => store?.home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), canMigrate = async () => true, updateWorkingDirectory = async () => {}, getWorkingDirectory, getSignal = () => undefined, getOperationLock = () => undefined, now = () => Date.now(), sourceRoot = () => PROJECT_ROOT } = {}) {
    if (!store || typeof store.root !== 'string') throw Error('需要 My Fish 数据存储');
    this.store = store; this.getHome = getHome; this.canMigrate = canMigrate; this.updateWorkingDirectory = updateWorkingDirectory; this.getWorkingDirectory = getWorkingDirectory; this.getSignal = getSignal; this.getOperationLock = getOperationLock; this.now = now; this.sourceRoot = sourceRoot; this.busy = false;
  }
  _home() { return absolute(this.getHome(), '宿主数据目录'); }
  _location() { return path.join(this._home(), LOCATION); }
  _journal() { return path.join(this._home(), JOURNAL); }
  status() {
    const location = readMetadata(this._location()), pending = readMetadata(this._journal());
    return { path: this.store.root, workspacePath: path.join(this.store.root, 'workspace'), locationFile: this._location(), migrationInProgress: this.busy, pendingRecovery: !!pending, lastMigration: location?.lastMigration ?? null };
  }
  async _permission() {
    this._check();
    const result = await this.canMigrate();
    this._check();
    if (result === false || (result && typeof result === 'object' && (result.allowed === false || result.ok === false))) throw Error(result?.reason || '当前有任务或写入正在进行，请停止后再迁移工作区');
  }
  _check() { this.getSignal()?.throwIfAborted(); }
  _manifest(root) { return manifest(root, () => this._check()); }
  _captureLock(source) {
    const lockPath = path.join(source, '.operation.lock'), lease = this.getOperationLock();
    if (!exists(lockPath) && !lease) return null;
    if (!lease || !Number.isInteger(lease.fd) || lease.fd < 0 || lease.pid !== process.pid || typeof lease.path !== 'string' || !same(lease.path, lockPath)) throw Error('当前操作锁无法核对，迁移已停止；不会复制或忽略未知锁');
    const current = lockContents(lockPath, lease.fd);
    if (current.value.pid !== lease.pid || current.value.token !== lease.token) throw Error('当前操作锁身份不匹配，迁移已停止');
    return { path: lockPath, pid: lease.pid, token: lease.token, identity: current.identity };
  }
  _verifyLock(record) {
    if (!record) return;
    const lease = this.getOperationLock();
    if (!lease || lease.pid !== record.pid || lease.token !== record.token || !same(lease.path, record.path) || !Number.isInteger(lease.fd)) throw Error('迁移持有的操作锁已改变，迁移已停止');
    const current = lockContents(record.path, lease.fd);
    if (current.identity !== record.identity || current.value.pid !== record.pid || current.value.token !== record.token) throw Error('迁移持有的操作锁已被替换或修改，迁移已停止');
  }
  async _sourceManifest(source, operationLock) {
    this._verifyLock(operationLock);
    const rows = await this._manifest(source);
    this._verifyLock(operationLock);
    if (!operationLock && rows.some(row => row.path === '.operation.lock')) throw Error('来源出现了未知操作锁，迁移已停止');
    return operationLock ? rows.filter(row => row.path !== '.operation.lock') : rows;
  }
  _recoverLock(journal) {
    const record = journal.operationLock;
    if (!record) return;
    if (typeof record.path !== 'string' || !same(record.path, path.join(journal.source, '.operation.lock')) || !Number.isSafeInteger(record.pid) || record.pid < 1 || typeof record.token !== 'string' || typeof record.identity !== 'string') throw Error('迁移日志中的操作锁身份无效，已阻止恢复');
    if (!exists(record.path)) return;
    const current = lockContents(record.path);
    if (current.identity !== record.identity || current.value.pid !== record.pid || current.value.token !== record.token) throw Error('原操作锁已被其他实例替换，已保留并阻止恢复');
    if (processAlive(record.pid)) throw Error('上次迁移进程仍在运行，不能移除它的操作锁或自动恢复');
    const checked = lockContents(record.path);
    if (checked.identity !== record.identity || checked.value.pid !== record.pid || checked.value.token !== record.token) throw Error('原操作锁在恢复期间发生变化，已阻止恢复');
    fs.unlinkSync(record.path);
  }
  _boundaries(source, target, canonical = false) {
    const selectedHome = this._home(), selectedProject = absolute(typeof this.sourceRoot === 'function' ? this.sourceRoot() : this.sourceRoot, '插件源码目录');
    const home = canonical ? canonicalCandidate(selectedHome) : selectedHome, project = canonical ? canonicalCandidate(selectedProject) : selectedProject, userHome = canonical ? canonicalCandidate(os.homedir(), true) : os.homedir();
    if (same(target, path.parse(target).root) || same(target, userHome) || same(target, home)) throw Error('不能把盘符根目录或用户/宿主主目录作为工作区');
    if (inside(target, project) || inside(project, target) || inside(source, project) || inside(project, source) || same(source, home) || same(source, userHome) || same(source, path.parse(source).root)) throw Error('工作区不能与插件源码目录或宿主根目录重叠');
    if (inside(target, source) || inside(source, target)) throw Error('新旧工作区不能相同或互相嵌套');
    return { home };
  }
  async _paths(source, target) {
    const { home } = this._boundaries(source, target);
    const sourcePaths = assertAncestors(source), targetPaths = assertAncestors(target), homePaths = assertAncestors(home);
    const parent = exists(path.dirname(target));
    if (!parent?.isDirectory()) throw Error('目标父文件夹必须已存在，请先选择或创建父文件夹');
    const stat = exists(target); noLink(stat);
    if (stat && (!stat.isDirectory() || fs.readdirSync(target).length)) throw Error('目标工作区必须不存在或为空文件夹，不覆盖已有内容');
    const sourceStat = exists(source); noLink(sourceStat);
    if (sourceStat && !sourceStat.isDirectory()) throw Error('当前工作区不是文件夹');
    await windowsReparseCheck([...sourcePaths, ...targetPaths, ...homePaths], sourceStat ? [source] : []);
    // Existing ancestors have been checked for links before realpath resolves
    // Windows short-name aliases. Aliases cannot bypass source/code boundaries.
    this._boundaries(canonicalCandidate(source), canonicalCandidate(target), true);
    return { home, parent: path.dirname(target), targetExisted: !!stat };
  }
  async _cleanup(journal) {
    const directory = journal.staging;
    if (!exists(directory)) return;
    validateJournal(journal, this._home());
    const paths = assertAncestors(directory);
    await windowsReparseCheck(paths, [directory]);
    const owner = readMetadata(path.join(directory, OWNER));
    if (owner?.version !== 1 || owner.id !== journal.id || owner.source !== journal.source || owner.target !== journal.target) throw Error('临时目录归属无法核对，已保留供人工检查');
    // Inspect every entry before recursive cleanup; only this transaction's unique
    // staging container is ever removed, never an input target or the source.
    await manifest(directory);
    if (!same(path.dirname(directory), path.dirname(journal.target))) throw Error('临时目录越界，已保留');
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
  async _restoreLocation(previous) {
    noLink(exists(this._location()));
    if (previous === null) { if (exists(this._location())) await fs.promises.unlink(this._location()); }
    else await atomicMetadata(this._location(), previous);
  }
  async migrate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'path')) throw Error('工作区迁移请求只接受 path');
    if (this.busy) throw Error('工作区迁移正在进行，请等待结果');
    this.busy = true;
    let journal = null, cwdAttempted = false, published = false;
    try {
      const source = absolute(this.store.root, '当前工作区'), target = absolute(input.path, '新工作区');
      if (exists(this._journal())) throw Error('检测到未恢复的迁移事务，请先恢复后再修改工作区');
      if (same(source, target)) return { ok: true, unchanged: true, path: source, workspacePath: path.join(source, 'workspace'), note: '工作区未改变。' };
      await this._permission();
      const { home, parent } = await this._paths(source, target);
      const previousLocation = readMetadata(this._location());
      if (previousLocation && (previousLocation.version !== 1 || !same(absolute(previousLocation.path, '原定位目录'), source))) throw Error('当前存储与工作区定位不一致，迁移已停止');
      const operationLock = this._captureLock(source), before = await this._sourceManifest(source, operationLock), id = crypto.randomUUID();
      const staging = await fs.promises.mkdtemp(path.join(parent, '.my-fish-migration-' + id + '-'));
      await fs.promises.chmod(staging, 0o700);
      journal = { version: 1, id, source, target, staging, previousLocation, phase: 'prepared', createdAt: this.now(), ...(operationLock ? { operationLock } : {}) };
      await atomicMetadata(path.join(staging, OWNER), { version: 1, id, source, target });
      await atomicMetadata(path.join(home, JOURNAL), journal);
      const payload = path.join(staging, 'payload'); await fs.promises.mkdir(payload, { mode: 0o700 });
      for (const row of before) {
        this._check();
        if (!row.path) continue;
        const destination = path.join(payload, ...row.path.split('/'));
        if (row.type === 'directory') await fs.promises.mkdir(destination, { recursive: true, mode: 0o700 });
        else {
          noLink(await fs.promises.lstat(path.join(source, ...row.path.split('/'))));
          await fs.promises.copyFile(path.join(source, ...row.path.split('/')), destination, fs.constants.COPYFILE_EXCL);
          await fs.promises.chmod(destination, row.mode & 0o700 || 0o600);
        }
      }
      const staged = await this._manifest(payload), expected = before.length ? content(before) : [{ path: '', type: 'directory' }];
      if (!unchanged(expected, content(staged))) throw Error('复制后的路径集合或 SHA256 不一致，迁移已停止');
      if (!unchanged(before, await this._sourceManifest(source, operationLock))) throw Error('来源在复制期间发生变化，迁移已停止');
      // A new installation may not have a conversation workspace yet.
      const working = path.join(payload, 'workspace');
      if (!exists(working)) await fs.promises.mkdir(working, { mode: 0o700 });
      if (!exists(working)?.isDirectory()) throw Error('workspace 必须是文件夹，迁移已停止');
      journal.phase = 'copied'; journal.files = before.filter(row => row.type === 'file').length; journal.bytes = before.reduce((sum, row) => sum + (row.bytes || 0), 0);
      const readyContent = content(await this._manifest(payload));
      journal.manifest = hash(JSON.stringify(readyContent));
      await atomicMetadata(this._journal(), journal);
      await this._permission();
      await this._paths(source, target);
      if (!unchanged(before, await this._sourceManifest(source, operationLock))) throw Error('来源在提交前发生变化，迁移已停止');
      if (!unchanged(readyContent, content(await this._manifest(payload)))) throw Error('暂存副本在提交前发生变化，迁移已停止');
      this._check();
      const targetStat = exists(target);
      if (targetStat) { noLink(targetStat); if (!targetStat.isDirectory() || fs.readdirSync(target).length) throw Error('目标目录已被其他程序写入，迁移已停止'); await fs.promises.rmdir(target); }
      this._check();
      await fs.promises.rename(payload, target); published = true;
      journal.phase = 'published'; await atomicMetadata(this._journal(), journal);
      if (typeof this.getWorkingDirectory === 'function') {
        const previousCwd = await this.getWorkingDirectory();
        if (previousCwd !== undefined && previousCwd !== null) journal.previousCwd = absolute(previousCwd, '原会话工作目录');
      }
      await atomicMetadata(this._journal(), journal);
      cwdAttempted = true;
      await this.updateWorkingDirectory(path.join(target, 'workspace'), { phase: 'commit', rollback: false, previousCwd: journal.previousCwd ?? path.join(source, 'workspace'), source, target });
      this._check();
      journal.phase = 'cwd-updated'; await atomicMetadata(this._journal(), journal);
      if (!unchanged(before, await this._sourceManifest(source, operationLock))) throw Error('来源在切换期间发生变化，迁移已停止');
      const at = this.now(), lastMigration = { id, at, previousPath: source, path: target, files: journal.files, bytes: journal.bytes, verified: 'sha256-and-path-set', sourceRetained: true };
      this._check();
      await atomicMetadata(this._location(), { version: 1, path: target, previousPath: source, updatedAt: at, lastMigration });
      this.store.root = target;
      journal.phase = 'committed'; await atomicMetadata(this._journal(), journal);
      await this._cleanup(journal); await fs.promises.unlink(this._journal());
      return { ok: true, path: target, previousPath: source, workspacePath: path.join(target, 'workspace'), files: journal.files, bytes: journal.bytes, lastMigration, note: '工作区已切换，完整数据已逐文件核验；原目录保留为备份，没有删除。' };
    } catch (error) {
      if (!journal) throw error;
      const failures = [];
      // A committed pointer is the recovery authority; never silently switch a
      // successful commit back if only final journal cleanup failed.
      let location;
      try { location = readMetadata(this._location()); } catch { failures.push('定位读取失败'); }
      const committed = location?.lastMigration?.id === journal.id && same(location.path, journal.target);
      if (committed) {
        this.store.root = journal.target;
        throw Error('工作区已提交，但迁移收尾未完成；请先恢复事务后继续使用，原目录仍保留。');
      }
      if (cwdAttempted) try { await this.updateWorkingDirectory(journal.previousCwd ?? path.join(journal.source, 'workspace'), { phase: 'rollback', rollback: true, previousCwd: path.join(journal.target, 'workspace'), source: journal.source, target: journal.target }); } catch { failures.push('宿主工作目录回滚失败'); }
      try { await this._restoreLocation(journal.previousLocation); } catch { failures.push('工作区定位回滚失败'); }
      this.store.root = journal.source;
      try { await this._cleanup(journal); } catch { failures.push('临时目录保留'); }
      if (failures.length) {
        journal.phase = 'rollback-needed'; try { await atomicMetadata(this._journal(), journal); } catch {}
        throw Error('迁移未提交，源目录保留；' + failures.join('、') + '，请先恢复事务。');
      }
      if (exists(this._journal())) await fs.promises.unlink(this._journal());
      throw Error('迁移未提交，已恢复原工作区；' + (published ? '已核验的目标副本保留，请使用其他空目录重试。' : '源目录和已有数据保持原位。') + ' 原因：' + String(error.message).slice(0, 300));
    } finally { this.busy = false; }
  }
  async recover() {
    if (this.busy) throw Error('工作区迁移正在进行，暂不能恢复');
    this.busy = true;
    try {
      const journal = readMetadata(this._journal());
      if (!journal) return { ok: true, recovered: false, ...this.status(), migrationInProgress: false };
      validateJournal(journal, this._home());
      this._boundaries(journal.source, journal.target);
      const sourcePaths = assertAncestors(journal.source), targetPaths = assertAncestors(journal.target), homePaths = assertAncestors(this._home());
      await windowsReparseCheck([...sourcePaths, ...targetPaths, ...homePaths]);
      this._boundaries(canonicalCandidate(journal.source), canonicalCandidate(journal.target), true);
      this._recoverLock(journal);
      const location = readMetadata(this._location());
      const committed = location?.lastMigration?.id === journal.id && same(location.path, journal.target);
      const selected = committed ? journal.target : journal.source;
      if (exists(path.join(selected, '.operation.lock'))) throw Error('恢复目录仍有无法归属于本次事务的操作锁，已阻止继续写入；请先核对实例和锁文件');
      const stat = exists(selected); if (stat && !stat.isDirectory()) throw Error('恢复目录不是文件夹，已阻止继续写入');
      if (committed && !stat) throw Error('已提交的工作区目录丢失，已阻止自动恢复');
      await windowsReparseCheck([...sourcePaths, ...targetPaths, ...homePaths], stat ? [selected] : []);
      await manifest(selected);
      const restoredCwd = !committed && journal.previousCwd ? absolute(journal.previousCwd, '原会话工作目录') : path.join(selected, 'workspace');
      await this.updateWorkingDirectory(restoredCwd, { phase: 'recovery', rollback: !committed, previousCwd: path.join(committed ? journal.source : journal.target, 'workspace'), source: journal.source, target: journal.target, committed });
      if (!committed) await this._restoreLocation(journal.previousLocation);
      this.store.root = selected;
      await this._cleanup(journal);
      await fs.promises.unlink(this._journal());
      return { ok: true, recovered: true, committed, path: selected, previousPath: committed ? journal.source : journal.target, workspacePath: path.join(selected, 'workspace'), note: committed ? '已恢复到已提交的新工作区；旧目录备份保留。' : '上次迁移未提交，已恢复原工作区；目标副本如已生成则保留，没有删除数据。', ...this.status(), migrationInProgress: false };
    } finally { this.busy = false; }
  }
}
