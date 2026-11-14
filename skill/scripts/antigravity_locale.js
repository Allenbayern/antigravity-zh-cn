#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { readAsarPackageVersion } = require('../vendor/asar-version');
const upstream = require('../vendor/auto-restore');

const PROD_APP_DIR = '/Applications/Antigravity.app';
const DEFAULT_VENDOR = path.resolve(__dirname, '..', 'vendor');
const DEFAULT_MANIFEST_PATH = path.resolve(__dirname, '..', 'vendor-manifest.json');

function fail(code, message, extra = {}) {
  return { success: false, code, message, ...extra };
}

function defaultIsAppRunning() {
  if (process.platform !== 'darwin') return false;
  try {
    const out = execFileSync('/usr/bin/pgrep', ['-f', '/Applications/Antigravity.app/Contents/MacOS/'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return out.trim().length > 0;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function rotateArchivedBackups(resourcesDir, keepCount = 2) {
  if (!fs.existsSync(resourcesDir)) return [];
  const entries = fs.readdirSync(resourcesDir)
    .filter((name) => /^app\.asar\.(?:bak\.[^.]+\.\d+|zh-cn\.[^.]+\.backup)$/.test(name))
    .map((name) => {
      const fullPath = path.join(resourcesDir, name);
      try {
        const st = fs.lstatSync(fullPath);
        if (!st.isFile() || st.isSymbolicLink()) return null;
        return { name, fullPath, mtimeMs: st.mtimeMs };
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const removed = [];
  for (const stale of entries.slice(keepCount)) {
    try {
      fs.unlinkSync(stale.fullPath);
      removed.push(stale.fullPath);
    } catch (_) {}
  }
  return removed;
}

function createLocaleManager({
  appDir = PROD_APP_DIR,
  vendorDir = DEFAULT_VENDOR,
  manifestPath = DEFAULT_MANIFEST_PATH,
  isAppRunning = defaultIsAppRunning,
  strictProdPath = true
} = {}) {
  const resourcesDir = path.join(appDir, 'Contents', 'Resources');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  function checkTargetState() {
    if (strictProdPath) {
      if (process.platform !== 'darwin') {
        return { ok: false, error: fail('UNSUPPORTED_PLATFORM', '仅支持 macOS。') };
      }
      if (path.resolve(appDir) !== PROD_APP_DIR || path.resolve(resourcesDir) !== path.join(PROD_APP_DIR, 'Contents', 'Resources')) {
        return { ok: false, error: fail('INVALID_TARGET_PATH', '目标路径不符合固定白名单。') };
      }
    }
    if (!fs.existsSync(appDir) || !fs.existsSync(resourcesDir)) {
      return { ok: false, error: fail('NOT_INSTALLED', `未找到 Antigravity 安装目录：${appDir}`) };
    }
    if (!fs.statSync(appDir).isDirectory() || !fs.statSync(resourcesDir).isDirectory()) {
      return { ok: false, error: fail('NOT_INSTALLED', '未找到 Antigravity 标准安装目录。') };
    }
    for (const file of [path.join(resourcesDir, 'app.asar'), path.join(resourcesDir, 'app.asar.bak')]) {
      if (fs.existsSync(file) && (!fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) {
        return { ok: false, error: fail('UNSAFE_TARGET_FILE', `目标不是普通文件或含符号链接，拒绝操作：${file}`) };
      }
    }
    return { ok: true };
  }

  async function verifyPayload() {
    for (const [name, expected] of Object.entries(manifest.sha256)) {
      const file = path.join(vendorDir, name);
      if (path.dirname(file) !== vendorDir || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        throw new Error(`补丁组件无效：${name}`);
      }
      const actual = await hashFile(file);
      if (actual !== expected) {
        throw new Error(`补丁组件 SHA256 不匹配，拒绝执行：${name}`);
      }
    }
    const patch = path.join(vendorDir, 'app.asar.ready');
    return {
      patch,
      patchVersion: readAsarPackageVersion(patch),
      isLocalized: upstream.isLocalizedAsar(patch)
    };
  }

  async function status() {
    const targetCheck = checkTargetState();
    if (!targetCheck.ok) {
      return {
        success: false,
        action: 'status',
        restartRequired: false,
        ...targetCheck.error
      };
    }

    const result = await upstream.checkClientStatus({ appDir, getResourcesDir: () => resourcesDir });
    let patchUpToDate = null;
    if (result.isInstalled && result.isLocalized) {
      try {
        const currentHash = await hashFile(result.asarPath);
        patchUpToDate = currentHash === manifest.sha256['app.asar.ready'];
      } catch (_) {}
    }

    let statusSummary = 'UNKNOWN';
    let recommendation = null;
    if (!result.isInstalled) {
      statusSummary = 'NOT_INSTALLED';
    } else if (result.isLocalized) {
      statusSummary = patchUpToDate ? 'LATEST_CUSTOMIZED' : 'PATCH_UPDATE_AVAILABLE';
      recommendation = patchUpToDate
        ? '已安装最新定制中文补丁，无需操作。'
        : '检测到客户端当前装有旧版或上游汉化补丁，可先 Cmd+Q 退出客户端后执行 upgrade 升级至最新定制版。';
    } else if (result.appVersion && result.appVersion !== manifest.clientVersion) {
      statusSummary = 'VERSION_MISMATCH_OVERWRITTEN';
      recommendation = `检测到当前客户端版本 (v${result.appVersion}) 与本地补丁版本 (v${manifest.clientVersion}) 不一致（可能已被官方更新覆盖），请等待对应新版本补丁后再安装。`;
    } else {
      statusSummary = 'READY_TO_INSTALL';
      recommendation = '当前客户端为原版英文且版本匹配，可在 Cmd+Q 退出客户端后执行 install 安装中文补丁。';
    }

    return {
      success: true,
      action: 'status',
      running: await isAppRunning(),
      restartRequired: false,
      patchVersion: manifest.clientVersion,
      patchUpToDate,
      statusSummary,
      recommendation,
      ...result
    };
  }

  async function install(forceUpgrade = false) {
    const targetCheck = checkTargetState();
    if (!targetCheck.ok) {
      return { ...targetCheck.error, action: forceUpgrade ? 'upgrade' : 'install', restartRequired: false };
    }

    const payload = await verifyPayload();
    if (!payload.isLocalized) {
      return fail('PAYLOAD_NOT_LOCALIZED', '离线包未通过汉化特征校验。', { restartRequired: false });
    }

    const currentStatus = await upstream.checkClientStatus({ appDir, getResourcesDir: () => resourcesDir });
    if (currentStatus.isInstalled && currentStatus.isLocalized) {
      const currentHash = await hashFile(currentStatus.asarPath);
      if (currentHash === manifest.sha256['app.asar.ready']) {
        return {
          success: true,
          action: forceUpgrade ? 'upgrade' : 'install',
          code: 'ALREADY_LOCALIZED',
          appVersion: currentStatus.appVersion,
          patchUpToDate: true,
          restartRequired: false,
          message: `当前客户端 (v${currentStatus.appVersion || '未知'}) 已安装最新定制汉化补丁，无需重复安装。`
        };
      }
      if (!forceUpgrade) {
        return {
          success: true,
          action: 'install',
          code: 'PATCH_UPDATE_AVAILABLE',
          appVersion: currentStatus.appVersion,
          patchUpToDate: false,
          restartRequired: false,
          message: '检测到当前已安装旧版汉化补丁，且本地有更新的定制补丁。请在手动 Cmd+Q 退出 Antigravity 后运行 `upgrade`（或 `install --force`）升级补丁。'
        };
      }

      const current = currentStatus.asarPath;
      const backup = currentStatus.backupPath;
      if (!fs.existsSync(backup)) {
        return fail('NO_BACKUP', '找不到原版 app.asar.bak，拒绝直接升级，请先恢复原版或核查安装状态。', { restartRequired: false });
      }
      if (upstream.isLocalizedAsar(backup)) {
        return fail('BACKUP_NOT_ORIGINAL', 'app.asar.bak 已被汉化污染，拒绝升级。', { restartRequired: false });
      }
      const currentVersion = readAsarPackageVersion(current);
      const backupVersion = readAsarPackageVersion(backup);
      if (!currentVersion || currentVersion !== backupVersion || currentVersion !== payload.patchVersion) {
        return fail('VERSION_MISMATCH', `版本不一致（当前: ${currentVersion}, 备份: ${backupVersion}, 补丁: ${payload.patchVersion}），已阻止升级。`, { restartRequired: false });
      }
      if (await isAppRunning()) {
        return fail('APP_RUNNING', 'Antigravity 正在运行中，请先手动 Cmd+Q 完全退出，再执行补丁升级。', { restartRequired: false });
      }

      const stage = path.join(resourcesDir, `.app.asar.upgrade-${process.pid}-${crypto.randomBytes(6).toString('hex')}.stage`);
      try {
        await fsp.copyFile(payload.patch, stage);
        if (await hashFile(stage) !== manifest.sha256['app.asar.ready']) throw new Error('暂存补丁包 SHA256 校验失败');
        if (readAsarPackageVersion(stage) !== currentVersion) throw new Error('升级包版本复核失败');
        await fsp.rename(stage, current);
        rotateArchivedBackups(resourcesDir, 2);
        return {
          success: true,
          action: 'upgrade',
          code: 'UPGRADED',
          appVersion: currentVersion,
          patchVersion: payload.patchVersion,
          patchUpToDate: true,
          restartRequired: true,
          message: `已将汉化补丁安全升级至最新定制版 (v${payload.patchVersion})，请手动重新打开 Antigravity。`
        };
      } catch (error) {
        try { if (fs.existsSync(stage)) await fsp.unlink(stage); } catch (_) {}
        return fail('UPGRADE_FAILED', error.message, { restartRequired: false });
      }
    }

    const result = await upstream.executeAutoRestore({
      appDir,
      getResourcesDir: () => resourcesDir,
      workspaceDir: vendorDir,
      candidatePatch: { path: payload.patch },
      isAppRunning,
      forceStop: false
    });
    if (result.success) {
      rotateArchivedBackups(resourcesDir, 2);
    }
    return { ...result, action: 'install', restartRequired: !!result.success };
  }

  async function restore() {
    const targetCheck = checkTargetState();
    if (!targetCheck.ok) {
      return { ...targetCheck.error, action: 'restore', restartRequired: false };
    }

    const current = path.join(resourcesDir, 'app.asar');
    const backup = path.join(resourcesDir, 'app.asar.bak');
    if (!fs.existsSync(current)) return fail('NOT_INSTALLED', '未找到客户端 app.asar。', { restartRequired: false });
    if (!upstream.isLocalizedAsar(current)) return fail('NOT_LOCALIZED', '当前客户端不是本方案的汉化状态，未作改动。', { restartRequired: false });
    if (!fs.existsSync(backup)) return fail('NO_BACKUP', '找不到原版 app.asar.bak，未作改动。', { restartRequired: false });
    if (upstream.isLocalizedAsar(backup)) return fail('BACKUP_NOT_ORIGINAL', '备份也包含汉化特征，拒绝用它恢复。', { restartRequired: false });

    const currentVersion = readAsarPackageVersion(current);
    const backupVersion = readAsarPackageVersion(backup);
    if (!currentVersion || currentVersion !== backupVersion) {
      return fail('BACKUP_VERSION_MISMATCH', `当前版本 ${currentVersion || '未知'} 与备份 ${backupVersion || '未知'} 不一致，拒绝恢复。`, { restartRequired: false });
    }
    if (await isAppRunning()) {
      return fail('APP_RUNNING', 'Antigravity 正在运行。请先手动 Cmd+Q 完全退出，再恢复英文；本工具不会强杀进程。', { restartRequired: false });
    }

    const stage = path.join(resourcesDir, `.app.asar.en-${process.pid}-${crypto.randomBytes(6).toString('hex')}.stage`);
    const safetyCopy = path.join(resourcesDir, `app.asar.zh-cn.${currentVersion}.backup`);
    try {
      if (!fs.existsSync(safetyCopy)) await fsp.copyFile(current, safetyCopy);
      await fsp.copyFile(backup, stage);
      if (await hashFile(stage) !== await hashFile(backup)) throw new Error('恢复文件 SHA256 校验失败');
      if (readAsarPackageVersion(stage) !== currentVersion) throw new Error('恢复前版本复核失败');
      if (readAsarPackageVersion(current) !== currentVersion || !upstream.isLocalizedAsar(current)) throw new Error('当前客户端在恢复期间发生变化');
      await fsp.rename(stage, current);
      rotateArchivedBackups(resourcesDir, 2);
      return {
        success: true,
        action: 'restore',
        code: 'RESTORED_ENGLISH',
        appVersion: currentVersion,
        backupPath: backup,
        localizedSafetyCopy: safetyCopy,
        restartRequired: true,
        message: '已原子恢复原版英文文件，请手动重新打开 Antigravity。'
      };
    } catch (error) {
      try { if (fs.existsSync(stage)) await fsp.unlink(stage); } catch (_) {}
      return fail('RESTORE_FAILED', error.message, { restartRequired: false });
    }
  }

  return { status, install, restore, verifyPayload, rotateArchivedBackups };
}

if (require.main === module) {
  const action = process.argv[2];
  const forceFlag = process.argv.includes('--force');
  if (!['status', 'install', 'upgrade', 'restore'].includes(action)) {
    console.error('Usage: antigravity_locale.js status|install [--force]|upgrade|restore');
    process.exit(2);
  }
  (async () => {
    try {
      const mgr = createLocaleManager();
      const result =
        action === 'status' ? await mgr.status() :
        action === 'install' ? await mgr.install(forceFlag) :
        action === 'upgrade' ? await mgr.install(true) :
        await mgr.restore();
      console.log(JSON.stringify(result, null, 2));
      if (!result.success) process.exitCode = 1;
    } catch (error) {
      console.log(JSON.stringify(fail('UNEXPECTED_ERROR', error.message, { action }), null, 2));
      process.exitCode = 1;
    }
  })();
}

module.exports = {
  createLocaleManager,
  hashFile,
  rotateArchivedBackups
};
