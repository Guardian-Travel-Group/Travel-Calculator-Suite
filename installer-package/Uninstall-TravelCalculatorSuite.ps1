$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:LOCALAPPDATA 'Travel Calculator Suite'
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Travel Calculator Suite.lnk'

Remove-Item -LiteralPath $startMenu -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'Travel Calculator Suite removed.'
