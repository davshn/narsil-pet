# Prints 1 when an Edge process of Narsil's private profile runs, else 0.
$profileDir = $env:NARSIL_PROFILE
if (-not $profileDir) { Write-Output 0; exit 0 }
$found = Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileDir) } |
  Select-Object -First 1
if ($found) { Write-Output 1 } else { Write-Output 0 }
