# Dot-sourced by the animation tools: sets $FFMPEG to ffmpeg, from the PATH or
# where winget installs it (winget install Gyan.FFmpeg).
$FFMPEG = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $FFMPEG) {
  $FFMPEG = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $FFMPEG) { throw 'ffmpeg not found: winget install Gyan.FFmpeg' }
