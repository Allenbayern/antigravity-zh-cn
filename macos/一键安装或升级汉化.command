#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PAYLOAD_ASAR="$SCRIPT_DIR/payload/app.asar.ready"
SHA_FILE="$SCRIPT_DIR/payload/sha256.txt"
EXPECTED_VERSION="2.32.1"

ACTION="${1:-}"
APP_DIR=""
AUTO_YES=0

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)
      APP_DIR="${2:-}"
      shift 2
      ;;
    --yes|-y)
      AUTO_YES=1
      shift
      ;;
    *)
      echo "[错误] 未知参数: $1"
      echo "用法: $(basename "$0") [status|install|upgrade|restore] [--app-dir <Antigravity.app>] [--yes]"
      exit 2
      ;;
  esac
done

detect_app_dir() {
  if [[ -n "$APP_DIR" ]]; then
    return 0
  fi
  if [[ -d "/Applications/Antigravity.app" ]]; then
    APP_DIR="/Applications/Antigravity.app"
  elif [[ -d "$HOME/Applications/Antigravity.app" ]]; then
    APP_DIR="$HOME/Applications/Antigravity.app"
  else
    APP_DIR="/Applications/Antigravity.app"
  fi
}

read_expected_sha() {
  tr -d ' \t\r\n' < "$SHA_FILE"
}

calc_sha256() {
  /usr/bin/shasum -a 256 "$1" | awk '{print $1}'
}

is_localized_asar() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  LC_ALL=C /usr/bin/grep -q -a -E "Antigravity 2\.0 Chinese Localization Engine|menuTranslationMap|DOM_TRANSLATOR_INJECTION" "$f"
}

read_asar_version() {
  local asar_file="$1"
  local plist_file="${APP_DIR}/Contents/Info.plist"
  if command -v node >/dev/null 2>&1; then
    local v
    v="$(node -e '
      const fs = require("fs");
      try {
        const fd = fs.openSync(process.argv[1], "r");
        const p = Buffer.alloc(8); fs.readSync(fd, p, 0, 8, 0);
        if (p.readUInt32LE(0) !== 4) process.exit(1);
        const hs = p.readUInt32LE(4);
        const hb = Buffer.alloc(hs); fs.readSync(fd, hb, 0, hs, 8);
        const js = hb.readInt32LE(4);
        const tree = JSON.parse(hb.subarray(8, 8 + js).toString("utf8"));
        const entry = tree.files["package.json"];
        const buf = Buffer.alloc(entry.size);
        fs.readSync(fd, buf, 0, entry.size, 8 + hs + Number(entry.offset));
        fs.closeSync(fd);
        const pkg = JSON.parse(buf.toString("utf8"));
        if (pkg && typeof pkg.version === "string") console.log(pkg.version);
      } catch (_) {}
    ' "$asar_file" 2>/dev/null || true)"
    if [[ -n "$v" ]]; then
      echo "$v"
      return 0
    fi
  fi
  if [[ "$asar_file" == "$APP_DIR/Contents/Resources/app.asar" && -f "$plist_file" && -x /usr/libexec/PlistBuddy ]]; then
    /usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$plist_file" 2>/dev/null || true
    return 0
  fi
  return 0
}

is_app_running() {
  /usr/bin/pgrep -f "${APP_DIR}/Contents/MacOS/" >/dev/null 2>&1
}

verify_payload() {
  if [[ ! -f "$PAYLOAD_ASAR" || ! -f "$SHA_FILE" ]]; then
    echo "[错误] 离线补丁文件缺失，请确认未删除 payload 目录。"
    return 1
  fi
  local expected actual
  expected="$(read_expected_sha)"
  actual="$(calc_sha256 "$PAYLOAD_ASAR")"
  if [[ "$actual" != "$expected" ]]; then
    echo "[错误] 离线补丁 SHA256 校验失败！"
    echo "  预期: $expected"
    echo "  实际: $actual"
    return 1
  fi
  if ! is_localized_asar "$PAYLOAD_ASAR"; then
    echo "[错误] 离线补丁未通过汉化特征校验。"
    return 1
  fi
  return 0
}

rotate_archived_backups() {
  local res_dir="$1"
  local files
  files="$(ls -1t "$res_dir"/app.asar.bak.*.* "$res_dir"/app.asar.zh-cn.*.backup 2>/dev/null || true)"
  [[ -z "$files" ]] && return 0
  local idx=0
  while IFS= read -r f; do
    idx=$((idx + 1))
    if [[ $idx -gt 2 && -f "$f" && ! -L "$f" ]]; then
      rm -f "$f" 2>/dev/null || true
    fi
  done <<< "$files"
}

