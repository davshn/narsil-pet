# Prepares what Veo needs to animate Narsil's poses: for each pose shown
# (hola, trabajando, necesita, parada, terminado, error), at each stage and
# theme with no loop in assets/anim yet, her picture from assets/raw on a flat
# pure green (#00FF00) 720 x 1280 canvas, with a margin around her, and the
# prompt to paste with it: <Out>/etapa<N>/<pose>-<theme>.png and .txt.
#   powershell -ExecutionPolicy Bypass -File tools/anim-sources.ps1 [-Stages 4] [-Themes oscuro] [-Out <folder>]
# Then tools/encode-anim.ps1 turns each video into its loop.
param(
  [int[]]$Stages = @(1, 2, 3, 4, 5),
  [string[]]$Themes = @('oscuro', 'claro'),
  [string[]]$Poses = @('hola', 'trabajando', 'necesita', 'parada', 'terminado', 'error'),
  [string]$Out = (Join-Path $env:USERPROFILE 'Downloads\narsil-anim'),
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'ffmpeg.ps1')

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class GreenKey {
  const int GREEN = unchecked((int)0xFF00FF00);
  // The plain background: white with no color in it.
  static bool IsBackground(int argb) {
    int r = (argb >> 16) & 255, g = (argb >> 8) & 255, b = argb & 255;
    int max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b));
    return min >= 228 && max - min <= 16;
  }
  // A hole inside her coils is pure white; her light theme's pale face and
  // belly carry a tint (252,241,249), so they stay.
  static bool IsHole(int argb) {
    int r = (argb >> 16) & 255, g = (argb >> 8) & 255, b = argb & 255;
    int max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b));
    return min >= 250 && max - min <= 5;
  }
  // A light grey frame line an image generator drew: background too, from the edges.
  static bool IsFrame(int argb) {
    int r = (argb >> 16) & 255, g = (argb >> 8) & 255, b = argb & 255;
    int max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b));
    return min >= 150 && max - min <= 14;
  }

  // Paints the background green: from the edges in, and every large enclosed
  // white hole (inside her coils); small white spots (foam, eye glints) stay.
  // Returns her bounds.
  public static Rectangle Run(Bitmap bmp) {
    int w = bmp.Width, h = bmp.Height;
    var rect = new Rectangle(0, 0, w, h);
    var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    var px = new int[w * h];
    Marshal.Copy(data.Scan0, px, 0, px.Length);
    var seen = new bool[w * h];
    var q = new Queue<int>();
    for (int x = 0; x < w; x++) { q.Enqueue(x); q.Enqueue((h - 1) * w + x); }
    for (int y = 0; y < h; y++) { q.Enqueue(y * w); q.Enqueue(y * w + w - 1); }
    while (q.Count > 0) {
      int i = q.Dequeue();
      if (seen[i] || !(IsBackground(px[i]) || IsFrame(px[i]))) continue;
      seen[i] = true; px[i] = GREEN;
      int x = i % w, y = i / w;
      if (x > 0) q.Enqueue(i - 1); if (x < w - 1) q.Enqueue(i + 1);
      if (y > 0) q.Enqueue(i - w); if (y < h - 1) q.Enqueue(i + w);
    }
    var region = new List<int>();
    for (int s = 0; s < px.Length; s++) {
      if (seen[s] || !IsHole(px[s])) continue;
      region.Clear(); q.Enqueue(s);
      while (q.Count > 0) {
        int i = q.Dequeue();
        if (seen[i] || !IsHole(px[i])) continue;
        seen[i] = true; region.Add(i);
        int x = i % w, y = i / w;
        if (x > 0) q.Enqueue(i - 1); if (x < w - 1) q.Enqueue(i + 1);
        if (y > 0) q.Enqueue(i - w); if (y < h - 1) q.Enqueue(i + w);
      }
      if (region.Count > w * h / 600) foreach (int i in region) px[i] = GREEN;
    }
    int x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (int i = 0; i < px.Length; i++) {
      if (px[i] == GREEN) continue;
      int x = i % w, y = i / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    Marshal.Copy(px, 0, data.Scan0, px.Length);
    bmp.UnlockBits(data);
    return new Rectangle(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }
}
'@

# What she does in each pose's loop: clear motion of her body, head and fins,
# while the water stays calm (its churn costs the band's loop its sharpness);
# she keeps her pose and place, so the loop closes on her picture (Flow: first
# and last frame); the sleeping one keeps her eyes shut (S4).
$motion = @{
  hola       = "her 'greeting' state: she happily nods her head toward the viewer twice, her body sways side to side in a cheerful S-shaped wave, her fins and crest wave"
  trabajando = "her 'focused, working' state: she concentrates with a determined look and blinks, her coiled body undulates in a steady rhythmic wave like she is busy, her fins flutter, any details on her body glow and pulse"
  necesita   = "her 'waiting for you' state: she leans toward the viewer expectantly, tilts her head curiously to one side and back, blinks, and her body sways in a gentle wave while her fins flutter"
  parada     = "her 'asleep' state: her eyes stay CLOSED the whole time, she never opens them or blinks; she breathes slowly and deeply with her whole body rising and falling, her head bobs softly as she dozes, her fins drift, and small bubbles float up"
  terminado  = "her 'job done' state: she is proud and joyful, does a happy little wiggle of her whole body, bobs her head, her fins and crest flap with delight"
  error      = "her 'something went wrong' state: she keeps her worried expression, flinches back a little and shivers, shakes her head slightly, her fins droop and tremble"
}

function Get-Prompt([string]$pose) {
  "Create a SILENT video from this image: no audio at all, no music, no sound effects, no water sounds. " +
  "Animate this exact character as a seamless loop of $($motion[$pose]). " +
  'Her motion is clear and smooth, the water at her base stays calm and nearly still, and she ends exactly as she started. ' +
  'Keep the character identical in design, colors, expression, pose, size and position; the whole character stays fully visible with the green margin around her, never cropped. ' +
  'Static locked camera, no zoom, no pan, no cuts. ' +
  'Keep the background the exact same flat pure green (#00FF00), uniform, no shadows, no gradients, no lighting changes. ' +
  'The last frame must match the first frame so it loops perfectly. No text.'
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) "narsil-anim-$PID.png"
$made = 0
foreach ($stage in $Stages) {
  foreach ($theme in $Themes) {
    foreach ($pose in $Poses) {
      $sub = if ($stage -gt 1) { "etapa$stage" } else { '' }
      $done = Join-Path $root "assets\anim\$(if ($sub) { "$sub\" })$pose-$theme.webp"
      if ((Test-Path $done) -and -not $Force) { continue }
      $raw = Get-ChildItem (Join-Path $root "assets\raw\$sub") -File -Filter "$pose-$theme.*" -ErrorAction SilentlyContinue | Select-Object -First 1
      if (-not $raw) { Write-Warning "no picture for etapa$stage $pose-$theme"; continue }
      & $FFMPEG -v error -y -i $raw.FullName -frames:v 1 -pix_fmt rgb24 $tmp
      $loaded = [Drawing.Bitmap]::FromFile($tmp)
      $art = New-Object Drawing.Bitmap $loaded
      $loaded.Dispose()
      $bounds = [GreenKey]::Run($art)
      $her = $art.Clone($bounds, $art.PixelFormat)
      $art.Dispose()
      $canvas = New-Object Drawing.Bitmap 720, 1280
      $g = [Drawing.Graphics]::FromImage($canvas)
      $g.Clear([Drawing.Color]::FromArgb(0, 255, 0))
      $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      # She fills 62 % of the height, or 80 % of the width when she is wide.
      $scale = [Math]::Min(1280 * 0.62 / $her.Height, 720 * 0.8 / $her.Width)
      $tw = [int]($her.Width * $scale); $th = [int]($her.Height * $scale)
      $g.DrawImage($her, [int]((720 - $tw) / 2), [int]((1280 - $th) / 2), $tw, $th)
      $dir = Join-Path $Out "etapa$stage"
      New-Item -ItemType Directory -Force $dir | Out-Null
      $canvas.Save((Join-Path $dir "$pose-$theme.png"), [Drawing.Imaging.ImageFormat]::Png)
      $g.Dispose(); $canvas.Dispose(); $her.Dispose()
      [IO.File]::WriteAllText((Join-Path $dir "$pose-$theme.txt"), (Get-Prompt $pose), (New-Object Text.UTF8Encoding $false))
      $made++
    }
  }
}
Remove-Item $tmp -ErrorAction SilentlyContinue
Write-Output "$made sources in $Out"
