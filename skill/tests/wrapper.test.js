'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const upstream = require('../vendor/auto-restore');
const { readAsarPackageVersion } = require('../vendor/asar-version');
const { createLocaleManager } = require('../scripts/antigravity_locale');
const {
  parseAsar,
  readEntry,
  patchInjectionScript,
  patchMenuScript,
  patchTrayScript
} = require('../scripts/customize_patch');

const root = path.resolve(__dirname, '..');
const manifest = require('../vendor-manifest.json');
const patch = path.join(root, 'vendor', 'app.asar.ready');

function makeUntouchedEnglishCopy(srcAsar, outPath) {
  let originalText = fs.readFileSync(srcAsar, 'latin1');
  for (const marker of ['Antigravity 2.0 Chinese Localization Engine', 'menuTranslationMap', 'DOM_TRANSLATOR_INJECTION']) {
    originalText = originalText.split(marker).join('X'.repeat(marker.length));
  }
  fs.writeFileSync(outPath, Buffer.from(originalText, 'latin1'));
}

async function runTests() {
  // 1. Static manifest, ASAR metadata & entry checks
  const bytes = fs.readFileSync(patch);
  const actualSha = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.strictEqual(actualSha, manifest.sha256['app.asar.ready']);
  assert.strictEqual(readAsarPackageVersion(patch), manifest.clientVersion);
  assert.ok(upstream.isLocalizedAsar(patch));

  const parsed = parseAsar(patch);
  assert.strictEqual(parsed.tree.files.node_modules.files['js-yaml'].files.bin.files['js-yaml.js'].executable, true);
  assert.strictEqual(parsed.tree.files.node_modules.files.semver.files.bin.files['semver.js'].executable, true);

  const preloadSrc = readEntry(patch, parsed.dataOffset, parsed.tree, 'dist/preload.js');
  const menuSrc = readEntry(patch, parsed.dataOffset, parsed.tree, 'dist/menu.js');
  const traySrc = readEntry(patch, parsed.dataOffset, parsed.tree, 'dist/tray.js');

  // 2. Patcher idempotency check
  assert.strictEqual(patchInjectionScript(preloadSrc), preloadSrc);
  assert.strictEqual(patchMenuScript(menuSrc), menuSrc);
  assert.strictEqual(patchTrayScript(traySrc), traySrc);
  assert.strictEqual(
    (menuSrc.match(/if \(typeof translateMenu === 'function'\) \{ menu\.items\.forEach\(translateMenu\); \}/g) || []).length,
    2
  );

  // 3. Temp sandbox tests (properly awaited)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '.tmp-antigravity-skill-test-'));
  try {
    const missingApp = path.join(dir, 'Missing.app');
    const missingMgr = createLocaleManager({
      appDir: missingApp,
      isAppRunning: () => false,
      strictProdPath: false
    });
    const missingStatus = await missingMgr.status();
    assert.strictEqual(missingStatus.success, false);
    assert.strictEqual(missingStatus.code, 'NOT_INSTALLED');
    assert.strictEqual(missingStatus.restartRequired, false);

    const appDir = path.join(dir, 'Antigravity.app');
    const resources = path.join(appDir, 'Contents', 'Resources');
    fs.mkdirSync(resources, { recursive: true });
    fs.writeFileSync(path.join(dir, 'running'), 'yes');
    const running = () => fs.existsSync(path.join(dir, 'running'));
    const upstreamOpts = {
      appDir,
      getResourcesDir: () => resources,
      workspaceDir: path.join(root, 'vendor'),
      isAppRunning: running,
      forceStop: false
    };

    // Upstream guard checks
    fs.writeFileSync(path.join(resources, 'app.asar'), 'official-version-unknown-test-placeholder');
    const mismatch = await upstream.executeAutoRestore({ ...upstreamOpts, candidatePatch: { path: patch } });
    assert.strictEqual(mismatch.code, 'VERSION_UNKNOWN');

    fs.copyFileSync(patch, path.join(resources, 'app.asar'));
    const already = await upstream.executeAutoRestore(upstreamOpts);
    assert.strictEqual(already.code, 'ALREADY_LOCALIZED');

    const englishAsar = path.join(dir, 'english.asar');
    makeUntouchedEnglishCopy(patch, englishAsar);
    fs.copyFileSync(englishAsar, path.join(resources, 'app.asar'));

    const beforeBlocked = fs.readFileSync(path.join(resources, 'app.asar'));
    const blocked = await upstream.executeAutoRestore(upstreamOpts);
    assert.strictEqual(blocked.code, 'APP_RUNNING');
    assert.ok(beforeBlocked.equals(fs.readFileSync(path.join(resources, 'app.asar'))));
    assert.ok(!fs.existsSync(path.join(resources, 'app.asar.bak')));

    // Wrapper full lifecycle when stopped
    fs.unlinkSync(path.join(dir, 'running'));
    const mgr = createLocaleManager({
      appDir,
      isAppRunning: running,
      strictProdPath: false
    });

    const preStatus = await mgr.status();
    assert.strictEqual(preStatus.success, true);
    assert.strictEqual(preStatus.restartRequired, false);
    assert.strictEqual(preStatus.statusSummary, 'READY_TO_INSTALL');

    const installed = await mgr.install(false);
    assert.strictEqual(installed.success, true);
    assert.strictEqual(installed.restartRequired, true);
    assert.ok(fs.existsSync(path.join(resources, 'app.asar.bak')));

    const postStatus = await mgr.status();
    assert.strictEqual(postStatus.success, true);
    assert.strictEqual(postStatus.restartRequired, false);
    assert.strictEqual(postStatus.patchUpToDate, true);
    assert.strictEqual(postStatus.statusSummary, 'LATEST_CUSTOMIZED');

    // Simulate older localized patch -> PATCH_UPDATE_AVAILABLE -> upgrade
    const olderPatchBuf = Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from([bytes[bytes.length - 1] ^ 0x20])]);
    fs.writeFileSync(path.join(resources, 'app.asar'), olderPatchBuf);
    const updateNeeded = await mgr.install(false);
    assert.strictEqual(updateNeeded.success, true);
    assert.strictEqual(updateNeeded.code, 'PATCH_UPDATE_AVAILABLE');
    assert.strictEqual(updateNeeded.patchUpToDate, false);

    // Upgrade blocked while running
    fs.writeFileSync(path.join(dir, 'running'), 'yes');
    const upgradeBlocked = await mgr.install(true);
    assert.strictEqual(upgradeBlocked.success, false);
    assert.strictEqual(upgradeBlocked.code, 'APP_RUNNING');
    fs.unlinkSync(path.join(dir, 'running'));

    // Upgrade succeeds when stopped
    const upgraded = await mgr.install(true);
    assert.strictEqual(upgraded.success, true);
    assert.strictEqual(upgraded.code, 'UPGRADED');
    assert.strictEqual(upgraded.patchUpToDate, true);
    assert.strictEqual(upgraded.restartRequired, true);

    // Seed stale archived backups to verify rotation keeps <= 2
    for (let i = 1; i <= 3; i++) {
      const staleFile = path.join(resources, `app.asar.bak.2.31.${i}`);
      fs.writeFileSync(staleFile, `stale-${i}`);
      const t = new Date(Date.now() - (4 - i) * 60000);
      fs.utimesSync(staleFile, t, t);
    }

    // Restore back to original English
    const restored = await mgr.restore();
    assert.strictEqual(restored.success, true);
    assert.strictEqual(restored.code, 'RESTORED_ENGLISH');
    assert.strictEqual(restored.restartRequired, true);
    assert.ok(!upstream.isLocalizedAsar(path.join(resources, 'app.asar')));
    assert.ok(fs.readFileSync(path.join(resources, 'app.asar')).equals(fs.readFileSync(englishAsar)));

    const archivedAfterRestore = fs.readdirSync(resources).filter((n) => /^app\.asar\.(?:bak\.[^.]+\.\d+|zh-cn\.[^.]+\.backup)$/.test(n));
    assert.ok(archivedAfterRestore.length <= 2, `Expected <= 2 archived backups, got ${archivedAfterRestore.length}`);

    // CLI argument validation
    const invalid = spawnSync(process.execPath, [path.join(root, 'scripts', 'antigravity_locale.js'), 'unknown'], { encoding: 'utf8' });
    assert.strictEqual(invalid.status, 2);

    console.log('PASS: payload/executable/idempotency, DOM/model assertions, lifecycle (install/PATCH_UPDATE_AVAILABLE/upgrade/restore/rotation), APP_RUNNING/NOT_INSTALLED guards, invalid CLI');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
