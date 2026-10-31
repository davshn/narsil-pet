#!/bin/sh
# macOS: shows one of Narsil's tips, whole, in a small window of its own
# (tip.js, run by osascript). A newer tip closes the one on show. The tip and
# the rest travel in the environment, never inside the script, so nothing in
# them runs. See tip.js for what it reads.
dir=$(dirname "$0")
pkill -f "$dir/tip.js" 2>/dev/null
NARSIL_ICON="$dir/icon.png"
export NARSIL_ICON
exec osascript -l JavaScript "$dir/tip.js"
