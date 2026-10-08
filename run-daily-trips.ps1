$project = $PSScriptRoot
$node = 'C:\Program Files\nodejs\node.exe'
$mutex = New-Object System.Threading.Mutex($false, 'FardtjanstDailyTrips')

try {
    $hasMutex = $mutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
    $hasMutex = $true
}

if (-not $hasMutex) {
    $mutex.Dispose()
    exit 0
}

try {
    Set-Location -LiteralPath $project
    $process = Start-Process -FilePath $node `
        -ArgumentList '.\tracking-service.js' `
        -WorkingDirectory $project `
        -RedirectStandardOutput (Join-Path $project 'daily-trips.log') `
        -RedirectStandardError (Join-Path $project 'daily-trips-error.log') `
        -NoNewWindow `
        -Wait `
        -PassThru
    if ($process.ExitCode -ne 0) {
        exit $process.ExitCode
    }

    $plan = Get-Content -Raw -LiteralPath (Join-Path $project 'todays-trips.json') | ConvertFrom-Json
    Get-ScheduledTask -TaskName 'Fardtjanst-trip-*' -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false

    foreach ($userPlan in $plan.users) {
      foreach ($trip in $userPlan.trips) {
        $startAt = Get-Date
        $startAt = $startAt.Date.AddMinutes([int]$trip.minutes - 10)
        if ($startAt -le (Get-Date)) {
            continue
        }

        $taskName = "Fardtjanst-trip-$($plan.date)-$($userPlan.userId)-$($trip.time.Replace(':', ''))"
        $runner = Join-Path $project 'run-track-trip.ps1'
        $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`" -UserId `"$($userPlan.userId)`" -Url `"$($trip.url)`" -Time `"$($trip.time)`" -Minutes $($trip.minutes)"
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
        $trigger = New-ScheduledTaskTrigger -Once -At $startAt
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 3)
        $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Tracks the $($trip.time) trip from ten minutes before departure." -Force | Out-Null

        $checkAt = (Get-Date).Date.AddMinutes([int]$trip.minutes - 60)
        if ($checkAt -gt (Get-Date)) {
            $checkTaskName = "Fardtjanst-trip-check-$($plan.date)-$($userPlan.userId)-$($trip.time.Replace(':', ''))"
            $checkRunner = Join-Path $project 'run-check-trip.ps1'
            $checkArguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$checkRunner`" -UserId `"$($userPlan.userId)`" -Url `"$($trip.url)`" -Time `"$($trip.time)`" -TrackingTaskName `"$taskName`""
            $checkAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $checkArguments
            $checkTrigger = New-ScheduledTaskTrigger -Once -At $checkAt
            $checkSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
            Register-ScheduledTask -TaskName $checkTaskName -Action $checkAction -Trigger $checkTrigger -Settings $checkSettings -Principal $principal -Description "Checks whether the $($trip.time) trip is still booked one hour before departure." -Force | Out-Null
        }
      }
    }
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
