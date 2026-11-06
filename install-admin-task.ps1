param([string]$Project = $PSScriptRoot)

$taskName = 'Serviceresor admin dashboard'
$runner = Join-Path $Project 'run-admin-dashboard.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`""
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn
# Watchdog trigger: re-fires every 5 minutes. Combined with MultipleInstances IgnoreNew
# this only (re)starts the dashboard if it is not already running.
$triggerWatchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 9999)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Days 365) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggerLogon, $triggerWatchdog -Settings $settings -Principal $principal -Description 'Runs the local Serviceresor administration dashboard.' -Force | Out-Null
Write-Output "Installed: $taskName"
