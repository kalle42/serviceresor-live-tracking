$project = $PSScriptRoot
. (Join-Path $PSScriptRoot 'find-node.ps1')
$node = Find-NodeExe

Set-Location -LiteralPath $project
& $node '.\admin-server.js'
exit $LASTEXITCODE
