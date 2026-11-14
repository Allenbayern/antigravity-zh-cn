---
name: antigravity-zh-cn
description: 将 macOS 版 Google Antigravity 客户端的原生菜单、设置、权限、插件与 Agent 界面切换为简体中文，或安全恢复英文。用户提到 Antigravity 汉化、中文界面、中文菜单、语言包、locale、修复汉化或恢复英文时使用。
---

# Antigravity 简体中文界面

## 职责边界

- 本 Skill 是离线安装、检查与恢复工具，不是常驻翻译器，也不改变 Agent 的回复语言。
- 只支持 macOS 标准路径 `/Applications/Antigravity.app`，且内置补丁只适用于 **v2.32.1**。其他版本必须停止，不能拿旧补丁覆盖。
- 补丁会替换 `Contents/Resources/app.asar`，因此覆盖原生菜单与 Antigravity 专属 UI；只安装 VS Code 中文语言包达不到同样覆盖。
- 不读取或修改账号、OAuth、Cookie、项目文件，不关闭自动更新，不强杀进程，不自动重启。

## 操作原则

直接执行脚本，不要只给用户手工教程。脚本输出 JSON；只有 `success: true` 才能报告成功。`APP_RUNNING` 时停止并请用户手动 **Cmd+Q**，不要自行退出客户端。

### 检查状态（只读）

```bash
node ~/.gemini/config/skills/antigravity-zh-cn/scripts/antigravity_locale.js status
```

### 安装或更新后修复中文

```bash
node ~/.gemini/config/skills/antigravity-zh-cn/scripts/antigravity_locale.js install
```

- 安装前会验证固定 SHA256、客户端与补丁版本，并备份原版为 `app.asar.bak`。
- `ALREADY_LOCALIZED` 表示已安装最新补丁，不需重复覆盖。
- `PATCH_UPDATE_AVAILABLE` 表示客户端当前装的是旧版汉化补丁，本地有更新的定制包；请先手动 **Cmd+Q** 退出客户端，再运行：

```bash
node ~/.gemini/config/skills/antigravity-zh-cn/scripts/antigravity_locale.js upgrade
```

- `VERSION_MISMATCH` 时明确告诉用户需等待同版本补丁，不得绕过。
- 成功后告诉用户：手动 **Cmd+Q 后重新打开**。不要把文件安装成功说成界面已经人工验收。

### 恢复英文

```bash
node ~/.gemini/config/skills/antigravity-zh-cn/scripts/antigravity_locale.js restore
```

仅当当前文件是本方案汉化状态、存在同版本非汉化原版备份时才恢复。采用同目录暂存、SHA256 校验和原子重命名；保留汉化安全副本。成功后由用户自行重启。

## 已知限制

- 官方升级可能覆盖补丁，需要重新安装；如果新版本没有同版本补丁，必须停用本 Skill，而不是强行兼容。
- 保留模型名与模型推理/速度档位（含 `Gemini 4 Hydrogen (High)`、`Claude Opus 4.6 (Thinking)`、`GPT-4o`、`DeepSeek-V3`、`o1`/`o3-mini` 及 `High`/`Medium`/`Low`/`XHigh`/`Thinking`/`Fast`）、代码、文件路径、用户对话、短英文标题防夹生以及 Thinking 原文；左侧边栏静态栏目（`Inbox`/`Playground`/`Today`/`Yesterday`/`This Week`/`This Month`/`Older`/`Recents`/`New Chat` 及秒至年的相对时间）与原生菜单/托盘均已补齐汉化，但单条会话的动态摘要标题由服务端内置英文提示词实时生成，离线 UI 补丁不会强制机器翻译任意会话标题内容。
- 这是修改应用资源的第三方补丁，不是 Google 官方语言设置；若 macOS 因签名或完整性拦截启动，先恢复英文并报告。
- 来源与版本哈希见 `vendor-manifest.json`，许可证见 `vendor/LICENSE`。
