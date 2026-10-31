# Prepares Narsil's art: for each assets/raw/<pose>-<claro|oscuro>.png (or
# .webp, .jpg), and the same in assets/raw/etapa2 to etapa5 for each later
# stage of her growth, it removes the plain background (white or transparent,
# from the edges in, plus any fake "transparency" checkerboard an image
# generator painted), crops to the character, scales it down, saves
# assets/[etapa<N>/]<pose>-<theme>.png and writes hooks/art.ts and hooks/art, which embed
# them all for the hooks module.
#   powershell -ExecutionPolicy Bypass -File tools/build-art.ps1
param([int]$Height = 150)

$root = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName PresentationCore
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class Cutout {
  // A background pixel: (nearly) transparent, or white with no color in it.
  static bool IsBackground(int argb) {
    int a = (argb >> 24) & 255, r = (argb >> 16) & 255, g = (argb >> 8) & 255, b = argb & 255;
    if (a < 25) return true;
    int max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b));
    return min >= 236 && max - min <= 12;
  }

  // A light grey line along the picture's edge, a frame an image generator
  // drew: background too, though not white.
  static bool IsFrame(int argb) {
    int r = (argb >> 16) & 255, g = (argb >> 8) & 255, b = argb & 255;
    int max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b));
    return min >= 200 && max - min <= 12;
  }

  // The kinds of square a painted checkerboard alternates: 1 clear,
  // 2 a plain light grey, 3 a plain white; 0 is anything else.
  static int CheckerKind(int argb) {
    if (((argb >> 24) & 255) < 25) return 1;
    int r = (argb >> 16) & 255, g = (argb >> 8) & 255, b = argb & 255;
    int max = Math.Max(r, Math.Max(g, b)), min = Math.Min(r, Math.Min(g, b));
    if (max - min > 8) return 0;
    if (min >= 245) return 3;
    return min >= 185 && max <= 240 ? 2 : 0;
  }

  public static Bitmap Process(Bitmap src, int height) {
    var bmp = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(bmp)) g.DrawImage(src, 0, 0, src.Width, src.Height);
    int w = bmp.Width, h = bmp.Height;
    var rect = new Rectangle(0, 0, w, h);
    var bits = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    var px = new int[w * h];
    Marshal.Copy(bits.Scan0, px, 0, px.Length);

    // Flood the background from every edge pixel, so white inside the
    // character (its belly, the foam) is kept.
    var gone = new bool[w * h];
    var queue = new Queue<int>();
    for (int x = 0; x < w; x++) { queue.Enqueue(x); queue.Enqueue((h - 1) * w + x); }
    for (int y = 0; y < h; y++) { queue.Enqueue(y * w); queue.Enqueue(y * w + w - 1); }
    while (queue.Count > 0) {
      int i = queue.Dequeue();
      if (gone[i]) continue;
      int x = i % w, y = i / w;
      bool onFrame = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
      if (!IsBackground(px[i]) && !(onFrame && IsFrame(px[i]))) continue;
      gone[i] = true;
      if (x > 0) queue.Enqueue(i - 1);
      if (x < w - 1) queue.Enqueue(i + 1);
      if (y > 0) queue.Enqueue(i - w);
      if (y < h - 1) queue.Enqueue(i + w);
    }

    // Background shut in by the character (the hole of a coiled tail) is cut
    // too: a large closed patch of nearly pure white. Her own pale body
    // carries shading and tints, so its white patches are small or mixed.
    var shut = new bool[w * h];
    for (int start = 0; start < px.Length; start++) {
      if (gone[start] || shut[start] || !IsBackground(px[start])) continue;
      var patch = new List<int>();
      int pure = 0;
      queue.Enqueue(start);
      shut[start] = true;
      while (queue.Count > 0) {
        int i = queue.Dequeue();
        patch.Add(i);
        int r = (px[i] >> 16) & 255, g = (px[i] >> 8) & 255, b = px[i] & 255;
        if (Math.Min(r, Math.Min(g, b)) >= 248) pure++;
        int x = i % w, y = i / w;
        foreach (int n in new[] { x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1 }) {
          if (n < 0 || shut[n] || gone[n] || !IsBackground(px[n])) continue;
          shut[n] = true;
          queue.Enqueue(n);
        }
      }
      if (patch.Count >= px.Length / 500 && pure >= patch.Count * 4 / 5) foreach (int i in patch) gone[i] = true;
    }

    // A painted checkerboard can sit inside the character (a hole in the
    // coil): a closed patch that alternates two kinds of square in good
    // measure is one; the character's own whites carry a tint, or are one kind.
    var seen = new bool[w * h];
    for (int start = 0; start < px.Length; start++) {
      if (gone[start] || seen[start] || CheckerKind(px[start]) == 0) continue;
      var patch = new List<int>();
      var kinds = new int[4];
      queue.Enqueue(start);
      seen[start] = true;
      while (queue.Count > 0) {
        int i = queue.Dequeue();
        patch.Add(i);
        kinds[CheckerKind(px[i])]++;
        int x = i % w, y = i / w;
        foreach (int n in new[] { x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1 }) {
          if (n < 0 || seen[n] || gone[n] || CheckerKind(px[n]) == 0) continue;
          seen[n] = true;
          queue.Enqueue(n);
        }
      }
      int fifth = patch.Count / 5, mixed = 0;
      for (int k = 1; k <= 3; k++) if (kinds[k] >= fifth) mixed++;
      if (patch.Count >= 200 && mixed >= 2) foreach (int i in patch) gone[i] = true;
    }

    int minX = w, minY = h, maxX = -1, maxY = -1;
    for (int i = 0; i < px.Length; i++) {
      int x = i % w, y = i / w;
      if (gone[i]) { px[i] = 0; continue; }
      // Soften the rim: a light pixel touching the background fades out.
      bool rim = (x > 0 && gone[i - 1]) || (x < w - 1 && gone[i + 1]) || (y > 0 && gone[i - w]) || (y < h - 1 && gone[i + w]);
      if (rim) {
        int r = (px[i] >> 16) & 255, g = (px[i] >> 8) & 255, b = px[i] & 255, a = (px[i] >> 24) & 255;
        int min = Math.Min(r, Math.Min(g, b));
        if (min > 200) a = Math.Min(a, (int)(255.0 * (255 - min) / 55.0) + 40);
        px[i] = (Math.Min(a, 255) << 24) | (px[i] & 0xFFFFFF);
      }
      if (((px[i] >> 24) & 255) > 20) { minX = Math.Min(minX, x); maxX = Math.Max(maxX, x); minY = Math.Min(minY, y); maxY = Math.Max(maxY, y); }
    }
    Marshal.Copy(px, 0, bits.Scan0, px.Length);
    bmp.UnlockBits(bits);

    // Crop to the character and scale it to the wanted height.
    var crop = new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
    int outW = (int)Math.Round(crop.Width * (double)height / crop.Height);
    var result = new Bitmap(outW, height, PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(result)) {
      g.InterpolationMode = InterpolationMode.HighQualityBicubic;
      g.PixelOffsetMode = PixelOffsetMode.HighQuality;
      g.CompositingMode = CompositingMode.SourceCopy;
      g.DrawImage(bmp, new Rectangle(0, 0, outW, height), crop, GraphicsUnit.Pixel);
    }
    bmp.Dispose();
    return result;
  }
}
'@

