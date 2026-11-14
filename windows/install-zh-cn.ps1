param(
  [ValidateSet("", "status", "install", "upgrade", "restore")]
  [string]$Action = "",
  [string]$AppDir = "",
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PayloadAsar = Join-Path $ScriptDir "payload\app.asar.ready"
$ShaFile = Join-Path $ScriptDir "payload\sha256.txt"
$ExpectedVersion = "2.32.1"

function Find-AntigravityDir {
  if ($AppDir) { return $AppDir }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Antigravity"),
    (Join-Path $env:ProgramFiles "Antigravity")
  )
  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} "Antigravity")
  }
  foreach ($dir in $candidates) {
    if ($dir -and (Test-Path (Join-Path $dir "resources\app.asar"))) {
      return $dir
    }
  }
  return $candidates[0]
}

function Get-ExpectedSha256 {
  if (-not (Test-Path $ShaFile)) { throw "缺少校验文件: $ShaFile" }
  return (Get-Content -Raw -Path $ShaFile).Trim().ToLowerInvariant()
}

function Get-FileSha256Lower([string]$FilePath) {
  return (Get-FileHash -Algorithm SHA256 -Path $FilePath).Hash.ToLowerInvariant()
}

function Read-ExactBytes([System.IO.FileStream]$Stream, [int]$Count) {
  $buf = New-Object byte[] $Count
  $offset = 0
  while ($offset -lt $Count) {
    $read = $Stream.Read($buf, $offset, $Count - $offset)
    if ($read -le 0) { throw "ASAR 文件读取截断 ($offset/$Count)" }
    $offset += $read
  }
  return $buf
}

function Get-AsarPackageVersion([string]$AsarPath) {
  if (-not (Test-Path $AsarPath)) { return $null }
  $fs = [System.IO.File]::OpenRead($AsarPath)
  try {
    if ($fs.Length -lt 16) { return $null }
    $prefix = Read-ExactBytes $fs 8
    $magic = [BitConverter]::ToUInt32($prefix, 0)
    if ($magic -ne 4) { return $null }
    $headerSize = [BitConverter]::ToUInt32($prefix, 4)
    if ($headerSize -lt 8 -or $headerSize -gt 4194304 -or ($headerSize % 4) -ne 0 -or $headerSize -gt ($fs.Length - 8)) {
      return $null
    }
    $headerBuf = Read-ExactBytes $fs ([int]$headerSize)
    $payloadSize = [BitConverter]::ToUInt32($headerBuf, 0)
    $jsonSize = [BitConverter]::ToInt32($headerBuf, 4)
    if ($payloadSize -ne ($headerSize - 4) -or $jsonSize -le 0 -or $jsonSize -gt ($headerSize - 8)) {
      return $null
    }
    $jsonText = [System.Text.Encoding]::UTF8.GetString($headerBuf, 8, $jsonSize)
    $tree = $jsonText | ConvertFrom-Json
    if (-not $tree.files -or -not $tree.files.'package.json') { return $null }
    $pkgNode = $tree.files.'package.json'
    if ($pkgNode.unpacked -eq $true) {
      $unpackedPkg = "$AsarPath.unpacked\package.json"
      if (Test-Path $unpackedPkg) {
        return (Get-Content -Raw -Encoding UTF8 $unpackedPkg | ConvertFrom-Json).version
      }
      return $null
    }
    $offset = [int64]$pkgNode.offset
    $size = [int]$pkgNode.size
    $fs.Seek(8 + [int64]$headerSize + $offset, [System.IO.SeekOrigin]::Begin) | Out-Null
    $pkgBytes = Read-ExactBytes $fs $size
    $pkg = ([System.Text.Encoding]::UTF8.GetString($pkgBytes)) | ConvertFrom-Json
    return $pkg.version
  } catch {
    return $null
  } finally {
    $fs.Dispose()
  }
}

function Test-LocalizedAsar([string]$AsarPath) {
  if (-not (Test-Path $AsarPath)) { return $false }
  $bytes = [System.IO.File]::ReadAllBytes($AsarPath)
  $text = [System.Text.Encoding]::GetEncoding("ISO-8859-1").GetString($bytes)
  return (
    $text.Contains("Antigravity 2.0 Chinese Localization Engine") -or
    $text.Contains("menuTranslationMap") -or
    $text.Contains("DOM_TRANSLATOR_INJECTION")
  )
}

function Test-AntigravityRunning {
  $procs = Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue
  return ($null -ne $procs -and $procs.Count -gt 0)
}

