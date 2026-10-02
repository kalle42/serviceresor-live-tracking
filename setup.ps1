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

function Set-UserEnvironment([string]$Name, [string]$Value) {
    if ($Value) {
        [Environment]::SetEnvironmentVariable($Name, $Value, 'User')
        Write-Host "Konfigurerade $Name"
    }
}

if (-not (Test-Path -LiteralPath $Project -PathType Container)) {
    throw "Projektmappen finns inte: $Project"
}

Set-Location -LiteralPath $Project
Require-Command 'node.exe' 'https://nodejs.org/'
Require-Command 'npm.cmd' 'https://nodejs.org/'
Require-Command 'powershell.exe' 'Windows PowerShell'
Require-Command 'dotnet.exe' 'https://dotnet.microsoft.com/download'

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
dotnet publish (Join-Path $Project 'tray\ServiceresorTray.csproj') -c Release -r win-x64 --self-contained true

if (-not $AdminPassword) { $AdminPassword = $env:ADMIN_DASHBOARD_PASSWORD }
if (-not $AdminPassword) {
    $securePassword = Read-Host 'Ange lokalt adminlösenord' -AsSecureString
    $AdminPassword = [System.Net.NetworkCredential]::new('', $securePassword).Password
}
if ($AdminPassword.Length -lt 12) {
    throw 'Adminlösenordet måste ha minst 12 tecken.'
}
Set-UserEnvironment 'ADMIN_DASHBOARD_PASSWORD' $AdminPassword

$gitBash = 'C:\Program Files\Git\bin\bash.exe'
if (Test-Path -LiteralPath $gitBash) {
    Set-UserEnvironment 'GIT_BASH_PATH' $gitBash
}

if (-not $SkipTasks) {
    & (Join-Path $Project 'install-scheduled-task.ps1') -Project $Project
    & (Join-Path $Project 'install-admin-task.ps1') -Project $Project
    & (Join-Path $Project 'setup-tray.ps1') -Project $Project
}

Write-Host ''
Write-Host 'Installationen är klar.' -ForegroundColor Green
Write-Host '1. Fyll i users.local.json med riktiga Serviceresor-uppgifter.'
Write-Host '2. Konfigurera HERENOW_API_KEY eller %USERPROFILE%\.herenow\credentials.'
Write-Host '3. Konfigurera HERENOW_PUBLISH_SCRIPT och önskade leveranskanaler.'
Write-Host '4. Öppna http://127.0.0.1:8787 för adminpanelen.'
