$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:LOCALAPPDATA 'Travel Calculator Suite'
$source = Join-Path $PSScriptRoot 'Travel Calculator Suite.hta'
$target = Join-Path $installRoot 'Travel Calculator Suite.hta'
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Travel Calculator Suite.lnk'

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Copy-Item -LiteralPath $source -Destination $target -Force

$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut($startMenu)
$shortcut.TargetPath = "$env:WINDIR\System32\mshta.exe"
$shortcut.Arguments = '"' + $target + '"'
$shortcut.WorkingDirectory = $installRoot
$shortcut.Description = 'Travel Calculator Suite'
$shortcut.Save()

Write-Host "Installed to $target"
Write-Host "Start Menu shortcut created at $startMenu"
