# Antigravity 简体中文定制补丁 — macOS 独立安装版 (v2.32.1)

## 特性
- **零依赖**：纯 macOS 原生脚本，无需安装 Node.js 或任何第三方包管理器。
- **开箱规则**：
  - 所有模型名与推理/速度档位（含 `Gemini 4 Hydrogen (High)`、`Claude Opus 4.6 (Thinking)`、`GPT-4o`、`DeepSeek-V3`、`o1`/`o3-mini`、`High`/`Medium`/`Low`/`XHigh`/`Thinking`/`Fast`）**全英文保留**。
  - 侧边栏静态栏目（`Inbox`/`Playground`/`Today`/`Yesterday`/`This Week`/`This Month`/`Older`/`Recents`/`New Chat` 等）与秒至年的相对时间已补齐汉化。
  - 修复上游 `Quote Cmd+L` 快捷键失效、`skipCache` 状态切回卡住不翻、批处理队列丢帧、短英文标题被半吊子翻成 Chinglish、原生菜单重复调用与热路径卡顿等问题。

## 使用方法
1. 按 **`Cmd + Q`** 完全退出 Antigravity 客户端（脚本不会强杀进程）。
2. 双击运行 **`一键安装或升级汉化.command`**，按提示选择 **`1`** 即可完成安装或从旧汉化包升级。
3. 如首次在「系统设置 -> 隐私与安全性」拦截未知开发者脚本，右键点击该 `.command` 文件 -> **打开** 即可；或直接在终端执行：
   ```bash
   ./一键安装或升级汉化.command install
   ```
4. 如需恢复官方英文原版，退出 Antigravity 后运行：
   ```bash
   ./一键安装或升级汉化.command restore
   ```
