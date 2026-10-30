# Makes the floating window's icon, overlay/icon.png: Narsil's head from
# assets/raw/hola-claro.png on a round badge, so it reads on a light or a dark
# taskbar. The server serves it as the page's icon, which Edge shows on the
# taskbar for the window.
#   powershell -ExecutionPolicy Bypass -File tools/build-icon.ps1
param([int]$Size = 256)

$root = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.Drawing

$source = [System.Drawing.Bitmap]::FromFile((Join-Path $root 'assets\raw\hola-claro.png'))
# Her head and crest, in the 600 x 1024 drawing.
$head = New-Object System.Drawing.Rectangle 80, 30, 460, 460

$icon = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($icon)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

$badge = New-Object System.Drawing.Rectangle 0, 0, ($Size - 1), ($Size - 1)
$fill = New-Object System.Drawing.Drawing2D.LinearGradientBrush $badge, ([System.Drawing.Color]::FromArgb(255, 0x3B, 0x4C, 0x9B)), ([System.Drawing.Color]::FromArgb(255, 0x16, 0x18, 0x2A)), 45.0
$g.FillEllipse($fill, $badge)

# The head inside the badge, clipped to it.
$clip = New-Object System.Drawing.Drawing2D.GraphicsPath
$clip.AddEllipse($badge)
$g.SetClip($clip)
$inset = [int]($Size * 0.04)
$g.DrawImage($source, (New-Object System.Drawing.Rectangle $inset, $inset, ($Size - 2 * $inset), ($Size - 2 * $inset)), $head, [System.Drawing.GraphicsUnit]::Pixel)
$g.ResetClip()

$out = Join-Path $root 'overlay\icon.png'
$icon.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $icon.Dispose(); $source.Dispose()
Write-Output "Wrote $out"
