#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { readAsarPackageVersion } = require('../vendor/asar-version');
const { isLocalizedAsar } = require('../vendor/auto-restore');

const ROOT = path.resolve(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor');
const ASAR_PATH = path.join(VENDOR, 'app.asar.ready');
const MANIFEST_PATH = path.join(ROOT, 'vendor-manifest.json');

const BLOCK_SIZE = 4 * 1024 * 1024;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readExactly(fd, size, position) {
  const buf = Buffer.alloc(size);
  let received = 0;
  while (received < size) {
    const count = fs.readSync(fd, buf, received, size - received, position + received);
    if (count === 0) {
      throw new Error(`Unexpected EOF while reading ASAR (${received}/${size} bytes at offset ${position})`);
    }
    received += count;
  }
  return buf;
}

function computeIntegrity(buf) {
  const blocks = [];
  for (let offset = 0; offset < buf.length; offset += BLOCK_SIZE) {
    blocks.push(sha256(buf.subarray(offset, Math.min(offset + BLOCK_SIZE, buf.length))));
  }
  if (blocks.length === 0) {
    blocks.push(sha256(Buffer.alloc(0)));
  }
  return {
    algorithm: 'SHA256',
    hash: sha256(buf),
    blockSize: BLOCK_SIZE,
    blocks
  };
}

function parseAsar(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const prefix = readExactly(fd, 8, 0);
    if (prefix.readUInt32LE(0) !== 4) throw new Error('Invalid ASAR header prefix');
    const headerSize = prefix.readUInt32LE(4);
    const headerBuf = readExactly(fd, headerSize, 8);
    const jsonSize = headerBuf.readInt32LE(4);
    const tree = JSON.parse(headerBuf.subarray(8, 8 + jsonSize).toString('utf8'));
    const dataOffset = 8 + headerSize;
    return { tree, dataOffset };
  } finally {
    fs.closeSync(fd);
  }
}

function isExpectedExecutable(entryPath) {
  return (
    /(?:^|\/)node_modules\/\.bin\//.test(entryPath) ||
    /(?:^|\/)node_modules\/(?:js-yaml|semver)\/bin\/[^/]+\.js$/.test(entryPath)
  );
}

function buildAsar(srcAsarPath, tree, dataOffset, overrides, outPath) {
  const srcFd = fs.openSync(srcAsarPath, 'r');
  const chunks = [];
  const dedupMap = new Map();
  let currentOffset = 0;

  try {
    function cloneAndCollect(node, curPath) {
      if (node.files) {
        const files = {};
        for (const key of Object.keys(node.files)) {
          files[key] = cloneAndCollect(node.files[key], curPath ? curPath + '/' + key : key);
        }
        return { files };
      }

      const copy = { ...node };
      if (copy.link !== undefined || copy.unpacked === true) {
        return copy;
      }

      if (isExpectedExecutable(curPath)) {
        copy.executable = true;
      }

      let buf;
      if (Object.prototype.hasOwnProperty.call(overrides, curPath)) {
        buf = overrides[curPath];
        copy.integrity = computeIntegrity(buf);
      } else {
        buf = node.size > 0 ? readExactly(srcFd, node.size, dataOffset + Number(node.offset)) : Buffer.alloc(0);
      }

      const contentKey = (copy.integrity && copy.integrity.hash ? copy.integrity.hash : sha256(buf)) + (copy.executable ? ':x' : '');
      if (dedupMap.has(contentKey)) {
        const existing = dedupMap.get(contentKey);
        copy.size = existing.size;
        copy.offset = existing.offset;
      } else {
        copy.size = buf.length;
        copy.offset = String(currentOffset);
        dedupMap.set(contentKey, { size: copy.size, offset: copy.offset });
        currentOffset += buf.length;
        chunks.push(buf);
      }

      return copy;
    }

    const newTree = cloneAndCollect(tree, '');
    const jsonBuf = Buffer.from(JSON.stringify(newTree), 'utf8');
    const paddedJsonLen = Math.ceil(jsonBuf.length / 4) * 4;
    const headerSize = 8 + paddedJsonLen;

    const prefix = Buffer.alloc(8);
    prefix.writeUInt32LE(4, 0);
    prefix.writeUInt32LE(headerSize, 4);

    const headerBuf = Buffer.alloc(headerSize, 0);
    headerBuf.writeUInt32LE(headerSize - 4, 0);
    headerBuf.writeInt32LE(jsonBuf.length, 4);
    jsonBuf.copy(headerBuf, 8);

    const outFd = fs.openSync(outPath, 'w');
    try {
      fs.writeSync(outFd, prefix);
      fs.writeSync(outFd, headerBuf);
      for (const chunk of chunks) {
        if (chunk.length > 0) fs.writeSync(outFd, chunk);
      }
    } finally {
      fs.closeSync(outFd);
    }
  } finally {
    fs.closeSync(srcFd);
  }
}

