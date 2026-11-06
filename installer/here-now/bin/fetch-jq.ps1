# jq är en binär och hör inte hemma i git. Hämtas vid bygget i stället, med
# samma version som publish.sh är testad mot.
[CmdletBinding()]
param(
    [string]$Destination
)

$ErrorActionPreference = 'Stop'
if (-not $Destination) { $Destination = Join-Path $PSScriptRoot 'jq' }
if (Test-Path -LiteralPath $Destination) {
    Write-Host "jq finns redan: $Destination"
    exit 0
}

$url = 'https://github.com/jqlang/jq/releases/download/jq-1.8.2/jq-windows-amd64.exe'
Write-Host "Hämtar jq från $url"
Invoke-WebRequest -Uri $url -OutFile $Destination -UseBasicParsing

$hash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
Write-Host "jq hämtad ($hash)"