show_status() {
  detect_app_dir
  local res_dir="$APP_DIR/Contents/Resources"
  local asar="$res_dir/app.asar"
  local bak="$res_dir/app.asar.bak"

  echo "=========================================="
  echo " Antigravity macOS 简体中文补丁 (v${EXPECTED_VERSION})"
  echo "=========================================="
  echo "目标客户端 : $APP_DIR"

  if [[ ! -f "$asar" ]]; then
    echo "客户端状态 : 未安装或路径不存在"
    return 1
  fi

  local ver running_str localized_str backup_str uptodate_str
  ver="$(read_asar_version "$asar")"
  is_app_running && running_str="运行中 (安装/恢复前请先 Cmd+Q 退出)" || running_str="未运行"
  is_localized_asar "$asar" && localized_str="已汉化" || localized_str="官方英文原版"
  if [[ -f "$bak" ]]; then
    is_localized_asar "$bak" && backup_str="存在但被汉化污染" || backup_str="原版英文备份完整"
  else
    backup_str="尚无备份"
  fi
  if is_localized_asar "$asar"; then
    if [[ "$(calc_sha256 "$asar")" == "$(read_expected_sha)" ]]; then
      uptodate_str="最新定制版 (v${EXPECTED_VERSION})"
    else
      uptodate_str="旧版或上游版本 (可执行 upgrade 升级)"
    fi
  else
    uptodate_str="N/A"
  fi

  echo "客户端版本 : ${ver:-未知}"
  echo "运行状态   : $running_str"
  echo "当前语言   : $localized_str"
  echo "补丁状态   : $uptodate_str"
  echo "原版备份   : $backup_str"
  return 0
}

do_install_or_upgrade() {
  local mode="$1" # install | upgrade
  detect_app_dir
  local res_dir="$APP_DIR/Contents/Resources"
  local asar="$res_dir/app.asar"
  local bak="$res_dir/app.asar.bak"

  verify_payload || return 1

  if [[ ! -d "$APP_DIR" || ! -f "$asar" ]]; then
    echo "[错误] 未找到 Antigravity 客户端: $asar"
    return 1
  fi
  if [[ -L "$asar" || ( -e "$bak" && -L "$bak" ) ]]; then
    echo "[错误] 检测到异常符号链接，已拒绝修改。"
    return 1
  fi

  local cur_ver
  cur_ver="$(read_asar_version "$asar")"
  if [[ "$cur_ver" != "$EXPECTED_VERSION" ]]; then
    echo "[拦截] 版本不匹配！当前客户端版本为 '${cur_ver:-未知}'，本补丁仅适用于 v${EXPECTED_VERSION}。"
    return 1
  fi

  local expected_sha cur_sha
  expected_sha="$(read_expected_sha)"
  cur_sha="$(calc_sha256 "$asar")"

  if is_localized_asar "$asar"; then
    if [[ "$cur_sha" == "$expected_sha" ]]; then
      echo "[完成] 当前已安装最新定制简体中文补丁 (v${EXPECTED_VERSION})，无需重复安装。"
      return 0
    fi
    if [[ "$mode" != "upgrade" ]]; then
      echo "[提示] 检测到当前已装有旧版或上游汉化补丁，将执行升级至最新定制版..."
    fi
    if [[ ! -f "$bak" ]]; then
      echo "[拦截] 找不到原版 app.asar.bak，无法校验原版基线，拒绝覆盖升级。"
      return 1
    fi
    if is_localized_asar "$bak"; then
      echo "[拦截] app.asar.bak 已被汉化污染，拒绝升级。"
      return 1
    fi
  fi

  if is_app_running; then
    echo "[拦截] Antigravity 正在运行中！请先按 Cmd+Q 完全退出客户端后重试（本脚本不会强杀进程）。"
    return 1
  fi

  if [[ ! -w "$res_dir" ]]; then
    echo "[提示] 目标目录需要管理员权限 ($res_dir)。"
    echo "请在终端中运行: sudo \"$0\" $mode --app-dir \"$APP_DIR\" --yes"
    return 1
  fi

  if [[ ! -f "$bak" ]]; then
    echo "[1/3] 备份官方英文原版 -> app.asar.bak ..."
    cp -f "$asar" "$bak" || return 1
  fi

  local stage="$res_dir/.app.asar.zh.${BASHPID:-$$}.stage"
  echo "[2/3] 写入并校验暂存补丁包..."
  if ! cp -f "$PAYLOAD_ASAR" "$stage"; then
    rm -f "$stage" 2>/dev/null || true
    echo "[错误] 写入暂存文件失败。"
    return 1
  fi
  if [[ "$(calc_sha256 "$stage")" != "$expected_sha" ]]; then
    rm -f "$stage" 2>/dev/null || true
    echo "[错误] 暂存文件 SHA256 复核失败。"
    return 1
  fi

  echo "[3/3] 原子切换应用补丁..."
  if ! mv -f "$stage" "$asar"; then
    rm -f "$stage" 2>/dev/null || true
    echo "[错误] 替换 app.asar 失败。"
    return 1
  fi

  rotate_archived_backups "$res_dir"
  echo "[成功] Antigravity v${EXPECTED_VERSION} 简体中文定制补丁已安装！请重新打开 Antigravity 生效。"
  return 0
}