function stripBetweenMarkers(text, startMarker, endMarker) {
  const escapedStart = startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`[\\r\\n]*[ \\t]*${escapedStart}[\\s\\S]*?${escapedEnd}[ \\t]*`, 'g');
  return text.replace(re, '');
}

function patchInjectionScript(sourceText) {
  const marker = '// Antigravity 2.0 Chinese Localization Engine Enhanced';
  const markerIdx = sourceText.indexOf(marker);
  if (markerIdx === -1) {
    throw new Error('Could not find Chinese Localization Engine marker');
  }

  const head = sourceText.slice(0, markerIdx);
  let body = sourceText.slice(markerIdx);

  // Clean up both legacy single-marker blocks (round 1) and paired START/END blocks
  body = stripBetweenMarkers(body, '// ===== CUSTOM SIDEBAR DICT START =====', '// ===== CUSTOM SIDEBAR DICT END =====');
  body = stripBetweenMarkers(body, '// ===== CUSTOM MODEL GUARD START =====', '// ===== CUSTOM MODEL GUARD END =====');
  body = stripBetweenMarkers(body, '// ===== CUSTOM CHINGLISH GUARD START =====', '// ===== CUSTOM CHINGLISH GUARD END =====');

  // Legacy round-1 sidebar dict block cleanup
  const legacySidebarIdx = body.indexOf('\n    // ===== Custom Sidebar UI Localization =====');
  if (legacySidebarIdx !== -1) {
    const legacyEnd = body.indexOf('\n  };\n\n  const coreWords = {', legacySidebarIdx);
    if (legacyEnd !== -1) {
      body = body.slice(0, legacySidebarIdx) + body.slice(legacyEnd);
    }
  }

  // Legacy round-1 model guard block cleanup
  const legacyGuardAnchor = '    // ===== Custom Model English Guard & Sidebar Relative Time =====';
  const legacyGuardIdx = body.indexOf('\n\n' + legacyGuardAnchor);
  if (legacyGuardIdx !== -1) {
    const legacyGuardReturnAnchor = "      return text.replace(trimmed, fixed);\n    }";
    const relEnd = body.indexOf(legacyGuardReturnAnchor, legacyGuardIdx);
    if (relEnd !== -1) {
      body = body.slice(0, legacyGuardIdx) + body.slice(relEnd + legacyGuardReturnAnchor.length);
    }
  }

  // 1. Remove model name & tier entries from dictionary so models stay English
  const removeKeys = [
    'High',
    'Medium',
    'Low',
    'Fast',
    'Thinking',
    'thinking',
    'Gemini 3.8 Flash High',
    'Gemini 3.7 Flash Medium',
    'Gemini 3.6 Flash Low',
    'Gemini 3.1 Pro Low',
    'Claude Sonnet 4.6 (Thinking)',
    'Claude Opus 4.6 (Thinking)',
    'GPT-OSS 120B (Medium)'
  ];

  for (const key of removeKeys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lineRe = new RegExp(`^[ \\t]*"${escaped}"\\s*:\\s*"[^"]*",?[ \\t]*\\r?\\n`, 'gm');
    body = body.replace(lineRe, '');
  }

  // 2. Remove model/models from coreWords fallback (explicit dictionary phrases remain translated)
  body = body.replace(/"model":\s*"模型",\s*"models":\s*"模型",\s*/g, '');

  // 3. Inject custom sidebar & outer-chrome dictionary block
  const sidebarEntries = [
    '    // ===== CUSTOM SIDEBAR DICT START =====',
    '    "Inbox": "收件箱",',
    '    "Playground": "演练场",',
    '    "Today": "今天",',
    '    "Yesterday": "昨天",',
    '    "This Week": "本周",',
    '    "This Month": "本月",',
    '    "Older": "更早",',
    '    "Earlier": "更早",',
    '    "Recent": "最近",',
    '    "Recents": "最近",',
    '    "No Workspace": "无工作区",',
    '    "No workspace": "无工作区",',
    '    "Delete": "删除",',
    '    "Follow-ups": "后续跟进",',
    '    "Follow ups": "后续跟进",',
    '    "Needs Attention": "需要关注",',
    '    "Needs attention": "需要关注",',
    '    "My Workspaces": "我的工作区",',
    '    "Agent Manager": "智能体管理器",',
    '    "Start a new conversation": "开始新对话",',
    '    "Just now": "刚刚",',
    '    "just now": "刚刚",',
    '    "New Chat": "新建对话",',
    '    "New Session": "新建会话",',
    '    "No Conversations": "暂无对话",',
    '    "No conversations": "暂无对话",',
    '    "Load more": "加载更多",',
    '    "Show less": "收起",',
    '    "Starred": "已标星",',
    '    "Open in Editor": "在编辑器中打开",',
    '    "Remove Workspace": "移除工作区",',
    '    "Leave Workspace": "离开工作区",',
    '    "Collapse sidebar": "折叠侧边栏",',
    '    "Expand sidebar": "展开侧边栏",',
    '    "Model parameters": "模型参数",',
    '    "Model capabilities": "模型能力",',
    '    "Model speed": "模型速度",',
    '    "Reasoning effort": "推理强度",',
    '    "Reasoning Effort": "推理强度",',
    '    "Thinking effort": "思考强度",',
    '    "Thinking Effort": "思考强度",',
    '    "Effort": "推理强度",',
    '    "Rate limit": "速率限制",',
    '    "Installing update": "正在安装更新",',
    '    "Update ready": "更新已就绪",',
    '    "Experimental": "实验性",',
    '    "Legacy": "旧版",',
    '    "Check now": "立即检查",',
    '    "Privacy": "隐私",',
    '    "About": "关于",',
    '    "Features": "功能特性",',
    '    // ===== CUSTOM SIDEBAR DICT END ====='
  ].join('\n');

  const dictEndAnchor = '\n  };\n\n  const coreWords = {';
  const dictIdx = body.indexOf(dictEndAnchor);
  if (dictIdx === -1) {
    throw new Error('Could not find end of dictionary block');
  }
  body = body.slice(0, dictIdx) + '\n' + sidebarEntries + body.slice(dictIdx);

  // 4. Add FIFO cacheSet helper & rewrite bounded stringCache writes
  if (!body.includes('function cacheSet(key, val)')) {
    body = body.replace(
      'const MAX_STRING_CACHE = 5000;',
      [
        'const MAX_STRING_CACHE = 5000;',
        '  function cacheSet(key, val) {',
        '    if (stringCache.size >= MAX_STRING_CACHE) {',
        '      stringCache.delete(stringCache.keys().next().value);',
        '    }',
        '    stringCache.set(key, val);',
        '  }'
      ].join('\n')
    );
  }
  body = body.replace(
    /if\s*\(\s*stringCache\.size\s*<\s*MAX_STRING_CACHE\s*\)\s*\{\s*\r?\n\s*stringCache\.set\(([^)]+)\);\s*\r?\n\s*\}/g,
    'cacheSet($1);'
  );
  body = body.replace(/if\s*\(\s*stringCache\.size\s*<\s*MAX_STRING_CACHE\s*\)\s*stringCache\.set\(/g, 'cacheSet(');

  // Cache stripped-punctuation dictionary matches too
  body = body.replace(
    /if\s*\(\s*coreTranslated\s*\)\s*\{\s*\r?\n\s*return text\.replace\(trimmed,\s*coreTranslated \+ trailPunc\);\s*\r?\n\s*\}/,
    [
      'if (coreTranslated) {',
      '      const fullFixed = coreTranslated + trailPunc;',
      '      cacheSet(trimmed, fullFixed);',
      '      return text.replace(trimmed, fullFixed);',
      '    }'
    ].join('\n')
  );

  // 5. Fix upstream Quote shortcut regex missing backslashes (`\s+` and `\+`)
  body = body.replace(
    /\/\^Quote\(\?:s\+\(Ctrl\+\[a-zA-Z0-9\]\+\|Cmd\+\[a-zA-Z0-9\]\+\)\)\?\$\/i/g,
    '/^Quote(?:\\s+(Ctrl\\+[a-zA-Z0-9]+|Cmd\\+[a-zA-Z0-9]+))?$/i'
  );

  // 6. Inject comprehensive Model English Guard + Prefix Model Handlers + Full Relative Time (including years)
  const cacheAnchor = '    if (stringCache.has(trimmed)) {\n      return text.replace(trimmed, stringCache.get(trimmed));\n    }';
  const anchorIdx = body.indexOf(cacheAnchor);
  if (anchorIdx === -1) {
    throw new Error('Could not find stringCache anchor in translateString');
  }

  const guardSnippet = `

    // ===== CUSTOM MODEL GUARD START =====
    if (/^\\(?\\s*(?:High|Medium|Low|Minimal|Thinking|Fast|Flash|Flash Lite|Pro|Ultra|Max|Nano|XHigh)\\s*\\)?$/i.test(trimmed)) {
      return text;
    }
    if (
      /^(?:(?:Gemini|Claude|GPT|Gemma|Qwen|DeepSeek|Llama|Mistral|Orchestrator|Argon|Hydrogen)(?:[-\\s]+[-A-Za-z0-9._/]+)*|(?:o1|o3|o4)(?:-[A-Za-z0-9._]+)*|(?:Sonnet|Opus|Haiku)(?:\\s+[0-9]+(?:\\.[0-9]+)*)?)(?:\\s*\\([^()]{1,32}\\))*$/i.test(trimmed) &&
      !/\\b(?:models?|using|Enterprise|Interactions|Live|API|App|parameters?|capabilities|speed)\\b/i.test(trimmed)
    ) {
      return text;
    }
    if (/^Current model:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Current model:\\s*(.+)$/i, '当前模型: $1');
      cacheSet(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }
    if (/^Model:\\s*(.+)$/i.test(trimmed)) {
      const fixed = trimmed.replace(/^Model:\\s*(.+)$/i, '模型: $1');
      cacheSet(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }
    const relTimeMatch = trimmed.match(/^(\\d+)\\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|y|yr|yrs|year|years)\\s+ago$/i);
    if (relTimeMatch) {
      const n = relTimeMatch[1];
      const u = relTimeMatch[2].toLowerCase();
      const unitLabel =
        u.startsWith('mo') ? '个月前' :
        u.startsWith('y') ? '年前' :
        u.startsWith('w') ? '周前' :
        u.startsWith('d') ? '天前' :
        u.startsWith('h') ? '小时前' :
        u.startsWith('m') ? '分钟前' : '秒前';
      const fixed = n + ' ' + unitLabel;
      cacheSet(trimmed, fixed);
      return text.replace(trimmed, fixed);
    }
    // ===== CUSTOM MODEL GUARD END =====`;

  const insertPos = anchorIdx + cacheAnchor.length;
  body = body.slice(0, insertPos) + guardSnippet + body.slice(insertPos);

  // 7. Reject partial Chinglish output from `coreWords` (e.g. `"Fix login error"` -> `"Fix login 错误"` -> revert to `"Fix login error"`)
  const endMarkerAnchor = '    if (matchPunc) {\n      finalTranslated += trailPunc;\n    }';
  const endMarkerIdx = body.indexOf(endMarkerAnchor);
  if (endMarkerIdx === -1) {
    throw new Error('Could not find matchPunc anchor in translateString');
  }
  const chinglishGuard = `// ===== CUSTOM CHINGLISH GUARD START =====
    if (
      wordsCount >= 2 &&
      /[\\u4e00-\\u9fa5]/.test(finalTranslated) &&
      /[A-Za-z]{2,}/.test(finalTranslated.replace(/\\b(?:WSL|API|MCP|URL|UI|JSON|HTML|PDF|Git|SSH|ID|QR|plan)\\b/gi, ''))
    ) {
      return text;
    }
    // ===== CUSTOM CHINGLISH GUARD END =====
`;
  body = body.slice(0, endMarkerIdx) + chinglishGuard + body.slice(endMarkerIdx);

  // 8. Runtime DOM engine fixes (P0 skipCache invalidation, P0 batch queue re-schedule, innerText->textContent, duplicate attr pass, tryCombined early return, characterData self-write filter)
  body = body.replace('const skipCache = new WeakMap();', 'let skipCache = new WeakMap();\n  const lastTranslatedValue = new WeakMap();');
  body = body.replace(/isMenuOptionLabel\.innerText\s*\|\|\s*isMenuOptionLabel\.textContent/g, 'isMenuOptionLabel.textContent');
  body = body.replace(/element\.innerText\s*\|\|\s*element\.textContent/g, 'element.textContent');

  // Record lastTranslatedValue on text writes
  body = body.replace(
    'node.nodeValue = translated;\n        translatedNodes.add(node);',
    'node.nodeValue = translated;\n        lastTranslatedValue.set(node, translated);\n        translatedNodes.add(node);'
  );
  body = body.replace(
    'node.nodeValue = translated;\n                translatedNodes.add(node);',
    'node.nodeValue = translated;\n                lastTranslatedValue.set(node, translated);\n                translatedNodes.add(node);'
  );

  // Avoid duplicate translation of placeholder/title/aria-label after shouldSkipNode (lines 7309 already handled them)
  body = body.replace(
    "} else if (node.nodeType === Node.ELEMENT_NODE) {\n      ['placeholder', 'title', 'aria-label', 'value'].forEach(attr => {",
    "} else if (node.nodeType === Node.ELEMENT_NODE) {\n      ['value'].forEach(attr => {"
  );

  // Early exit after tryCombinedSentenceTranslation succeeds
  body = body.replace(
    '      tryCombinedSentenceTranslation(node);\n',
    '      if (tryCombinedSentenceTranslation(node)) return;\n'
  );

  // Reset dynamic skipCache per batch / scan & reschedule when busy
  body = body.replace(
    '  function processBatchTranslation() {\n    batchRafHandle = null;\n    if (isTranslating) return;\n    isTranslating = true;',
    '  function processBatchTranslation() {\n    batchRafHandle = null;\n    if (isTranslating) {\n      setTimeout(scheduleBatchTranslation, 16);\n      return;\n    }\n    isTranslating = true;\n    skipCache = new WeakMap();'
  );

  body = body.replace(
    "        } else if (mutation.type === 'characterData') {\n          translatedNodes.delete(mutation.target);",
    "        } else if (mutation.type === 'characterData') {\n          if (lastTranslatedValue.get(mutation.target) === mutation.target.nodeValue) continue;\n          translatedNodes.delete(mutation.target);"
  );

  body = body.replace(
    '  function safeScan() {\n    if (document.body) {',
    '  function safeScan() {\n    skipCache = new WeakMap();\n    if (document.body) {'
  );

  const result = head + body;

  // Syntax & runtime behavior check
  new vm.Script(result);
  verifyInjectionBehavior(body);

  return result;
}

