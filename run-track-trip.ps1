param(
    [Parameter(Mandatory = $true)][string]$UserId,
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Time,
    [Parameter(Mandatory = $true)][int]$Minutes
)

$project = $PSScriptRoot
$node = 'C:\Program Files\nodejs\node.exe'
$logTime = $Time.Replace(':', '')
$mutex = New-Object System.Threading.Mutex($false, "FardtjanstTrip$logTime")

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
    $process = Start-Process -FilePath $node `
        -ArgumentList @('.\daily-trips.js', 'track', $UserId, $Url, $Time, $Minutes) `
        -WorkingDirectory $project `
        -RedirectStandardOutput (Join-Path $project "trip-$logTime.log") `
        -RedirectStandardError (Join-Path $project "trip-$logTime-error.log") `
        -NoNewWindow `
        -Wait `
        -PassThru
    exit $process.ExitCode
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