do_restore() {
  detect_app_dir
  local res_dir="$APP_DIR/Contents/Resources"
  local asar="$res_dir/app.asar"
  local bak="$res_dir/app.asar.bak"

  if [[ ! -f "$asar" ]]; then
    echo "[错误] 未找到 $asar"
    return 1
  fi
  if ! is_localized_asar "$asar"; then
    echo "[提示] 当前客户端已是官方英文原版，无需恢复。"
    return 0
  fi
  if [[ ! -f "$bak" ]]; then
    echo "[错误] 未找到原版英文备份 app.asar.bak，无法自动恢复。"
    return 1
  fi
  if is_localized_asar "$bak"; then
    echo "[拦截] app.asar.bak 也含汉化标记，拒绝恢复。"
    return 1
  fi
  if is_app_running; then
    echo "[拦截] Antigravity 正在运行中！请先按 Cmd+Q 完全退出后重试。"
    return 1
  fi
  if [[ ! -w "$res_dir" ]]; then
    echo "[提示] 目标目录需要管理员权限，请运行: sudo \"$0\" restore --app-dir \"$APP_DIR\" --yes"
    return 1
  fi

  local cur_ver safety_copy stage bak_sha
  cur_ver="$(read_asar_version "$asar")"
  bak_sha="$(calc_sha256 "$bak")"
  safety_copy="$res_dir/app.asar.zh-cn.${cur_ver:-unknown}.backup"
  [[ ! -f "$safety_copy" ]] && cp -f "$asar" "$safety_copy" 2>/dev/null || true

  stage="$res_dir/.app.asar.en.${BASHPID:-$$}.stage"
  cp -f "$bak" "$stage" || { rm -f "$stage" 2>/dev/null || true; return 1; }
  if [[ "$(calc_sha256 "$stage")" != "$bak_sha" ]]; then
    rm -f "$stage" 2>/dev/null || true
    echo "[错误] 恢复文件 SHA256 校验失败。"
    return 1
  fi
  mv -f "$stage" "$asar" || { rm -f "$stage" 2>/dev/null || true; return 1; }
  rotate_archived_backups "$res_dir"
  echo "[成功] 已原子恢复为官方英文原版，请重新打开 Antigravity。"
  return 0
}

if [[ -z "$ACTION" ]]; then
  show_status || true
  echo ""
  echo "请选择操作："
  echo "  [1] 安装或升级至最新简体中文定制版"
  echo "  [2] 恢复官方英文原版"
  echo "  [3] 仅刷新状态检查"
  echo "  [0] 退出"
  printf "请输入数字 [0-3] (默认 1): "
  read -r choice
  choice="${choice:-1}"
  case "$choice" in
    1) ACTION="install" ;;
    2) ACTION="restore" ;;
    3) ACTION="status" ;;
    0) exit 0 ;;
    *) echo "[错误] 无效选择: $choice"; exit 2 ;;
  esac
fi

rc=0
case "$ACTION" in
  status) show_status || rc=$? ;;
  install) do_install_or_upgrade install || rc=$? ;;
  upgrade) do_install_or_upgrade upgrade || rc=$? ;;
  restore) do_restore || rc=$? ;;
  *)
    echo "[错误] 不支持的操作: $ACTION"
    rc=2
    ;;
esac

if [[ $AUTO_YES -eq 0 && -t 0 ]]; then
  echo ""
  printf "按回车键关闭窗口..."
  read -r _
fi

exit "$rc"
