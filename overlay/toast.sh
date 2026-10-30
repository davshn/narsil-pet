#!/bin/sh
# macOS: shows a notification titled $NARSIL_TITLE saying $NARSIL_TEXT. Both
# travel as arguments to osascript, never inside the script, so nothing in
# them runs.
exec osascript \
  -e 'on run argv' \
  -e 'display notification (item 2 of argv) with title (item 1 of argv)' \
  -e 'end run' \
  "$NARSIL_TITLE" "$NARSIL_TEXT"
