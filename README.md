# Antigravity 简体中文定制增强版 (`antigravity-zh-cn`)

[English Documentation](./README.en.md) | 简体中文

基于上游开源项目 [liominsb/Antigravity-Chinese-Localization](https://github.com/liominsb/Antigravity-Chinese-Localization)（MIT License，`v2.32.1`）进行的深度定制与运行时工程修复版，提供 **Antigravity Skill 版**、**macOS 独立安装版** 与 **Windows 独立安装版** 三种开箱形态。

> **适用版本**：Google Antigravity **v2.32.1**
> **定制 `app.asar.ready` SHA256**：`8485db086af78b9c302a65a4c239948a07187e0f482577db9c2e79f4bd6558d2`

---

## 核心定制亮点

1. **所有模型名与推理 / 速度档位全英文保留**
   - 保留 `Gemini 4 Hydrogen (High)`、`Orchestrator (Argon)`、`Claude Opus 4.6 (Thinking)`、`Claude Sonnet 4.6 (Thinking) (High)`、`GPT-OSS 120B (Medium)`、`GPT-4o`、`DeepSeek-V3`、`DeepSeek-R1`、`o1` / `o3-mini` 以及独立档位词 `High`、`Medium`、`Low`、`XHigh`、`Thinking`、`Fast` 等。
   - 外层菜单与说明（如 `模型选择`、`模型参数`、`推理强度`、`Gemini 模型`、`Claude 与 GPT 模型`、`思考中...`、`思考了 4s`）继续保留简体中文。
2. **左侧边栏静态栏目补全 + 防中英夹生（Chinglish）拦截**
   - 补齐 `Inbox（收件箱）`、`Playground（演练场）`、`Today（今天）`、`Yesterday（昨天）`、`This Week（本周）`、`This Month（本月）`、`Older / Earlier（更早）`、`Recent / Recents（最近）`、`No Workspace（无工作区）`、`Follow-ups（后续跟进）`、`Needs Attention（需要关注）`、`Agent Manager（智能体管理器）`、`New Chat（新建对话）`、`Collapse sidebar（折叠侧边栏）`、`Just now（刚刚）` 以及秒 / 分钟 / 小时 / 天 / 周 / 月 / **年** 的相对时间。
   - 拦截 `coreWords` 分词兜底导致的半吊子中英混排（例如 2~3 词英文对话标题 `Fix login error`、`Run tests`、`Build model server` 保持英文原样，不拆成 `Fix login 错误`）。
   - 说明：单条会话的动态标题由 Antigravity `language_server` 内置英文提示词实时生成并持久化在本地数据库中，本离线 UI 补丁不会篡改或机翻你的会话标题内容。
3. **上游运行时 Defect 与性能修复**
   - 修复 `skipCache`（`WeakMap`）永久缓存动态父容器状态导致思考/编辑结束后的元素不再汉化的问题。
   - 修复 `processBatchTranslation` 在 `isTranslating` 竞争时直接丢弃待翻节点队列的问题。
   - 修复 `Quote Ctrl+L / Cmd+L` 浮动引用按钮正则漏转义导致的快捷键匹配失效。
   - 修复 `shouldSkipNode` 调用 `innerText` 触发同步布局重排（Layout Thrashing）的问题（改用 `textContent`）。
   - 修复 `translateNode` 对 `placeholder`/`title`/`aria-label` 重复翻译两次、标点剥离命中未写缓存、`stringCache` 达 5000 上限无 FIFO 淘汰、`tryCombinedSentenceTranslation` 成功后未早退、以及 `dist/menu.js` 重复 6 次执行 `translateMenu` 的问题。
   - 重打包过程引入 `readExactly` 防截断，并保留原版 `js-yaml.js` / `semver.js` 的 `executable: true` 属性与全量 4MB 分块 SHA256 `integrity` 校验。

---

## 三种使用方式（零依赖安装包请前往 Releases 下载）

前往本仓库 **[Releases](../../releases)** 下载对应压缩包即可开箱使用（无需 Node.js 环境）：

### 1. macOS 独立安装版 (`antigravity-zh-cn-v2.32.1-macos.zip`)
1. 按 **`Cmd + Q`** 完全退出 Antigravity（安装脚本不会强杀进程）。
2. 解压后双击 **`一键安装或升级汉化.command`**，输入 **`1`** 即可完成安装或从旧版/上游汉化包升级；输入 **`2`** 可恢复官方英文原版。
3. 支持自动备份原版 `app.asar.bak`、SHA256 校验、原子替换以及版本不匹配拦截。

### 2. Windows 独立安装版 (`antigravity-zh-cn-v2.32.1-windows.zip`)
1. 彻底关闭 Antigravity（请检查右下角系统托盘图标并完全退出）。
2. 解压后双击 **`一键安装或升级汉化.bat`**（若客户端安装在 `C:\Program Files\...`，请右键选择 **以管理员身份运行**），输入 **`1`** 即可安装或升级，输入 **`2`** 恢复官方英文原版。
3. 内置纯 PowerShell ASAR 二进制版本解析与 SHA256 校验，自动探测 `%LOCALAPPDATA%\Programs\Antigravity`、`%ProgramFiles%\Antigravity` 等常见目录。
   > 注：Windows 包在 macOS 上完成构建与编码封装（PowerShell 5.1/7 兼容的 UTF-8 BOM + CRLF），建议首次使用时留意控制台状态输出。

### 3. Antigravity Skill 版 (`skill/`)
1. 将仓库内 `skill/` 完整复制到 `~/.gemini/config/skills/antigravity-zh-cn/`。
2. 从 **Releases** 下载 `app.asar.ready` 放入 `~/.gemini/config/skills/antigravity-zh-cn/vendor/app.asar.ready`。
3. 验证完整性与自动化回归测试：
   ```bash
   node ~/.gemini/config/skills/antigravity-zh-cn/tests/wrapper.test.js
   ```
4. 常用命令：
   ```bash
   node ~/.gemini/config/skills/antigravity-zh-cn/scripts/antigravity_locale.js status
   node ~/.gemini/config/skills/antigravity-zh-cn/scripts/antigravity_locale.js install
   node ~/.gemini/config/skills/antigravity-zh-cn/scripts/antigravity_locale.js upgrade
   node ~/.gemini/config/skills/antigravity-zh-cn/scripts/antigravity_locale.js restore
   ```

### 自定义二次打包
如你想自行基于上游 `app.asar.ready` 微调词表或模型守卫，修改 `skill/scripts/customize_patch.js` 后执行：
```bash
node skill/scripts/customize_patch.js --in-asar <输入.asar> --out-asar <输出.asar>
```
脚本支持成对 `START`/`END` 锚点热替换与逐字节幂等校验，并会在构建期运行内置 Node `vm` 行为测试集。

---

## 致谢与免责声明

- 上游汉化基础工作与词库归功于 [liominsb/Antigravity-Chinese-Localization](https://github.com/liominsb/Antigravity-Chinese-Localization)（MIT License）。
- 本项目为第三方离线界面本地化补丁，与 Google 无关；修改 `app.asar` 会使原生应用资源签名校验失效，若遇到系统安全拦截或客户端官方自动更新覆盖，请随时运行 `restore` 恢复官方英文原版。
