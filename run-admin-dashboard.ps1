$project = $PSScriptRoot
$node = 'C:\Program Files\nodejs\node.exe'

Set-Location -LiteralPath $project
& $node '.\admin-server.js'