# Windows' own codecs (WIC) read PNG, WebP and JPEG alike.
function Read-Image($path) {
  $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create([Uri]$path, 'None', 'OnLoad')
  $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
  $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($decoder.Frames[0]))
  $stream = New-Object System.IO.MemoryStream
  $encoder.Save($stream)
  $stream.Position = 0
  return New-Object System.Drawing.Bitmap $stream
}

# Stage 1 (the hatchling) is assets/raw itself; each later stage of her growth
# has its own folder, assets/raw/etapa<N>, holding the poses drawn for it.
$sources = @(@{ Stage = 1; Dir = 'assets/raw'; Out = 'assets' })
Get-ChildItem (Join-Path $root 'assets/raw') -Directory | Sort-Object Name | ForEach-Object {
  if ($_.Name -notmatch '^etapa([2-9])$') { Write-Warning "Ignored folder $($_.Name): name it etapa2 to etapa5"; return }
  $sources += @{ Stage = [int]$Matches[1]; Dir = "assets/raw/$($_.Name)"; Out = "assets/$($_.Name)" }
}

$stages = @{}
foreach ($source in $sources) {
  $entries = @{}
  New-Item -ItemType Directory -Force (Join-Path $root $source.Out) | Out-Null
  Get-ChildItem (Join-Path $root $source.Dir) -File | Where-Object { $_.Extension -in '.png', '.webp', '.jpg', '.jpeg' } | Sort-Object Name | ForEach-Object {
    if ($_.BaseName -notmatch '^([a-z]+)-(claro|oscuro)$') { Write-Warning "Ignored $($source.Dir)/$($_.Name): name it <pose>-claro.png or <pose>-oscuro.png"; return }
    $pose = $Matches[1]; $theme = $Matches[2]
    $image = Read-Image $_.FullName
    # Windows' WebP codec may drop the alpha channel and paint it black.
    $corner = $image.GetPixel(0, 0)
    if ($_.Extension -eq '.webp' -and $corner.A -eq 255 -and $corner.R + $corner.G + $corner.B -lt 10) {
      Write-Warning "$($_.Name): its transparency came out black; convert it to PNG first (open it in a browser and save it as PNG)"
    }
    $art = [Cutout]::Process($image, $Height)
    $image.Dispose()
    $out = Join-Path $root "$($source.Out)/$pose-$theme.png"
    $art.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $data = [Convert]::ToBase64String([IO.File]::ReadAllBytes($out))
    if (-not $entries[$pose]) { $entries[$pose] = @{} }
    $entries[$pose][$theme] = "{ src: 'data:image/png;base64,$data', width: $($art.Width), height: $($art.Height) }"
    "etapa $($source.Stage) $pose-$theme`: $($art.Width)x$($art.Height), $([math]::Round($data.Length / 1024)) KB in base64"
    $art.Dispose()
  }
  if ($entries.Count -gt 0) { $stages[$source.Stage] = $entries }
}

