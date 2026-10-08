param(
    [string]$Project = $PSScriptRoot
)

$taskName = 'Serviceresor daily planner'
$runner = Join-Path $Project 'run-daily-trips.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -Daily -At '01:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -DisallowStartIfOnBatteries:$false -StopIfGoingOnBatteries:$false -ExecutionTimeLimit (New-TimeSpan -Hours 23) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Reads todays Serviceresor trips and schedules isolated tracking sessions.' -Force | Out-Null
Write-Output "Installed: $taskName"
