# Antigravity Simplified Chinese Refined Edition (`antigravity-zh-cn`)

English | [简体中文](./README.md)

A refined localization & runtime-hardened build for Google Antigravity (**v2.32.1**), derived from [liominsb/Antigravity-Chinese-Localization](https://github.com/liominsb/Antigravity-Chinese-Localization) (MIT License). Distributed in three ready-to-use formats: **Antigravity Skill**, **macOS Standalone Installer**, and **Windows Standalone Installer**.

> **Supported Client Version**: Google Antigravity **v2.32.1**
> **Patched `app.asar.ready` SHA256**: `8485db086af78b9c302a65a4c239948a07187e0f482577db9c2e79f4bd6558d2`

---

## What Is Improved

1. **Full-English Preservation for Models & Reasoning/Speed Tiers**
   - Keeps all model names and tier labels cleanly in English: `Gemini 4 Hydrogen (High)`, `Orchestrator (Argon)`, `Claude Opus 4.6 (Thinking)`, `Claude Sonnet 4.6 (Thinking) (High)`, `GPT-OSS 120B (Medium)`, `GPT-4o`, `DeepSeek-V3`, `DeepSeek-R1`, `o1`, `o3-mini`, plus standalone tier badges (`High`, `Medium`, `Low`, `XHigh`, `Thinking`, `Fast`).
   - Outer menus and headings (`Model Selection` → `模型选择`, `Model parameters` → `模型参数`, `Reasoning effort` → `推理强度`, `Gemini models` → `Gemini 模型`, `Thinking...` → `思考中...`, `Thought for 4s` → `思考了 4s`) stay localized in Simplified Chinese.
2. **Sidebar Static Chrome Completion & Anti-Chinglish Protection**
   - Adds missing sidebar static labels (`Inbox`, `Playground`, `Today`, `Yesterday`, `This Week`, `This Month`, `Older`, `Earlier`, `Recent`, `Recents`, `No Workspace`, `Follow-ups`, `Needs Attention`, `Agent Manager`, `Start a new conversation`, `New Chat`, `Collapse sidebar`, `Just now`) and relative timestamps from seconds up to years (`N 年前`).
   - Prevents partial Chinglish mangling on 2–3 word English strings (e.g., short English conversation titles like `Fix login error`, `Run tests`, or `Build model server` stay intact instead of being split into mixed Chinese-English fragments).
   - Note: Dynamic per-conversation titles are generated in English by Antigravity's `language_server` and stored in local SQLite history; this offline UI patch intentionally leaves dynamic conversation titles untouched.
3. **Runtime Engine, Native Menu & Packaging Fixes**
   - **Dynamic `skipCache` invalidation**: Resets per scan/batch so elements transitioning out of `thinking-content` or `cursor-edit` states do not get permanently stuck untranslated.
   - **No dropped MutationObserver batches**: `processBatchTranslation` re-schedules when `isTranslating` is busy instead of silently dropping queued nodes.
   - **Fixed `Quote Cmd+L / Ctrl+L` regex**: Restores missing backslash escapes (`\s+` and `\+`).
   - **Performance**: Replaces layout-thrashing `element.innerText` with `element.textContent`, deduplicates attribute loops, short-circuits after `tryCombinedSentenceTranslation` hits, caches punctuation-stripped hits, and enforces FIFO eviction at `MAX_STRING_CACHE = 5000`.
   - **ASAR & Menu/Tray polish**: Collapses 6× duplicate `translateMenu` invocations in `dist/menu.js`, adds `N agent(s) running` handling in `dist/tray.js`, restores `executable: true` metadata for `js-yaml.js`/`semver.js`, and enforces byte-for-byte idempotent patching via `START`/`END` markers in `customize_patch.js`.

---

## Installation (Prebuilt Packages in Releases)

Download prebuilt zero-dependency archives from **[Releases](../../releases)**:

### 1. macOS Standalone Installer (`antigravity-zh-cn-v2.32.1-macos.zip`)
1. Fully quit Antigravity with **`Cmd + Q`** (the installer never force-kills processes).
2. Unzip and double-click **`一键安装或升级汉化.command`**, choose **`1`** to install or upgrade from an older/upstream patch, or **`2`** to atomically restore the original English `app.asar.bak`.

### 2. Windows Standalone Installer (`antigravity-zh-cn-v2.32.1-windows.zip`)
1. Completely exit Antigravity (including any system tray icon).
2. Unzip and double-click **`一键安装或升级汉化.bat`** (right-click → *Run as administrator* if installed under `Program Files`), choose **`1`** to install/upgrade or **`2`** to restore English.
3. Zero Node.js dependency: pure PowerShell (UTF-8 BOM + CRLF for Windows PowerShell 5.1 & 7+) with binary ASAR header version checking and SHA256 verification.
   > Note: Built and encoding-verified on macOS; not yet executed on physical Windows hardware.

### 3. Antigravity Skill (`skill/`)
1. Copy `skill/` to `~/.gemini/config/skills/antigravity-zh-cn/`.
2. Download `app.asar.ready` from **Releases** into `~/.gemini/config/skills/antigravity-zh-cn/vendor/app.asar.ready`.
3. Run the regression suite:
   ```bash
   node ~/.gemini/config/skills/antigravity-zh-cn/tests/wrapper.test.js
   ```
4. Manage via CLI:
   ```bash
   node ~/.gemini/config/skills/antigravity-zh-cn/scripts/antigravity_locale.js status
   node ~/.gemini/config/skills/antigravity-zh-cn/scripts/antigravity_locale.js install
   node ~/.gemini/config/skills/antigravity-zh-cn/scripts/antigravity_locale.js upgrade
   node ~/.gemini/config/skills/antigravity-zh-cn/scripts/antigravity_locale.js restore
   ```

---

## Attribution & Disclaimer

- Built upon the MIT-licensed work of [liominsb/Antigravity-Chinese-Localization](https://github.com/liominsb/Antigravity-Chinese-Localization).
- Unofficial third-party UI patch, not affiliated with Google. Replacing `app.asar` invalidates the macOS bundle code signature and may be overwritten by official auto-updates; use `restore` at any time to revert cleanly to the backed-up English original.
