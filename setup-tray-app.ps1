param(
    [string]$Project = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$name = 'ServiceresorTray'
$exe = Join-Path (Join-Path $env:LOCALAPPDATA 'Serviceresor') 'ServiceresorTray.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    $exe = Join-Path $Project 'tray\bin\Release\net8.0-windows\win-x64\publish\ServiceresorTray.exe'
}
if (-not (Test-Path -LiteralPath $exe)) {
    throw "Tray-appens exe hittades inte. Bygg den först med setup-app.ps1: $exe"
}

$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup "$name.lnk"
$installed = $false
try {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = Split-Path -Parent $exe
    $shortcut.Description = 'Serviceresor tray'
    $shortcut.Save()
    $installed = $true
    Write-Output "Installerade autostart: $shortcutPath"
} catch {
    Write-Warning "Kunde inte skapa genväg i Startup-mappen: $($_.Exception.Message)"
}

if (-not $installed) {
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    if (-not (Test-Path -LiteralPath $runKey)) {
        New-Item -Path $runKey -Force | Out-Null
    }
    Set-ItemProperty -LiteralPath $runKey -Name $name -Value "`"$exe`""
    Write-Output "Installerade autostart: $runKey\$name"
}
