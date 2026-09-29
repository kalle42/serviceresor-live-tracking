[CmdletBinding()]
param(
    [string]$Project = $PSScriptRoot,
    [string]$AdminPassword,
    [switch]$SkipTasks
)

$ErrorActionPreference = 'Stop'

function Require-Command([string]$Name, [string]$InstallHint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name was not found. Install it first: $InstallHint"
    }
}

function Set-UserEnvironment([string]$Name, [string]$Value) {
    if ($Value) {
        [Environment]::SetEnvironmentVariable($Name, $Value, 'User')
        Write-Host "Configured $Name"
    }
}

if (-not (Test-Path -LiteralPath $Project -PathType Container)) {
    throw "Project directory does not exist: $Project"
}

Set-Location -LiteralPath $Project
Require-Command 'node.exe' 'https://nodejs.org/'
Require-Command 'npm.cmd' 'https://nodejs.org/'
Require-Command 'powershell.exe' 'Windows PowerShell'

$chromePaths = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
)
if (-not ($chromePaths | Where-Object { Test-Path -LiteralPath $_ })) {
    throw 'Google Chrome was not found. Install it before running the tracker.'
}

if (-not (Test-Path -LiteralPath 'users.local.json')) {
    Copy-Item -LiteralPath 'users.example.json' -Destination 'users.local.json'
    Write-Host 'Created users.local.json from users.example.json. Fill in credentials and recipients before use.' -ForegroundColor Yellow
} else {
    Write-Host 'Keeping existing users.local.json.'
}

if (-not (Test-Path -LiteralPath 'node_modules')) {
    Write-Host 'Installing Node dependencies...'
    npm install
} else {
    Write-Host 'Node dependencies already installed.'
}

if (-not $AdminPassword) {
    $securePassword = Read-Host 'Enter a local admin dashboard password' -AsSecureString
    $AdminPassword = [System.Net.NetworkCredential]::new('', $securePassword).Password
}
if ($AdminPassword.Length -lt 12) {
    throw 'Admin dashboard password must contain at least 12 characters.'
}
Set-UserEnvironment 'ADMIN_DASHBOARD_PASSWORD' $AdminPassword

$gitBash = 'C:\Program Files\Git\bin\bash.exe'
if (Test-Path -LiteralPath $gitBash) {
    Set-UserEnvironment 'GIT_BASH_PATH' $gitBash
}

if (-not $SkipTasks) {
    & (Join-Path $Project 'install-scheduled-task.ps1') -Project $Project
    & (Join-Path $Project 'install-admin-task.ps1') -Project $Project
}

Write-Host ''
Write-Host 'Installation complete.' -ForegroundColor Green
Write-Host '1. Edit users.local.json with real Serviceresor credentials.'
Write-Host '2. Configure HERENOW_API_KEY or %USERPROFILE%\.herenow\credentials.'
Write-Host '3. Configure HERENOW_PUBLISH_SCRIPT, ELKS_API_USERNAME/ELKS_API_PASSWORD, and optional TextBee/ntfy settings.'
Write-Host '4. Open http://127.0.0.1:8787 after the admin task starts.'
