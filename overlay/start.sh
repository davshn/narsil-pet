#!/bin/sh
# macOS: starts Narsil's floating window server (server.cjs) in the
# background and returns at once. The server opens the window in a Chromium
# browser's app mode (Chrome, Edge or Brave) when it is wanted. Exits 3 when
# Node or such a browser is missing.
for app in \
  "/Applications/Google Chrome.app" "$HOME/Applications/Google Chrome.app" \
  "/Applications/Microsoft Edge.app" "$HOME/Applications/Microsoft Edge.app" \
  "/Applications/Brave Browser.app" "$HOME/Applications/Brave Browser.app"; do
  if [ -d "$app" ]; then
    NARSIL_BROWSER_APP=$app
    break
  fi
done

# An app started from the Dock has a short PATH: look where Node usually is.
node=$(command -v node 2>/dev/null)
for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node"; do
  if [ -z "$node" ] && [ -x "$candidate" ]; then
    node=$candidate
  fi
done

if [ -z "$NARSIL_BROWSER_APP" ] || [ -z "$node" ]; then
  exit 3
fi
export NARSIL_BROWSER_APP
nohup "$node" "$(dirname "$0")/server.cjs" </dev/null >/dev/null 2>&1 &
