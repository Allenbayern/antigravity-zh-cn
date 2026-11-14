# Antigravity 简体中文定制补丁 — Windows 独立安装版 (v2.32.1)

## 特性
- **零依赖**：基于 Windows 原生批处理 + PowerShell（兼容 PowerShell 5.1 与 7+），无需 Node.js 或 Python。
- **同源校验**：内置原生二进制 ASAR 版本解析器，安装/升级前严格校验客户端与补丁同为 **v2.32.1** 且 SHA256 一致。
- **自动路径发现**：自动探测 `%LOCALAPPDATA%\Programs\Antigravity`、`%ProgramFiles%\Antigravity`、`%ProgramFiles(x86)%\Antigravity`，也支持手动指定自定义安装目录。
- **安全机制**：检测 `Antigravity` 进程仍在运行（含右下角托盘驻留）时拒绝强杀或强写；自动备份原版为 `app.asar.bak`，支持一键恢复英文。

## 使用方法
1. 完全关闭 Antigravity（若右下角系统托盘有图标，请右键 **退出 / Quit**）。
2. 双击 **`一键安装或升级汉化.bat`**（若 Antigravity 安装在 `C:\Program Files\...`，请右键 **`以管理员身份运行`**）。
3. 按菜单提示输入 **`1`** 即可完成安装或从旧汉化包升级；需要恢复英文时输入 **`2`**。

> 注：本安装包在 macOS 侧完成构建与跨平台 ASAR 结构/脚本语法检查，Windows 实际安装环境请按上述步骤实地双击运行验证。
