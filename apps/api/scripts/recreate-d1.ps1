[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DatabaseName,

  [string]$Binding = "DB",
  [string]$DdlPath = "database/DDL.sql",
  [string]$WranglerTomlPath = "wrangler.toml",
  [string]$Environment = "",
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

  # 対象環境に応じた d1_databases ブロックを抽出し、指定 binding のブロックを探す
  if ($TargetEnvironment) {
    $headerPattern = '^\[\[env\.' + [regex]::Escape($TargetEnvironment) + '\.d1_databases\]\]'
    $appendHeader = "[[env.$TargetEnvironment.d1_databases]]"
  }
  else {
    $headerPattern = '^\[\[d1_databases\]\]'
    $appendHeader = '[[d1_databases]]'
  }

  $blockPattern = '(?ms)' + $headerPattern + '\s*\r?\n(?:(?!^\[).*(?:\r?\n|$))*'
  $tomlBlocks = [regex]::Matches($raw, $blockPattern)

  $selected = $null
  foreach ($match in $tomlBlocks) {
    if ($match.Value -match ('(?m)^binding\s*=\s*"' + [regex]::Escape($TargetBinding) + '"\s*$')) {
      $selected = $match
      break
    }
  }

  if ($null -eq $selected) {
    # 指定 binding が存在しない場合は末尾に新規追加
    $append = @"

$appendHeader
binding = "$TargetBinding"
database_name = "$TargetDatabaseName"
database_id = "$TargetDatabaseId"
"@
    $updatedRaw = $raw.TrimEnd() + $append + "`n"
  }
  else {
    # 既存 binding がある場合は database_name / database_id のみ更新
    $updatedBlock = $selected.Value

    if ($updatedBlock -match '(?m)^database_name\s*=\s*"[^"]*"\s*$') {
      $updatedBlock = [regex]::Replace(
        $updatedBlock,
        '(?m)^database_name\s*=\s*"[^"]*"\s*$',
        "database_name = `"$TargetDatabaseName`""
      )
    }
    else {
      $updatedBlock = $updatedBlock.TrimEnd() + "`r`ndatabase_name = `"$TargetDatabaseName`"`r`n"
    }

    if ($updatedBlock -match '(?m)^database_id\s*=\s*"[^"]*"\s*$') {
      $updatedBlock = [regex]::Replace(
        $updatedBlock,
        '(?m)^database_id\s*=\s*"[^"]*"\s*$',
        "database_id = `"$TargetDatabaseId`""
      )
    }
    else {
      $updatedBlock = $updatedBlock.TrimEnd() + "`r`ndatabase_id = `"$TargetDatabaseId`"`r`n"
    }

    $updatedRaw = $raw.Substring(0, $selected.Index) + $updatedBlock + $raw.Substring($selected.Index + $selected.Length)
  }

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

if ($DeleteExisting) {
  # 既存DBを削除してから作り直したい場合のみ実行（破壊的）
  try {
    Invoke-Wrangler -CommandArgs (@("d1", "delete", $DatabaseName) + $envArgs)
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
Invoke-Wrangler -CommandArgs (@("d1", "execute", $DatabaseName, "--file", $DdlPath) + $envArgs)

Write-Host "完了: D1作成・DDL適用・wrangler.toml更新が完了しました。" -ForegroundColor Green
Write-Host "更新されたbinding: $Binding" -ForegroundColor Green
Write-Host "更新されたdatabase_name: $DatabaseName" -ForegroundColor Green
Write-Host "更新されたdatabase_id: $databaseId" -ForegroundColor Green
