[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DatabaseName,

  [string]$Binding = "DB",
  [string]$DdlPath = "database/DDL.sql",
  [string]$WranglerTomlPath = "wrangler.toml",
  [string]$Environment = "",
  [switch]$RemoteExecute,
  [switch]$DeleteExisting
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# このスクリプトの目的:
# 1) D1 DBを作成（必要なら削除後に再作成）
# 2) DDLを適用
# 3) wrangler.toml の d1_databases 設定を最新 database_id に更新

# 指定コマンドが実行可能かを確認する。
# 見つからない場合は例外を投げて処理を停止する。
function Assert-CommandExists {
  param([string]$CommandName)
  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "コマンド '$CommandName' が見つかりません。インストール後に再実行してください。"
  }
}

# wrangler コマンドを実行し、失敗したら例外化する共通ラッパー。
# 実行コマンドを表示して、運用時の追跡を容易にする。
function Invoke-Wrangler {
  param([string[]]$CommandArgs)

  Write-Host "> wrangler $($CommandArgs -join ' ')" -ForegroundColor Cyan
  & wrangler @CommandArgs
  if ($LASTEXITCODE -ne 0) {
    throw "wrangler コマンドに失敗しました: wrangler $($CommandArgs -join ' ')"
  }
}

# wrangler d1 create の標準出力から database_id(UUID) を抽出して返す。
# UUIDが見つからない場合は例外を投げる。
function Get-DatabaseIdFromCreateOutput {
  param([string]$Output)

  # wrangler d1 create の出力に含まれる UUID（database_id）を抽出
  $uuidPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
  $m = [regex]::Match($Output, $uuidPattern)
  if (-not $m.Success) {
    throw "database_id (UUID) を wrangler の出力から抽出できませんでした。出力を確認してください。"
  }
  return $m.Value
}