function patchMenuScript(sourceText) {
  let text = sourceText;
  // Deduplicate 6x repeated translateMenu invocation inserted upstream
  const dupCall = "if (typeof translateMenu === 'function') { menu.items.forEach(translateMenu); }";
  const repeatedRe = /(?:if \(typeof translateMenu === 'function'\) \{ menu\.items\.forEach\(translateMenu\); \}\s*){2,}/g;
  text = text.replace(repeatedRe, dupCall + ' ');

  text = stripBetweenMarkers(text, '// ===== CUSTOM MENU START =====', '// ===== CUSTOM MENU END =====');

  const anchor = "\n  'Ask /btw': '通过 /btw 提问',\n};";
  const idx = text.indexOf(anchor);
  if (idx !== -1) {
    const customMenuEntries = [
      "  'Ask /btw': '通过 /btw 提问',",
      '  // ===== CUSTOM MENU START =====',
      "  'Settings...': '设置...',",
      "  'Preferences...': '偏好设置...',",
      "  'Bring All to Front': '前置全部窗口',",
      "  'Zoom': '缩放',",
      "  'Close Window': '关闭窗口',",
      "  'Report Issue': '反馈问题',",
      "  'Speech': '语音',",
      "  'Start Speaking': '开始朗读',",
      "  'Stop Speaking': '停止朗读',",
      '  // ===== CUSTOM MENU END =====',
      '};'
    ].join('\n');
    text = text.slice(0, idx + 1) + customMenuEntries + text.slice(idx + anchor.length);
  }

  new vm.Script(text);
  return text;
}

