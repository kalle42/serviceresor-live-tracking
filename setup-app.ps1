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
Require-Command 'node.exe' 'https://nodejs.org/'
Require-Command 'npm.cmd' 'https://nodejs.org/'
Require-Command 'powershell.exe' 'Windows PowerShell'
Require-Command 'dotnet.exe' 'https://dotnet.microsoft.com/download'
Require-Command 'git.exe' 'https://git-scm.com/download/win'
Require-Command 'jq.exe' 'winget install jqlang.jq'

$chromePaths = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
)
if (-not ($chromePaths | Where-Object { Test-Path -LiteralPath $_ })) {
    throw 'Google Chrome hittades inte.'
}

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

$gitBashCandidates = @(
    $env:GIT_BASH_PATH,
    'C:\Program Files\Git\bin\bash.exe',
    'C:\Program Files (x86)\Git\bin\bash.exe'
)
$gitBash = $gitBashCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $gitBash) { throw 'Git Bash kunde inte hittas automatiskt.' }
Set-LocalEnvironmentValue 'GIT_BASH_PATH' $gitBash

$publisherCandidates = @(
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
Set-LocalEnvironmentValue 'HERENOW_PUBLISH_SCRIPT' $publisher

if (-not $SkipTasks) {
    & (Join-Path $Project 'install-scheduled-task.ps1') -Project $Project
    & (Join-Path $Project 'install-admin-task.ps1') -Project $Project
    & (Join-Path $Project 'setup-tray-app.ps1') -Project $Project
}

Write-Host ''
Write-Host 'Installationen är klar.' -ForegroundColor Green
Write-Host '1. Fyll i users.local.json med riktiga Serviceresor-uppgifter.'
Write-Host '2. Konfigurera HERENOW_API_KEY eller %USERPROFILE%\.herenow\credentials.'
Write-Host '3. Konfigurera HERENOW_PUBLISH_SCRIPT och önskade leveranskanaler.'
Write-Host '4. Öppna http://127.0.0.1:8787 för adminpanelen.'
