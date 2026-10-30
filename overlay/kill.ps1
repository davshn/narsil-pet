# Closes the Edge processes of Narsil's private profile, and nothing else.
$profileDir = $env:NARSIL_PROFILE
if (-not $profileDir) { exit 0 }
Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileDir) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
