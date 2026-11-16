# Turns a Veo video of one of Narsil's poses (made from tools/anim-sources.ps1)
# into her animated loop, assets/anim/[etapa<N>/]<pose>-<theme>.webp, and its
# sharp copy for the floating window, assets/anim-hq/ alike, then
# embeds the loops (tools/build-animated.ps1). The video's green is keyed out
# and its audio dropped; the loop's end fades into its start; the quality is
# the best that keeps the loop within -TargetKB, so both themes' loops fit the
# band's drawing (at most 131072 characters).
#   powershell -ExecutionPolicy Bypass -File tools/encode-anim.ps1 -Video <mp4> -Stage 4 -Pose trabajando -Theme oscuro
param(
  [Parameter(Mandatory)][string]$Video,
  [Parameter(Mandatory)][ValidateRange(1, 5)][int]$Stage,
  [Parameter(Mandatory)][ValidateSet('hola', 'trabajando', 'necesita', 'parada', 'terminado', 'error', 'base')][string]$Pose,
  [Parameter(Mandatory)][ValidateSet('claro', 'oscuro')][string]$Theme,
  [int]$TargetKB = 38,
  [double]$Seconds = 3,
  [int]$Fps = 6,
  [int]$Height = 128,
  # The seconds the loop's end fades into its start; 0 for a video that already
  # ends where it starts (Flow, with her picture as both first and last frame):
  # then the loop is its first -Seconds, as they are.
  [double]$Fade = 0.5
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'ffmpeg.ps1')
$KEY = 'colorkey=0x00FF00:0.28:0.06'
$FADE = $Fade

# Where she is over the whole video: the union of her bounds in every frame.
$log = cmd /c "`"$FFMPEG`" -hide_banner -i `"$Video`" -an -vf format=rgba,$KEY,alphaextract,bbox=min_val=128 -f null - 2>&1"
$x0 = 1e9; $y0 = 1e9; $x1 = -1; $y1 = -1
foreach ($line in $log) {
  if ($line -match 'x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)') {
    $x0 = [Math]::Min($x0, [int]$matches[1]); $x1 = [Math]::Max($x1, [int]$matches[2])
    $y0 = [Math]::Min($y0, [int]$matches[3]); $y1 = [Math]::Max($y1, [int]$matches[4])
  }
}
if ($x1 -lt 0) { throw "no character found in $Video (is the background pure green?)" }
$pad = 6
$cx = [Math]::Max(0, $x0 - $pad); $cy = [Math]::Max(0, $y0 - $pad)
$size = (& (Join-Path (Split-Path $FFMPEG) 'ffprobe.exe') -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 $Video) -split ','
$cw = [Math]::Min(2 * [int](($x1 - $cx + $pad + 1) / 2), 2 * [Math]::Floor(([int]$size[0] - $cx) / 2))
$ch = [Math]::Min(2 * [int](($y1 - $cy + $pad + 1) / 2), 2 * [Math]::Floor(([int]$size[1] - $cy) / 2))

$sub = if ($Stage -gt 1) { "etapa$Stage" } else { '' }
$dir = Join-Path $root "assets\anim\$sub"
New-Item -ItemType Directory -Force $dir | Out-Null
$out = Join-Path $dir "$Pose-$Theme.webp"
$tmp = Join-Path ([IO.Path]::GetTempPath()) "narsil-$PID.webp"

# Edge: a hard, binary edge shrunk a pixel for the band (a soft one costs some
# 45 KB there), the pixel taking the green fringe with it; softened for the window.
$HARD = "erosion,lut=y='if(gt(val\,128)\,255\,0)'"
$SOFT = 'erosion,gblur=sigma=0.8'
function Encode([int]$quality, [int]$height, [double]$seconds, [int]$fps = $Fps, [string]$edge = $HARD, [string]$to = $tmp) {
  $fc = "[0:v]trim=0:$($seconds + $FADE),setpts=PTS-STARTPTS,crop=${cw}:${ch}:${cx}:${cy},fps=$fps,scale=-2:${height}:flags=lanczos,format=rgba,$KEY,split[c1][c2];" +
    "[c1]alphaextract,$edge[al];[c2][al]alphamerge" +
    $(if ($FADE -gt 0) {
      ",split[a][b];[a]trim=start=$FADE,setpts=PTS-STARTPTS[m];[b]trim=0:$FADE,setpts=PTS-STARTPTS[h];" +
      "[m][h]xfade=transition=fade:duration=${FADE}:offset=$($seconds - $FADE),format=yuva420p[v]"
    } else { ',format=yuva420p[v]' })
  & $FFMPEG -v error -y -i $Video -filter_complex $fc -map '[v]' -an -c:v libwebp_anim -lossless 0 -quality $quality -compression_level 6 -loop 0 $to
  if ($LASTEXITCODE -ne 0) { throw 'ffmpeg failed' }
  return (Get-Item $to).Length
}

# The best quality within the target: a binary search, then smaller if even
# the lowest quality is too big.
$limit = $TargetKB * 1024
$best = $null
# Without a fade, cutting the loop shorter would break it: fewer frames instead.
$last = if ($FADE -gt 0) { @{ h = $Height - 12; s = $Seconds - 0.5; f = $Fps } } else { @{ h = $Height - 12; s = $Seconds; f = $Fps - 1 } }
foreach ($try in @(@{ h = $Height; s = $Seconds; f = $Fps }, @{ h = $Height - 12; s = $Seconds; f = $Fps }, $last)) {
  $lo = 15; $hi = 70
  while ($lo -le $hi) {
    $q = [int](($lo + $hi) / 2)
    $size = Encode $q $try.h $try.s $try.f
    if ($size -le $limit) { $best = @{ q = $q; h = $try.h; s = $try.s; size = $size }; Copy-Item $tmp $out -Force; $lo = $q + 1 } else { $hi = $q - 1 }
  }
  if ($best) { break }
}
Remove-Item $tmp -ErrorAction SilentlyContinue
if (-not $best) { throw "no loop within $TargetKB KB: ask Veo for less motion" }
Write-Output ("{0}: quality {1}, {2} px, {3} s, {4:N1} KB" -f $out, $best.q, $best.h, $best.s, ($best.size / 1KB))

# The floating window's sharp copy: no size limit there (overlay/server.cjs
# serves it), the same crop and length so it lands where the small one does.
$hqDir = Join-Path $root "assets\anim-hq\$sub"
New-Item -ItemType Directory -Force $hqDir | Out-Null
$hq = Join-Path $hqDir "$Pose-$Theme.webp"
# She is some 93 px tall there: 200 px stays sharp on a 2x screen.
$hqSize = Encode 75 200 $best.s 12 $SOFT $hq
Write-Output ("{0}: 200 px, 12 fps, {1:N0} KB" -f $hq, ($hqSize / 1KB))
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-animated.ps1')