function patchTrayScript(sourceText) {
  let text = sourceText;
  text = stripBetweenMarkers(text, '// ===== CUSTOM TRAY START =====', '// ===== CUSTOM TRAY END =====');
  const target = "if (action.label === 'No agents running') action.label = '没有智能体在运行';";
  if (text.includes(target)) {
    const replacement = [
      target,
      '        // ===== CUSTOM TRAY START =====',
      "        if (action.label && /^\\d+\\s+agents?\\s+running$/i.test(action.label)) action.label = action.label.replace(/^(\\d+)\\s+agents?\\s+running$/i, '$1 个智能体运行中');",
      '        // ===== CUSTOM TRAY END ====='
    ].join('\n');
    text = text.replace(target, replacement);
  }
  new vm.Script(text);
  return text;
}

function createDomSandbox(injectionCode, mockDocument) {
  const readyMarker = "if (document.readyState === 'loading') {";
  const readyIdx = injectionCode.indexOf(readyMarker);
  if (readyIdx === -1) {
    throw new Error('Could not find DOMContentLoaded bootstrap block');
  }
  const wrapped =
    injectionCode.slice(0, readyIdx) +
    'globalThis.__testExports = { translateString, translateNode, shouldSkipNode, tryCombinedSentenceTranslation, processBatchTranslation, scheduleBatchTranslation, getStringCacheSize: () => stringCache.size };\n})();';
  const sandbox = {
    globalThis: {},
    document: mockDocument || { readyState: 'complete', addEventListener() {}, body: null },
    window: { addEventListener() {} },
    history: { pushState() {}, replaceState() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout(fn) {
      if (sandbox.__capturedTimeouts) sandbox.__capturedTimeouts.push(fn);
    },
    queueMicrotask(fn) {
      if (sandbox.__capturedMicrotasks) sandbox.__capturedMicrotasks.push(fn);
    },
    Element: { prototype: { attachShadow() {} } },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_FRAGMENT_NODE: 11 },
    WeakMap,
    WeakSet,
    Map,
    Set,
    RegExp,
    console
  };
  vm.runInNewContext(wrapped, sandbox);
  if (!sandbox.globalThis.__testExports || typeof sandbox.globalThis.__testExports.translateString !== 'function') {
    throw new Error('Failed to extract translateString for verification');
  }
  return sandbox;
}

