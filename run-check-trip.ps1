param(
    [Parameter(Mandatory = $true)][string]$UserId,
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Time,
    [Parameter(Mandatory = $true)][string]$TrackingTaskName
)

$project = $PSScriptRoot
$node = 'C:\Program Files\nodejs\node.exe'
$logTime = $Time.Replace(':', '')
$process = Start-Process -FilePath $node `
    -ArgumentList @('.\tracking-service.js', 'check', $UserId, $Url, $Time) `
    -WorkingDirectory $project `
    -RedirectStandardOutput (Join-Path $project "trip-$logTime-status.log") `
    -RedirectStandardError (Join-Path $project "trip-$logTime-status-error.log") `
    -NoNewWindow `
    -Wait `
    -PassThru

if ($process.ExitCode -eq 10) {
    Unregister-ScheduledTask -TaskName $TrackingTaskName -Confirm:$false -ErrorAction SilentlyContinue
    exit 0
}

exit $process.ExitCode
