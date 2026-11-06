[CmdletBinding()]
param(
    [string]$Project = $PSScriptRoot,
    [string]$AdminPassword,
    [switch]$SkipTasks
)

$ErrorActionPreference = 'Stop'

function Require-Command([string]$Name, [string]$InstallHint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name saknas. Installera först: $InstallHint"
    }
}

function Set-LocalEnvironmentValue([string]$Name, [string]$Value) {
    if (-not $Value) { return }
    $file = Join-Path $Project '.env.local.json'
    $values = if (Test-Path -LiteralPath $file) {
        Get-Content -Raw -LiteralPath $file | ConvertFrom-Json
    } else {
        [PSCustomObject]@{}
    }
    $values | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
    $values | ConvertTo-Json | Set-Content -LiteralPath $file -Encoding UTF8
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
    Write-Host "Sparade $Name lokalt"
}

if (-not (Test-Path -LiteralPath $Project -PathType Container)) {
    throw "Projektmappen finns inte: $Project"
}

Set-Location -LiteralPath $Project
$localEnvironmentFile = Join-Path $Project '.env.local.json'
if (Test-Path -LiteralPath $localEnvironmentFile) {
    $localValues = Get-Content -Raw -LiteralPath $localEnvironmentFile | ConvertFrom-Json
    foreach ($property in $localValues.PSObject.Properties) {
        if ($property.Value -and -not [Environment]::GetEnvironmentVariable($property.Name, 'Process')) {
            [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process')
        }
    }
}
Require-Command 'npm.cmd' 'https://nodejs.org/'
Require-Command 'powershell.exe' 'Windows PowerShell'
Require-Command 'dotnet.exe' 'https://dotnet.microsoft.com/download'
# node kontrolleras via samma uppslagning som de schemalagda uppgifterna använder,
# så att installationen inte godkänner en sökväg som sedan inte hittas av en uppgift.
. (Join-Path $PSScriptRoot 'find-node.ps1')
$nodeExe = Find-NodeExe
Write-Host "Node hittades: $nodeExe"
# jq installeras inte längre: here-now\bin\jq följer med paketet.

# Chrome hittas av resolveChrome i local-env.js. Kontrollera här så att felet syns
# under installationen i stället för vid första resan.
$chrome = & $nodeExe -e "console.log(require('./local-env').resolveChrome())" 2>$null
if ($LASTEXITCODE -ne 0 -or -not $chrome) { throw 'Google Chrome kunde inte hittas automatiskt.' }
Write-Host "Chrome hittades: $chrome"

if (-not (Test-Path -LiteralPath 'users.local.json')) {
    Copy-Item -LiteralPath 'users.example.json' -Destination 'users.local.json'
    Write-Host 'Skapade users.local.json från exempelkonfigurationen.' -ForegroundColor Yellow
} else {
    Write-Host 'Behåller befintlig users.local.json.'
}

if (-not (Test-Path -LiteralPath 'node_modules')) {
    Write-Host 'Installerar Node-beroenden...'
    npm install
} else {
    Write-Host 'Node-beroenden är redan installerade.'
}

Write-Host 'Bygger tray-ikon...'
$trayInstallDir = Join-Path $env:LOCALAPPDATA 'Serviceresor'
$trayArtifacts = Join-Path $env:TEMP 'ServiceresorTrayArtifacts'
if (-not (Test-Path -LiteralPath $env:LOCALAPPDATA)) { throw 'LOCALAPPDATA hittades inte.' }
New-Item -ItemType Directory -Path $trayInstallDir -Force | Out-Null
dotnet publish (Join-Path $Project 'tray\ServiceresorTray.csproj') -c Release -r win-x64 --self-contained true --artifacts-path $trayArtifacts -o $trayInstallDir

if (-not $AdminPassword) { $AdminPassword = $env:ADMIN_DASHBOARD_PASSWORD }
if (-not $AdminPassword) {
    $securePassword = Read-Host 'Ange lokalt adminlösenord' -AsSecureString
    $AdminPassword = [System.Net.NetworkCredential]::new('', $securePassword).Password
}
if ($AdminPassword.Length -lt 12) {
    throw 'Adminlösenordet måste ha minst 12 tecken.'
}
Set-LocalEnvironmentValue 'ADMIN_DASHBOARD_PASSWORD' $AdminPassword

# Git Bash hittas automatiskt av local-env.js vid varje körning. Här kontrolleras
# bara att den finns, så att felet syns under installationen i stället för vid
# första resan. Ingen sökväg skrivs till .env.local.json.
$gitBash = & $nodeExe -e "console.log(require('./local-env').resolveGitBash())" 2>$null
if ($LASTEXITCODE -ne 0 -or -not $gitBash) { throw 'Git Bash kunde inte hittas automatiskt.' }
Write-Host "Git Bash hittades: $gitBash"

# publish.sh hittas automatiskt av local-env.js vid varje körning. Här kontrolleras
# bara att den finns, så att felet syns under installationen i stället för vid
# första resan. Ingen sökväg skrivs till .env.local.json.
$publisherCandidates = @(
    (Join-Path $Project 'here-now\scripts\publish.sh'),
    $env:HERENOW_PUBLISH_SCRIPT,
    (Join-Path $HOME '.agents\skills\here-now\scripts\publish.sh'),
    (Join-Path $HOME '.claude\skills\here-now\scripts\publish.sh'),
    (Join-Path $HOME '.config\opencode\skills\here-now\scripts\publish.sh')
)
$publisher = $publisherCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $publisher) {
    Write-Host 'Installerar here.now-skillen automatiskt...'
    npx.cmd --yes skills add heredotnow/skill --skill here-now -g
    $publisher = $publisherCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
}
if (-not $publisher) { throw 'publish.sh kunde inte hittas automatiskt.' }
Write-Host "publish.sh hittades: $publisher"
$bundledJq = Join-Path $Project 'here-now\bin\jq'
if (-not (Test-Path -LiteralPath $bundledJq)) {
    throw "jq saknas i paketet: $bundledJq. Installera om med det medföljande installationsprogrammet."
}

if (-not $SkipTasks) {
    & (Join-Path $Project 'install-scheduled-task.ps1') -Project $Project
    & (Join-Path $Project 'install-admin-task.ps1') -Project $Project
    & (Join-Path $Project 'setup-tray-app.ps1') -Project $Project
}

Write-Host ''
Write-Host 'Installationen är klar.' -ForegroundColor Green
Write-Host '1. Fyll i users.local.json med riktiga Serviceresor-uppgifter.'
Write-Host '2. Konfigurera HERENOW_API_KEY eller %USERPROFILE%\.herenow\credentials.'
Write-Host '3. Konfigurera önskade leveranskanaler i adminpanelen (API & nycklar).'
Write-Host '4. Öppna http://127.0.0.1:8787 för adminpanelen.'
