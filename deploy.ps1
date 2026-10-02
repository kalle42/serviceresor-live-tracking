[CmdletBinding()]
param(
    [string]$Project = (Join-Path $HOME 'serviceresor-live-tracking'),
    [string]$Repository = 'https://github.com/kalle42/serviceresor-live-tracking.git',
    [string]$Branch = 'development',
    [switch]$SkipTasks
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
    throw 'Git is required. Install Git for Windows first.'
}

if (Test-Path -LiteralPath (Join-Path $Project '.git')) {
    Push-Location -LiteralPath $Project
    try {
        git fetch origin $Branch
        git pull --ff-only origin $Branch
    } finally {
        Pop-Location
    }
} else {
    $parent = Split-Path -Parent $Project
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    git clone --branch $Branch $Repository $Project
}

$installer = Join-Path $Project 'install.ps1'
if (-not (Test-Path -LiteralPath $installer)) {
    throw "Installer was not found after deployment: $installer"
}

& $installer -Project $Project -SkipTasks:$SkipTasks
Write-Host "Deployment complete: $Project" -ForegroundColor Green
