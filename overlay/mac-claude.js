// macOS, run by server.cjs with `osascript -l JavaScript`: prints Claude's
// state every 700 ms on stderr (where JXA's console.log goes), one word a
// line: "fg" when its window is in front, "bg" when it shows behind another
// app, "none" when no window of it is on screen (minimized, hidden with
// Cmd-H, or not running). The window list names each window's app with no
// permission; only window titles would need one.
ObjC.import('CoreGraphics')

const ON_SCREEN_ONLY = 1
const EXCLUDE_DESKTOP = 16

function claudeState() {
  const list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(ON_SCREEN_ONLY | EXCLUDE_DESKTOP, 0))) || []
  // Ordinary windows, front to back, leaving out menus and helper slivers.
  const windows = list.filter(w => w.kCGWindowLayer === 0 && w.kCGWindowAlpha !== 0 && (w.kCGWindowBounds || {}).Height > 50)
  if (!windows.some(w => w.kCGWindowOwnerName === 'Claude')) return 'none'
  return windows[0].kCGWindowOwnerName === 'Claude' ? 'fg' : 'bg'
}

function run() {
  for (;;) {
    console.log(claudeState())
    delay(0.7)
  }
}
