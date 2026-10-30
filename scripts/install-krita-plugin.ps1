<#
.SYNOPSIS
    Install or update the DSH Krita Bridge plugin in Krita's pykrita folder.

.DESCRIPTION
    Copies dsh-krita/krita-plugin/kritamcp and kritamcp.desktop into
    %APPDATA%\krita\pykrita, then enables the plugin by adding
    [python] enable_kritamcp=true to %LOCALAPPDATA%\kritarc
    (existing INI content is preserved).
    With -Restart, Krita is closed, relaunched and /health is awaited.

    This script is optional: the DSH Host plugin's `setup` action performs the
    same install in JS.

.PARAMETER Restart
    Close and relaunch Krita, then wait for http://127.0.0.1:5678/health.

.PARAMETER KritaExe
    Path to krita.exe. When omitted, checks $env:KRITA_PATH and common install
    locations; pass this explicitly for a custom build.

.PARAMETER HealthTimeoutSeconds
    How long to wait for /health after a restart (default 90).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\install-krita-plugin.ps1 -Restart
#>
[CmdletBinding()]
param(
    [switch]$Restart,
    [string]$KritaExe = '',
    [int]$HealthTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($KritaExe)) {
    $candidates = @(
        $env:KRITA_PATH,
        'C:\Program Files\Krita (x64)\bin\krita.exe',
        'C:\Program Files\Krita\bin\krita.exe',
        'C:\Program Files (x86)\Krita\bin\krita.exe',
        'C:\Program Files\com.tencent.pcgame.krikrita\bin\krita.exe',
        'D:\Program Files\com.tencent.pcgame.krikrita\bin\krita.exe'
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $KritaExe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $KritaExe) { $KritaExe = $candidates[0] }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$pluginSrc = Join-Path $repoRoot 'krita-plugin'
if (-not (Test-Path (Join-Path $pluginSrc 'kritamcp\__init__.py'))) {
    throw "Plugin source not found at $pluginSrc (run this script from dsh-krita\scripts)."
}

$pykrita = Join-Path $env:APPDATA 'krita\pykrita'
New-Item -ItemType Directory -Force -Path $pykrita | Out-Null
Remove-Item (Join-Path $pykrita 'kritamcp') -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $pykrita -Recurse -Directory -Filter '__pycache__' -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path (Join-Path $pluginSrc 'kritamcp') -Destination $pykrita -Recurse -Force
Copy-Item -Path (Join-Path $pluginSrc 'kritamcp.desktop') -Destination $pykrita -Force
Write-Host "Installed plugin into $pykrita"

$kritarc = Join-Path $env:LOCALAPPDATA 'kritarc'
if (-not (Test-Path $kritarc)) {
    New-Item -ItemType File -Path $kritarc | Out-Null
}
$content = Get-Content -Path $kritarc -Raw
if ($null -eq $content) { $content = '' }

if ($content -notmatch '(?m)^\[python\]\s*$') {
    $content = $content.TrimEnd() + "`r`n`r`n[python]`r`nenable_kritamcp=true`r`n"
    Set-Content -Path $kritarc -Value $content -NoNewline -Encoding utf8
    Write-Host 'Added [python] enable_kritamcp=true to kritarc'
} elseif ($content -notmatch '(?m)^enable_kritamcp=true\s*$') {
    $content = [regex]::Replace($content, '(?m)^\[python\]\s*$', "[python]`r`nenable_kritamcp=true")
    Set-Content -Path $kritarc -Value $content -NoNewline -Encoding utf8
    Write-Host 'Enabled enable_kritamcp under existing [python] section'
} else {
    Write-Host 'enable_kritamcp already enabled'
}

if (-not $Restart) {
    Write-Host 'Restart Krita (or call the DSH krita tool with action "start") to load the plugin.'
    return
}

if (-not (Test-Path $KritaExe)) {
    throw "Krita executable not found: $KritaExe (pass -KritaExe)."
}
Get-Process krita -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }
Start-Sleep -Seconds 3
Get-Process krita -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Start-Process -FilePath $KritaExe
Write-Host 'Krita launched, waiting for /health ...'

$healthy = $false
for ($i = 0; $i -lt $HealthTimeoutSeconds; $i++) {
    Start-Sleep -Seconds 1
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5678/health' -TimeoutSec 2
        $healthy = $true
        break
    } catch { }
}
if (-not $healthy) {
    throw "Bridge did not answer /health within $HealthTimeoutSeconds seconds. Check Krita's Python plugin log or ~/kritamcp_startup.log."
}
$health | ConvertTo-Json -Compress
Write-Host 'DSH Krita Bridge is healthy.'