function verifyInjectionBehavior(injectionCode) {
  const sandbox = createDomSandbox(injectionCode);
  const { translateString: ts, getStringCacheSize } = sandbox.globalThis.__testExports;

  const assertions = [
    // Models & tiers MUST remain full English
    ['Gemini 4 Hydrogen (High)', 'Gemini 4 Hydrogen (High)'],
    ['Orchestrator (Argon)', 'Orchestrator (Argon)'],
    ['Gemini 3.8 Flash (High)', 'Gemini 3.8 Flash (High)'],
    ['Gemini 3.8 Flash High', 'Gemini 3.8 Flash High'],
    ['Gemini 3.7 Flash Medium', 'Gemini 3.7 Flash Medium'],
    ['Gemini 3.6 Flash Low', 'Gemini 3.6 Flash Low'],
    ['Gemini 3.1 Pro Low', 'Gemini 3.1 Pro Low'],
    ['Claude Sonnet 4.6 (Thinking)', 'Claude Sonnet 4.6 (Thinking)'],
    ['Claude Opus 4.6 (Thinking)', 'Claude Opus 4.6 (Thinking)'],
    ['Claude Sonnet 4.6 (Thinking) (High)', 'Claude Sonnet 4.6 (Thinking) (High)'],
    ['Gemini 4 Hydrogen (High) (Recommended)', 'Gemini 4 Hydrogen (High) (Recommended)'],
    ['GPT-OSS 120B (Medium)', 'GPT-OSS 120B (Medium)'],
    ['GPT-4o', 'GPT-4o'],
    ['GPT-4o mini', 'GPT-4o mini'],
    ['DeepSeek-V3', 'DeepSeek-V3'],
    ['DeepSeek-R1', 'DeepSeek-R1'],
    ['o1', 'o1'],
    ['o3-mini', 'o3-mini'],
    ['o3-mini (High)', 'o3-mini (High)'],
    ['High', 'High'],
    ['Medium', 'Medium'],
    ['Low', 'Low'],
    ['XHigh', 'XHigh'],
    ['(High)', '(High)'],
    ['Thinking', 'Thinking'],
    ['Fast', 'Fast'],
    ['Select model, current: Gemini 4 Hydrogen (High)', '选择模型，当前为: Gemini 4 Hydrogen (High)'],
    ['Current model: Gemini 4 Hydrogen (High)', '当前模型: Gemini 4 Hydrogen (High)'],
    ['Model: Claude Opus 4.6 (Thinking)', '模型: Claude Opus 4.6 (Thinking)'],
    // Outer model menus & settings remain Chinese
    ['Model Selection', '模型选择'],
    ['Model parameters', '模型参数'],
    ['Reasoning effort', '推理强度'],
    ['Gemini models', 'Gemini 模型'],
    ['Claude and GPT models', 'Claude 与 GPT 模型'],
    // Thinking & Quote shortcuts fixed
    ['Thinking...', '思考中...'],
    ['Thought for 4s', '思考了 4s'],
    ['Quote', '引用'],
    ['Quote Cmd+L', '引用 Cmd+L'],
    ['Quote Ctrl+L', '引用 Ctrl+L'],
    // Sidebar UI items localized
    ['Inbox', '收件箱'],
    ['Playground', '演练场'],
    ['Today', '今天'],
    ['Yesterday', '昨天'],
    ['This Week', '本周'],
    ['This Month', '本月'],
    ['Older', '更早'],
    ['Earlier', '更早'],
    ['Recent', '最近'],
    ['Recents', '最近'],
    ['No Workspace', '无工作区'],
    ['Follow-ups', '后续跟进'],
    ['Needs Attention', '需要关注'],
    ['Agent Manager', '智能体管理器'],
    ['Start a new conversation', '开始新对话'],
    ['New Chat', '新建对话'],
    ['Collapse sidebar', '折叠侧边栏'],
    ['Just now', '刚刚'],
    ['5 minutes ago', '5 分钟前'],
    ['2 hours ago', '2 小时前'],
    ['3 days ago', '3 天前'],
    ['2 weeks ago', '2 周前'],
    ['1 month ago', '1 个月前'],
    ['1 year ago', '1 年前'],
    ['2 years ago', '2 年前'],
    // Partial Chinglish guard: 2-3 word English phrases that cannot fully translate stay clean English
    ['Fix login error', 'Fix login error'],
    ['Build model server', 'Build model server'],
    ['Run tests', 'Run tests'],
    ['Failed to start', 'Failed to start'],
    ['Install CodeRabbit', '安装 CodeRabbit'],
    // Punctuation-stripped dictionary lookup
    ['Cancel...', '取消...']
  ];

  for (const [input, expected] of assertions) {
    const actual = ts(input);
    if (actual !== expected) {
      throw new Error(`Verification failed for ${JSON.stringify(input)}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  // FIFO cache eviction check (> 5000 unique strings should keep size capped cleanly)
  for (let i = 0; i < 5100; i++) {
    ts(`ZzzCustomBench_${i} placeholder`);
  }
  if (getStringCacheSize() > 5000) {
    throw new Error(`stringCache exceeded MAX_STRING_CACHE: ${getStringCacheSize()}`);
  }

  // Runtime DOM state transition test: skipCache resets when class leaves thinking-content
  const bodyNode = { nodeType: 1, tagName: 'BODY', classList: { contains: () => false }, parentElement: null };
  const classSet = new Set(['thinking-content']);
  const parentEl = {
    nodeType: 1,
    tagName: 'DIV',
    parentElement: bodyNode,
    classList: { contains: (c) => classSet.has(c) },
    getAttribute: () => null,
    hasAttribute: () => false
  };
  const textNode = { nodeType: 3, parentElement: parentEl, nodeValue: 'Inbox' };
  const domSandbox = createDomSandbox(injectionCode, { readyState: 'complete', addEventListener() {}, body: bodyNode });
  const domApi = domSandbox.globalThis.__testExports;
  domSandbox.__capturedTimeouts = [];
  domSandbox.__capturedMicrotasks = [];

  domApi.translateNode(textNode);
  if (textNode.nodeValue !== 'Inbox') {
    throw new Error('Expected node inside thinking-content to stay untranslated');
  }
  classSet.delete('thinking-content');
  domApi.processBatchTranslation();
  domApi.translateNode(textNode);
  if (textNode.nodeValue !== '收件箱') {
    throw new Error(`Expected node after leaving thinking-content to translate, got: ${textNode.nodeValue}`);
  }
}

function readEntry(asarPath, dataOffset, tree, targetPath) {
  let node = tree;
  for (const part of targetPath.split('/')) {
    node = node.files[part];
  }
  const fd = fs.openSync(asarPath, 'r');
  try {
    const buf = node.size > 0 ? readExactly(fd, node.size, dataOffset + Number(node.offset)) : Buffer.alloc(0);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function main() {
  const srcAsar = getArg('--in-asar', ASAR_PATH);
  const outAsar = getArg('--out-asar', ASAR_PATH);
  const inManifest = getArg('--in-manifest', MANIFEST_PATH);
  const outManifest = getArg('--out-manifest', inManifest);
  const allowVersionUpdate = process.argv.includes('--allow-version-update');
  const outDir = path.dirname(outAsar);

  const srcVersion = readAsarPackageVersion(srcAsar);
  if (!srcVersion) {
    throw new Error(`Cannot read version from source ASAR: ${srcAsar}`);
  }
  const manifest = JSON.parse(fs.readFileSync(inManifest, 'utf8'));
  if (!allowVersionUpdate && manifest.clientVersion && srcVersion !== manifest.clientVersion) {
    throw new Error(`Source ASAR version (${srcVersion}) does not match manifest clientVersion (${manifest.clientVersion}). Pass --allow-version-update to bump.`);
  }

  const { tree, dataOffset } = parseAsar(srcAsar);
  const overrides = {};

  for (const t of ['dist/preload.js', 'dist/ideInstall/wizardPreload.js']) {
    overrides[t] = Buffer.from(patchInjectionScript(readEntry(srcAsar, dataOffset, tree, t)), 'utf8');
  }
  overrides['dist/menu.js'] = Buffer.from(patchMenuScript(readEntry(srcAsar, dataOffset, tree, 'dist/menu.js')), 'utf8');
  overrides['dist/tray.js'] = Buffer.from(patchTrayScript(readEntry(srcAsar, dataOffset, tree, 'dist/tray.js')), 'utf8');

  const stagePath = path.join(outDir, `.app.asar.ready.stage-${process.pid}`);
  buildAsar(srcAsar, tree, dataOffset, overrides, stagePath);

  try {
    const builtVersion = readAsarPackageVersion(stagePath);
    if (builtVersion !== srcVersion) {
      throw new Error(`Patched ASAR version mismatch: expected ${srcVersion}, got ${builtVersion}`);
    }
    if (!isLocalizedAsar(stagePath)) {
      throw new Error('Patched ASAR failed isLocalizedAsar check');
    }

    const newParsed = parseAsar(stagePath);
    for (const t of ['dist/preload.js', 'dist/ideInstall/wizardPreload.js']) {
      const checkText = readEntry(stagePath, newParsed.dataOffset, newParsed.tree, t);
      if (!checkText.includes('// ===== CUSTOM SIDEBAR DICT START =====') || !checkText.includes('// ===== CUSTOM MODEL GUARD START =====')) {
        throw new Error(`Target entry missing custom patch markers after repack: ${t}`);
      }
    }

    fs.renameSync(stagePath, outAsar);
  } catch (err) {
    if (fs.existsSync(stagePath)) fs.unlinkSync(stagePath);
    throw err;
  }

  const newSha = sha256(fs.readFileSync(outAsar));
  manifest.clientVersion = srcVersion;
  manifest.sha256['app.asar.ready'] = newSha;
  manifest.customized = {
    note: 'Keep model names & tiers (High/Medium/Low/XHigh/Thinking/Fast/o1/o3/GPT-4o/DeepSeek-*) in English; localize sidebar static labels & years/relative time; fix Quote shortcut regex, skipCache reset, batch queue reschedule, Chinglish guard, FIFO cache, menu/tray deduplication & ASAR executable flags.',
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(outManifest, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify({
    success: true,
    outAsar,
    outManifest,
    appAsarReadySha256: newSha,
    size: fs.statSync(outAsar).size,
    version: readAsarPackageVersion(outAsar)
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  parseAsar,
  buildAsar,
  readEntry,
  patchInjectionScript,
  patchMenuScript,
  patchTrayScript,
  verifyInjectionBehavior
};