function Assert-PayloadValid {
  if (-not (Test-Path $PayloadAsar)) {
    throw "未找到离线补丁包: $PayloadAsar"
  }
  $expected = Get-ExpectedSha256
  $actual = Get-FileSha256Lower $PayloadAsar
  if ($actual -ne $expected) {
    throw "离线补丁 SHA256 校验失败! 预期=$expected 实际=$actual"
  }
  if (-not (Test-LocalizedAsar $PayloadAsar)) {
    throw "离线补丁未通过汉化特征校验。"
  }
  $ver = Get-AsarPackageVersion $PayloadAsar
  if ($ver -ne $ExpectedVersion) {
    throw "离线补丁版本 ($ver) 与预期 ($ExpectedVersion) 不一致。"
  }
}

function Invoke-RotateArchivedBackups([string]$ResDir) {
  $archived = Get-ChildItem -Path $ResDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^app\.asar\.(?:bak\.[^.]+\.\d+|zh-cn\.[^.]+\.backup)$' } |
    Sort-Object LastWriteTimeUtc -Descending
  if ($archived.Count -gt 2) {
    $archived | Select-Object -Skip 2 | Remove-Item -Force -ErrorAction SilentlyContinue
  }
}

function Show-Status([string]$TargetDir) {
  $resDir = Join-Path $TargetDir "resources"
  $asar = Join-Path $resDir "app.asar"
  $bak = Join-Path $resDir "app.asar.bak"
  Write-Host "=========================================="
  Write-Host " Antigravity Windows 简体中文补丁 (v$ExpectedVersion)"
  Write-Host "=========================================="
  Write-Host "目标目录   : $TargetDir"
  if (-not (Test-Path $asar)) {
    Write-Host "客户端状态 : 未检测到 resources\app.asar"
    return $false
  }
  $ver = Get-AsarPackageVersion $asar
  $running = Test-AntigravityRunning
  $localized = Test-LocalizedAsar $asar
  $hasBak = (Test-Path $bak) -and (-not (Test-LocalizedAsar $bak))
  $upToDate = $false
  if ($localized) {
    $upToDate = ((Get-FileSha256Lower $asar) -eq (Get-ExpectedSha256))
  }
  Write-Host ("客户端版本 : " + ($(if ($ver) { $ver } else { "未知" })))
  Write-Host ("运行状态   : " + ($(if ($running) { "运行中 (请先彻底退出托盘及所有窗口)" } else { "未运行" })))
  Write-Host ("当前语言   : " + ($(if ($localized) { "已汉化" } else { "官方英文原版" })))
  if ($localized) {
    Write-Host ("补丁状态   : " + ($(if ($upToDate) { "最新定制版 (v$ExpectedVersion)" } else { "旧版或上游版 (可执行升级)" })))
  }
  Write-Host ("原版备份   : " + ($(if ($hasBak) { "完整存在" } elseif (Test-Path $bak) { "存在但已被汉化污染" } else { "尚无备份" })))
  return $true
}

function Invoke-InstallOrUpgrade([string]$TargetDir, [string]$Mode) {
  Assert-PayloadValid
  $resDir = Join-Path $TargetDir "resources"
  $asar = Join-Path $resDir "app.asar"
  $bak = Join-Path $resDir "app.asar.bak"

  if (-not (Test-Path $asar)) {
    throw "未找到 Antigravity 安装文件: $asar`n请使用 -AppDir 指定正确安装目录。"
  }
  $ver = Get-AsarPackageVersion $asar
  if ($ver -ne $ExpectedVersion) {
    throw "版本不匹配！当前客户端版本为 '$ver'，本补丁仅适用于 v$ExpectedVersion。"
  }

  $expectedSha = Get-ExpectedSha256
  if (Test-LocalizedAsar $asar) {
    if ((Get-FileSha256Lower $asar) -eq $expectedSha) {
      Write-Host "[完成] 当前已安装最新简体中文定制补丁 (v$ExpectedVersion)，无需重复安装。" -ForegroundColor Green
      return
    }
    if (-not (Test-Path $bak)) {
      throw "未找到原版英文备份 app.asar.bak，拒绝直接升级。"
    }
    if (Test-LocalizedAsar $bak) {
      throw "app.asar.bak 已被汉化污染，拒绝升级。"
    }
  }

  if (Test-AntigravityRunning) {
    throw "检测到 Antigravity 正在运行！请先彻底关闭客户端（包括右下角系统托盘图标）后再重试。"
  }

  if (-not (Test-Path $bak)) {
    Write-Host "[1/3] 备份官方英文原版 -> app.asar.bak ..."
    Copy-Item -Path $asar -Destination $bak -Force
  }

  $stage = Join-Path $resDir (".app.asar.zh." + $PID + ".stage")
  Write-Host "[2/3] 写入并校验暂存补丁包..."
  try {
    Copy-Item -Path $PayloadAsar -Destination $stage -Force
    if ((Get-FileSha256Lower $stage) -ne $expectedSha) {
      throw "暂存文件 SHA256 复核失败。"
    }
    if ((Get-AsarPackageVersion $stage) -ne $ExpectedVersion) {
      throw "暂存文件版本复核失败。"
    }
    Write-Host "[3/3] 原子切换应用补丁..."
    Move-Item -Path $stage -Destination $asar -Force
    Invoke-RotateArchivedBackups $resDir
    Write-Host "[成功] Antigravity v$ExpectedVersion 简体中文定制补丁安装完成！请重新启动 Antigravity。" -ForegroundColor Green
  } catch {
    if (Test-Path $stage) { Remove-Item -Path $stage -Force -ErrorAction SilentlyContinue }
    throw
  }
}

