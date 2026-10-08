param(
    [string]$Project = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$name = 'ServiceresorTray'
$exe = Join-Path $Project 'tray\bin\Release\net8.0-windows\win-x64\publish\ServiceresorTray.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    throw "Tray-appens exe hittades inte: $exe"
}

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (-not (Test-Path -LiteralPath $runKey)) {
    New-Item -Path $runKey -Force | Out-Null
}
Set-ItemProperty -LiteralPath $runKey -Name $name -Value "`"$exe`""
Write-Output "Installerade autostart: $name"
