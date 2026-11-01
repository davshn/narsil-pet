# Makes the icons of Narsil's phone app (the narsil-pwa repository) from
# assets/raw/hola-claro.png, cut out of its background as tools/build-art.ps1
# cuts the band's art: icon-192.png and icon-512.png, her head on a full
# square the launcher may crop to any shape, and badge.png, the small icon
# Android shows in the status bar.
#   powershell -ExecutionPolicy Bypass -File tools/build-pwa-icons.ps1 [-OutDir ..\narsil-pwa]
param([string]$OutDir)

$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path (Split-Path -Parent $root) 'narsil-pwa' }
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName PresentationCore
# The cutter is build-art.ps1's own, read from it so both cut alike.
$artScript = Get-Content -Raw (Join-Path $root 'tools\build-art.ps1')
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition ([regex]::Match($artScript, "(?s)-TypeDefinition @'\r?\n(.*?)\r?\n'@").Groups[1].Value)

$raw = New-Object System.Drawing.Bitmap (Join-Path $root 'assets\raw\hola-claro.png')
$source = [Cutout]::Process($raw, 1024)
$raw.Dispose()
# Her head and crest, in the cut-out drawing 1024 high.
$head = New-Object System.Drawing.Rectangle 10, 0, 580, 580

function New-Canvas([int]$Size) {
  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  return $bitmap, $g
}

function Save([System.Drawing.Bitmap]$Bitmap, [string]$Name) {
  $out = Join-Path $OutDir $Name
  $Bitmap.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "Wrote $out"
}

# The app icon: the badge's gradient over the whole square, the head inside
# the middle 80% a round or squircle mask keeps.
foreach ($size in 192, 512) {
  $bitmap, $g = New-Canvas $size
  $square = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $fill = New-Object System.Drawing.Drawing2D.LinearGradientBrush $square, ([System.Drawing.Color]::FromArgb(255, 0x3B, 0x4C, 0x9B)), ([System.Drawing.Color]::FromArgb(255, 0x16, 0x18, 0x2A)), 45.0
  $g.FillRectangle($fill, $square)
  $inset = [int]($size * 0.12)
  $g.DrawImage($source, (New-Object System.Drawing.Rectangle $inset, $inset, ($size - 2 * $inset), ($size - 2 * $inset)), $head, [System.Drawing.GraphicsUnit]::Pixel)
  Save $bitmap "icon-$size.png"
  $g.Dispose(); $bitmap.Dispose()
}

# The status bar icon: Android keeps only its alpha and paints it one color,
# so a solid silhouette reads as a blob. Her dark lines (eyes, mouth, the
# edges of her fins) are cut out of it instead, so her face shows through.
$size = 96
$bitmap, $g = New-Canvas $size
$inset = 4
$g.DrawImage($source, (New-Object System.Drawing.Rectangle $inset, $inset, ($size - 2 * $inset), ($size - 2 * $inset)), $head, [System.Drawing.GraphicsUnit]::Pixel)
for ($y = 0; $y -lt $size; $y++) {
  for ($x = 0; $x -lt $size; $x++) {
    $p = $bitmap.GetPixel($x, $y)
    if ($p.A -eq 0) { continue }
    $light = ($p.R + $p.G + $p.B) / 3
    # Below 110 a hole, above 170 solid, a ramp between.
    $keep = [math]::Min(1, [math]::Max(0, ($light - 110) / 60))
    $bitmap.SetPixel($x, $y, [System.Drawing.Color]::FromArgb([int]($p.A * $keep), 255, 255, 255))
  }
}
Save $bitmap 'badge.png'
$g.Dispose(); $bitmap.Dispose(); $source.Dispose()
