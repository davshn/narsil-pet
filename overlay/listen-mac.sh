#!/bin/sh
# macOS: Narsil's listener, started by the hub (server.cjs) while the ear is on.
# Builds the Swift listener (listen-mac.swift, with listen-mac.plist linked in
# for macOS's permission prompts) once per version into the user's cache, then
# runs it in this process. Exits 3 when it cannot be built: it needs Xcode's
# command line tools (xcode-select --install).
dir=$(cd "$(dirname "$0")" && pwd)
src="$dir/listen-mac.swift"
plist="$dir/listen-mac.plist"
cache="$HOME/Library/Caches/narsil-pet"
sum=$(cat "$src" "$plist" | shasum -a 256 | cut -c1-16)
bin="$cache/listen-mac-$sum"

trace() {
  if [ -n "$NARSIL_LOG" ]; then printf '%s %s\n' "$(date +%H:%M:%S)" "$1" >> "$NARSIL_LOG"; fi
}

if [ ! -x "$bin" ]; then
  mkdir -p "$cache"
  swiftc=$(xcrun --find swiftc 2>/dev/null)
  if [ -z "$swiftc" ]; then
    trace 'no Swift compiler: run xcode-select --install'
    exit 3
  fi
  trace 'building the listener'
  if ! "$swiftc" -O -o "$bin.tmp" "$src" -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$plist" 2>>"${NARSIL_LOG:-/dev/null}"; then
    trace 'the listener did not build'
    rm -f "$bin.tmp"
    exit 3
  fi
  mv "$bin.tmp" "$bin"
fi
# exec: the hub stops the listener by killing this process.
exec "$bin"