# One file per stage and theme, hooks/art/etapa<N>-<theme>.ts: the engine
# reads no module over 1 MB, and the whole art is past that. hooks/art.ts
# gathers them.
$dir = Join-Path $root 'hooks/art'
New-Item -ItemType Directory -Force $dir | Out-Null
Get-ChildItem $dir -Filter '*.ts' | Remove-Item
$imports = @(); $index = @()
foreach ($stage in ($stages.Keys | Sort-Object)) {
  $entries = $stages[$stage]
  $themes = @()
  foreach ($theme in 'claro', 'oscuro') {
    $poses = @($entries.Keys | Sort-Object | Where-Object { $entries[$_][$theme] })
    if ($poses.Count -eq 0) { continue }
    $name = "etapa$stage-$theme"
    $id = "etapa$stage" + $theme.Substring(0, 1).ToUpper() + $theme.Substring(1)
    $lines = @(
      '// Generated by tools/build-art.ps1 from assets/raw: do not edit by hand.',
      "import type { Art } from '../art'",
      'export const POSES: Record<string, Art> = {'
    )
    foreach ($pose in $poses) { $lines += "  $pose`: $($entries[$pose][$theme])," }
    $lines += '}'
    $file = Join-Path $dir "$name.ts"
    [IO.File]::WriteAllText($file, ($lines -join "`n") + "`n")
    if ((Get-Item $file).Length -gt 1MB) { Write-Warning "hooks/art/$name.ts is over 1 MB, which the engine will not read: lower -Height" }
    $imports += "import { POSES as $id } from './art/$name'"
    $themes += "$theme`: $id"
  }
  $index += "  $stage`: { $($themes -join ', ') },"
}
$lines = @(
  '// Generated by tools/build-art.ps1 from assets/raw: do not edit by hand.',
  'export type Art = { src: string; width: number; height: number }'
) + $imports + @(
  '// By stage of her growth (1 the hatchling), then by theme and pose.',
  'export const ART: Record<number, { claro?: Record<string, Art>; oscuro?: Record<string, Art> }> = {'
) + $index + @('}')
[IO.File]::WriteAllText((Join-Path $root 'hooks/art.ts'), ($lines -join "`n") + "`n")
"wrote hooks/art.ts and hooks/art ($($stages.Count) stages)"
