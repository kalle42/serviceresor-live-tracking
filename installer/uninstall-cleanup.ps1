param(
    [string]$AppFolder
)

$ErrorActionPreference = 'SilentlyContinue'

Get-Process -Name 'ServiceresorTray' | Stop-Process -Force

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -match 'tracking-service\.js|admin-server\.js' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

Get-ScheduledTask |
    Where-Object {
        $_.TaskName -like 'Fardtjanst-trip-*' -or
        $_.TaskName -eq 'Serviceresor daily planner' -or
        $_.TaskName -eq 'Serviceresor admin dashboard'
    } | Unregister-ScheduledTask -Confirm:$false

Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'ServiceresorTray'

$startup = [Environment]::GetFolderPath('Startup')
Remove-Item -LiteralPath (Join-Path $startup 'ServiceresorTray.lnk') -Force
Remove-Item -LiteralPath (Join-Path $env:LOCALAPPDATA 'Serviceresor') -Recurse -Force
Remove-Item -LiteralPath (Join-Path $env:LOCALAPPDATA 'Programs\Serviceresor') -Recurse -Force

if ($AppFolder -and (Test-Path -LiteralPath $AppFolder)) {
    Remove-Item -LiteralPath $AppFolder -Recurse -Force
}
