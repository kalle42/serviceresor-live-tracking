# Schemalagda uppgifter startar utan användarens PATH, så enbart Get-Command räcker
# inte. Kontrollera därför även standardplatserna, inklusive per-användarinstallation
# som NVM och installer skapar.
function Find-NodeExe {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command -and $command.Source) { return $command.Source }

    # Join-Path kastar när basen är null, så varje rot kontrolleras före användning.
    $candidates = @()
    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
        if ($root) { $candidates += Join-Path $root 'nodejs\node.exe' }
        if ($root) { $candidates += Join-Path $root 'Programs\nodejs\node.exe' }
    }
    if ($env:NVM_SYMLINK) { $candidates += Join-Path $env:NVM_SYMLINK 'node.exe' }
    $candidates += 'C:\Program Files\nodejs\node.exe'

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }

    throw 'node.exe hittades inte. Installera Node.js LTS: https://nodejs.org/'
}
