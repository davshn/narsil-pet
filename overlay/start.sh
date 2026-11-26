#!/bin/sh
# macOS: starts Narsil's hub (server.cjs) in the background and returns at
# once. It serves the open conversations to each other and opens no window.
# Exits 3 when Node is missing.

# An app started from the Dock has a short PATH: look where Node usually is.
node=$(command -v node 2>/dev/null)
for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node"; do
  if [ -z "$node" ] && [ -x "$candidate" ]; then
    node=$candidate
  fi
done

if [ -z "$node" ]; then
  exit 3
fi
nohup "$node" "$(dirname "$0")/server.cjs" </dev/null >/dev/null 2>&1 &