# wrangler.toml の [[d1_databases]] を更新する。
# 指定 binding が存在すれば database_name / database_id を更新し、
# 存在しなければ新しい [[d1_databases]] ブロックを追加する。
function Update-WranglerTomlD1Binding {
  param(
    [string]$TomlPath,
    [string]$TargetBinding,
    [string]$TargetDatabaseName,
    [string]$TargetDatabaseId,
    [string]$TargetEnvironment = ""
  )

  $raw = Get-Content -Path $TomlPath -Raw -Encoding UTF8
  $newline = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in ($raw -split '\r?\n')) {
    $lines.Add($line)
  }

  # 対象環境に応じた d1_databases ブロックを抽出し、指定 binding のブロックを探す
  if ($TargetEnvironment) {
    $appendHeader = "[[env.$TargetEnvironment.d1_databases]]"
  }
  else {
    $appendHeader = '[[d1_databases]]'
  }

  $selectedStart = -1
  $selectedEnd = -1
  $bindingPattern = '(?m)^binding\s*=\s*"' + [regex]::Escape($TargetBinding) + '"\s*$'

  for ($index = 0; $index -lt $lines.Count; $index++) {
    if ($lines[$index].Trim() -ne $appendHeader) {
      continue
    }

    $blockEnd = $index + 1
    while ($blockEnd -lt $lines.Count -and -not $lines[$blockEnd].TrimStart().StartsWith('[')) {
      $blockEnd++
    }

    $blockRaw = (($lines[$index..($blockEnd - 1)]) -join $newline)
    if ($blockRaw -match $bindingPattern) {
      $selectedStart = $index
      $selectedEnd = $blockEnd
      break
    }
  }

  if ($selectedStart -lt 0) {
    # 指定 binding が存在しない場合は末尾に新規追加
    while ($lines.Count -gt 0 -and [string]::IsNullOrWhiteSpace($lines[$lines.Count - 1])) {
      $lines.RemoveAt($lines.Count - 1)
    }
    if ($lines.Count -gt 0) {
      $lines.Add('')
    }
    $lines.Add($appendHeader)
    $lines.Add("binding = `"$TargetBinding`"")
    $lines.Add("database_name = `"$TargetDatabaseName`"")
    $lines.Add("database_id = `"$TargetDatabaseId`"")
  }
  else {
    # 既存 binding がある場合は database_name / database_id のみ更新
    $updatedBlockLines = [System.Collections.Generic.List[string]]::new()
    $nameUpdated = $false
    $idUpdated = $false

    for ($index = $selectedStart; $index -lt $selectedEnd; $index++) {
      $line = $lines[$index]
      if ($line -match '(?m)^database_name\s*=\s*"[^"]*"\s*$') {
        $updatedBlockLines.Add("database_name = `"$TargetDatabaseName`"")
        $nameUpdated = $true
        continue
      }
      if ($line -match '(?m)^database_id\s*=\s*"[^"]*"\s*$') {
        $updatedBlockLines.Add("database_id = `"$TargetDatabaseId`"")
        $idUpdated = $true
        continue
      }
      $updatedBlockLines.Add($line)
    }

    if (-not $nameUpdated) {
      $updatedBlockLines.Add("database_name = `"$TargetDatabaseName`"")
    }
    if (-not $idUpdated) {
      $updatedBlockLines.Add("database_id = `"$TargetDatabaseId`"")
    }

    $lines.RemoveRange($selectedStart, $selectedEnd - $selectedStart)
    $lines.InsertRange($selectedStart, $updatedBlockLines)
  }

  $updatedRaw = ($lines -join $newline).TrimEnd() + $newline

  # BOMなしUTF-8で書き戻し（差分を安定化）
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Resolve-Path $TomlPath), $updatedRaw, $utf8NoBom)
}

# 事前チェック
Assert-CommandExists -CommandName "wrangler"

if (-not (Test-Path -Path $DdlPath)) {
  throw "DDLファイルが見つかりません: $DdlPath"
}
if (-not (Test-Path -Path $WranglerTomlPath)) {
  throw "wrangler.toml が見つかりません: $WranglerTomlPath"
}

$envArgs = @()
if ($Environment) {
  # 例: --env staging
  $envArgs += @("--env", $Environment)
}

$executeArgs = @("d1", "execute", $DatabaseName, "--file", $DdlPath) + $envArgs
if ($RemoteExecute) {
  # staging/production などの実環境に適用する場合は --remote を付与する。
  $executeArgs += @("--remote", "-y")
}

if ($DeleteExisting) {
  # 既存DBを削除してから作り直したい場合のみ実行（破壊的）
  try {
    Invoke-Wrangler -CommandArgs (@("d1", "delete", $DatabaseName, "-y") + $envArgs)
  }
  catch {
    Write-Warning "既存DBの削除に失敗しました（未作成の可能性あり）。作成処理を続行します。詳細: $($_.Exception.Message)"
  }
}

# D1作成
Write-Host "> wrangler d1 create $DatabaseName $($envArgs -join ' ')" -ForegroundColor Cyan
$createOutput = (& wrangler d1 create $DatabaseName @envArgs | Out-String)
if ($LASTEXITCODE -ne 0) {
  throw "D1作成に失敗しました。"
}

$databaseId = Get-DatabaseIdFromCreateOutput -Output $createOutput
Write-Host "新しい database_id: $databaseId" -ForegroundColor Green

# wrangler.toml の d1_databases を更新
Update-WranglerTomlD1Binding `
  -TomlPath $WranglerTomlPath `
  -TargetBinding $Binding `
  -TargetDatabaseName $DatabaseName `
  -TargetDatabaseId $databaseId `
  -TargetEnvironment $Environment

# DDL適用
Invoke-Wrangler -CommandArgs $executeArgs

Write-Host "完了: D1作成・DDL適用・wrangler.toml更新が完了しました。" -ForegroundColor Green
Write-Host "更新されたbinding: $Binding" -ForegroundColor Green
Write-Host "更新されたdatabase_name: $DatabaseName" -ForegroundColor Green
Write-Host "更新されたdatabase_id: $databaseId" -ForegroundColor Green
