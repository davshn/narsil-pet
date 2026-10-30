# Narsil's window keeper. Every 400 ms it tells the overlay server whether the
# Claude window is minimized, in front or behind, and carries out what the
# server answers: show or hide Narsil's window, or open a conversation.
# It exits once the server stops answering.
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NarsilWin {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
'@

$port = $env:NARSIL_PORT
$width = 330
$height = 390
$client = New-Object System.Net.WebClient
$client.Encoding = [System.Text.Encoding]::UTF8
$claude = [IntPtr]::Zero
$narsil = [IntPtr]::Zero
$misses = 0

# Optional trace for debugging: set NARSIL_LOG to a file path.
function Trace($text) {
  if ($env:NARSIL_LOG) { Add-Content -Path $env:NARSIL_LOG -Value "$(Get-Date -Format HH:mm:ss.fff) $text" }
}

function Find-Window($processName, $title) {
  $p = Get-Process $processName -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq $title } |
    Select-Object -First 1
  if ($p) { return $p.MainWindowHandle }
  return [IntPtr]::Zero
}

while ($true) {
  if (-not [NarsilWin]::IsWindow($claude)) { $claude = Find-Window 'claude' 'Claude' }
  # A hidden window is no process's main window: keep the handle once found.
  if (-not [NarsilWin]::IsWindow($narsil)) { $narsil = Find-Window 'msedge' 'Narsil' }

  $state = 'gone'
  if ($claude -ne [IntPtr]::Zero) {
    if ([NarsilWin]::IsIconic($claude) -or -not [NarsilWin]::IsWindowVisible($claude)) { $state = 'min' }
    elseif ([NarsilWin]::GetForegroundWindow() -eq $claude) { $state = 'fg' }
    else { $state = 'bg' }
  }

  try {
    $client.Headers['x-narsil-token'] = $env:NARSIL_TOKEN
    $answer = $client.DownloadString("http://127.0.0.1:$port/tick?claude=$state&window=$([int]($narsil -ne [IntPtr]::Zero))")
    $misses = 0
  } catch {
    $misses++
    if ($misses -ge 5) { exit 0 }
    Start-Sleep -Milliseconds 400
    continue
  }

  foreach ($line in ($answer -split "`n")) {
    $line = $line.Trim()
    if ($line) { Trace "claude=$state narsil=$narsil -> $line" }
    if ($line -eq 'show' -and $narsil -ne [IntPtr]::Zero) {
      $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
      # HWND_TOPMOST; SWP_SHOWWINDOW | SWP_NOACTIVATE: on top, without stealing focus
      [NarsilWin]::SetWindowPos($narsil, [IntPtr](-1), $area.Right - $width - 16, $area.Bottom - $height - 16, $width, $height, 0x50) | Out-Null
    } elseif ($line -eq 'hide' -and $narsil -ne [IntPtr]::Zero) {
      [NarsilWin]::ShowWindow($narsil, 0) | Out-Null
    } elseif ($line.StartsWith('open ')) {
      $url = $line.Substring(5)
      # Only ever a Claude Code conversation link, checked by the server too.
      if ($url -match '^claude://code/continue\?session=local_[A-Za-z0-9-]{1,64}&source=desktop_action$') {
        if ($claude -ne [IntPtr]::Zero) {
          if ([NarsilWin]::IsIconic($claude)) { [NarsilWin]::ShowWindow($claude, 9) | Out-Null }
          [NarsilWin]::SetForegroundWindow($claude) | Out-Null
        }
        Start-Process $url
      }
    }
  }
  Start-Sleep -Milliseconds 400
}