function Invoke-RestoreEnglish([string]$TargetDir) {
  $resDir = Join-Path $TargetDir "resources"
  $asar = Join-Path $resDir "app.asar"
  $bak = Join-Path $resDir "app.asar.bak"
  if (-not (Test-Path $asar)) { throw "未找到 $asar" }
  if (-not (Test-LocalizedAsar $asar)) {
    Write-Host "[提示] 当前客户端已是官方英文原版，无需恢复。"
    return
  }
  if (-not (Test-Path $bak)) { throw "未找到原版备份 app.asar.bak，无法自动恢复。" }
  if (Test-LocalizedAsar $bak) { throw "app.asar.bak 也包含汉化特征，拒绝恢复。" }
  if (Test-AntigravityRunning) { throw "Antigravity 正在运行！请先彻底退出后再恢复英文。" }

  $ver = Get-AsarPackageVersion $asar
  $bakVer = Get-AsarPackageVersion $bak
  if (-not $ver -or $ver -ne $bakVer) {
    throw "当前版本 ($ver) 与备份版本 ($bakVer) 不一致，拒绝恢复。"
  }

  $safetyCopy = Join-Path $resDir ("app.asar.zh-cn.$ver.backup")
  if (-not (Test-Path $safetyCopy)) { Copy-Item -Path $asar -Destination $safetyCopy -Force }
  $stage = Join-Path $resDir (".app.asar.en." + $PID + ".stage")
  try {
    Copy-Item -Path $bak -Destination $stage -Force
    if ((Get-FileSha256Lower $stage) -ne (Get-FileSha256Lower $bak)) {
      throw "恢复文件 SHA256 校验失败。"
    }
    Move-Item -Path $stage -Destination $asar -Force
    Invoke-RotateArchivedBackups $resDir
    Write-Host "[成功] 已恢复官方英文原版，请重新启动 Antigravity。" -ForegroundColor Green
  } catch {
    if (Test-Path $stage) { Remove-Item -Path $stage -Force -ErrorAction SilentlyContinue }
    throw
  }
}

$TargetDir = Find-AntigravityDir
if (-not (Test-Path (Join-Path $TargetDir "resources\app.asar")) -and (-not $Action)) {
  Write-Host "未在默认路径找到 Antigravity ($TargetDir)。" -ForegroundColor Yellow
  $custom = Read-Host "请输入 Antigravity 安装目录路径（例如 D:\Programs\Antigravity，留空退出）"
  if (-not $custom) { exit 1 }
  $TargetDir = $custom.Trim().Trim('"')
}

if (-not $Action) {
  Show-Status $TargetDir | Out-Null
  Write-Host ""
  Write-Host "请选择操作："
  Write-Host "  [1] 安装或升级至最新简体中文定制版"
  Write-Host "  [2] 恢复官方英文原版"
  Write-Host "  [3] 仅刷新状态检查"
  Write-Host "  [0] 退出"
  $choice = Read-Host "请输入数字 [0-3] (默认 1)"
  if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "1" }
  switch ($choice) {
    "1" { $Action = "install" }
    "2" { $Action = "restore" }
    "3" { $Action = "status" }
    "0" { exit 0 }
    default { Write-Error "无效选择: $choice"; exit 2 }
  }
}

switch ($Action) {
  "status" {
    $ok = Show-Status $TargetDir
    if (-not $ok) { exit 1 }
  }
  "install" { Invoke-InstallOrUpgrade $TargetDir "install" }
  "upgrade" { Invoke-InstallOrUpgrade $TargetDir "upgrade" }
  "restore" { Invoke-RestoreEnglish $TargetDir }
}

if (-not $Yes) {
  Write-Host ""
  Read-Host "按回车键退出" | Out-Null
}
