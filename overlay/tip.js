// macOS: one of Narsil's tips, whole, in a small window of its own, run by
// osascript (JavaScript for Automation, with Cocoa). A floating panel that
// never takes the focus, stays on top, carries her icon in the Dock and
// closes by itself after NARSIL_SECONDS. It opens above the floating window
// when that is on screen (it asks the overlay server where), else in the
// bottom right corner of the screen the mouse is on.
//   NARSIL_TEXT     the tip
//   NARSIL_LINK     the conversation to go back to (optional)
//   NARSIL_STAGE    her stage of growth, 1 to 5, for her picture
//   NARSIL_ASSETS   the mod's assets folder
//   NARSIL_SECONDS  how long it stays
//   NARSIL_OVERLAY  the overlay server, http://127.0.0.1:<port>
//   NARSIL_ICON     her icon (set by tip.sh)
ObjC.import('Cocoa')

const LINK = /^claude:\/\/code\/continue\?session=local_[A-Za-z0-9-]{1,64}&source=desktop_action$/
// NSWindowStyleMaskNonactivatingPanel, over a borderless window; the floating
// window level; to show on every Space, over full-screen apps too.
const NONACTIVATING = 1 << 7
const FLOATING_LEVEL = 3
const ALL_SPACES = 1 | (1 << 8)
// NSApplicationActivationPolicyRegular, NSBackingStoreBuffered and
// NSImageScaleProportionallyUpOrDown, by value.
const REGULAR_APP = 0
const BUFFERED = 2
const SCALE_TO_FIT = 3

function env(name) {
  const value = $.NSProcessInfo.processInfo.environment.objectForKey(name)
  return value.isNil() ? '' : ObjC.unwrap(value)
}

function rgb(hex) {
  const n = parseInt(hex, 16)
  return $.NSColor.colorWithSRGBRedGreenBlueAlpha(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1)
}

function exists(path) {
  return $.NSFileManager.defaultManager.fileExistsAtPath(path)
}

// Where the floating window last said it is, if it is on show now.
function floatingWindow() {
  try {
    const data = $.NSData.dataWithContentsOfURL($.NSURL.URLWithString(env('NARSIL_OVERLAY') + '/window'))
    if (data.isNil()) return null
    const box = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)))
    return box && box.isVisible && box.age < 5000 ? box : null
  } catch (e) {
    return null
  }
}

function screenAt(x, y) {
  const screens = $.NSScreen.screens
  for (let i = 0; i < screens.count; i++) {
    const s = screens.objectAtIndex(i)
    const f = s.frame
    if (x >= f.origin.x && x < f.origin.x + f.size.width && y >= f.origin.y && y < f.origin.y + f.size.height) return s
  }
  return null
}

// The bottom left corner the window opens at. Cocoa counts up from the bottom
// of the main screen; the browser counts down from its top.
function placeFor(width, height) {
  const mainHeight = $.NSScreen.screens.objectAtIndex(0).frame.size.height
  const box = floatingWindow()
  if (box) {
    const top = mainHeight - box.y
    const screen = screenAt(box.x + 1, top - 1)
    const x = box.x + box.width - width
    const y = top + 8
    if (screen) {
      const area = screen.visibleFrame
      if (y + height <= area.origin.y + area.size.height) return [Math.max(area.origin.x, x), y]
    }
  }
  const mouse = $.NSEvent.mouseLocation
  const area = (screenAt(mouse.x, mouse.y) || $.NSScreen.mainScreen).visibleFrame
  return [area.origin.x + area.size.width - width - 16, area.origin.y + 16]
}

function run() {
  const app = $.NSApplication.sharedApplication
  // A regular app, so her icon shows in the Dock while the tip is on show; it
  // is never brought to the front.
  app.setActivationPolicy(REGULAR_APP)
  const icon = $.NSImage.alloc.initWithContentsOfFile(env('NARSIL_ICON'))
  if (!icon.isNil()) app.setApplicationIconImage(icon)

  const isDark = ObjC.unwrap($.NSUserDefaults.standardUserDefaults.stringForKey('AppleInterfaceStyle')) === 'Dark'
  const theme = isDark ? 'oscuro' : 'claro'
  const bg = rgb(isDark ? '16182A' : 'F7F6FB')
  const fg = rgb(isDark ? 'ECEBF3' : '1E1C2C')
  const gold = rgb('E6B23A')
  const link = LINK.test(env('NARSIL_LINK')) ? env('NARSIL_LINK') : ''

  ObjC.registerSubclass({
    name: 'NarsilTipTarget',
    methods: {
      'close:': {
        types: ['void', ['id']],
        implementation: function () {
          app.terminate(null)
        },
      },
      'goBack:': {
        types: ['void', ['id']],
        implementation: function () {
          if (link) $.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString(link))
          app.terminate(null)
        },
      },
    },
  })
  const target = $.NarsilTipTarget.alloc.init

  const width = 380
  const left = 92
  const textWidth = width - left - 34
  const body = $.NSTextField.wrappingLabelWithString(env('NARSIL_TEXT'))
  body.setFont($.NSFont.systemFontOfSize(13))
  body.setTextColor(fg)
  body.setPreferredMaxLayoutWidth(textWidth)
  const textHeight = Math.ceil(body.cell.cellSizeForBounds($.NSMakeRect(0, 0, textWidth, 10000)).height)
  const buttonHeight = 24
  const height = Math.max(32 + textHeight + 12 + buttonHeight + 14, 112)
  // Laid out from the top: a view's y counts up from its bottom.
  const at = (x, y, w, h) => $.NSMakeRect(x, height - y - h, w, h)

  const panel = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0, 0, width, height), NONACTIVATING, BUFFERED, false)
  panel.setTitle('Narsil · Consejo')
  panel.setLevel(FLOATING_LEVEL)
  panel.setFloatingPanel(true)
  panel.setHidesOnDeactivate(false)
  panel.setBecomesKeyOnlyIfNeeded(true)
  panel.setCollectionBehavior(ALL_SPACES)
  panel.setMovableByWindowBackground(true)
  panel.setOpaque(false)
  panel.setBackgroundColor($.NSColor.clearColor)
  panel.setHasShadow(true)
  panel.setAppearance($.NSAppearance.appearanceNamed(isDark ? 'NSAppearanceNameDarkAqua' : 'NSAppearanceNameAqua'))

  const view = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, width, height))
  view.setWantsLayer(true)
  view.layer.setCornerRadius(12)
  view.layer.setMasksToBounds(true)
  view.layer.setBackgroundColor(bg.CGColor)
  panel.setContentView(view)

  const strip = $.NSView.alloc.initWithFrame(at(0, 0, width, 3))
  strip.setWantsLayer(true)
  strip.layer.setBackgroundColor(gold.CGColor)
  view.addSubview(strip)

  // Her greeting at her stage; the hatchling's (stage 1) when it is not drawn.
  const assets = env('NARSIL_ASSETS')
  const stage = parseInt(env('NARSIL_STAGE'), 10) || 1
  let art = `${assets}/etapa${stage}/hola-${theme}.png`
  if (stage <= 1 || !exists(art)) art = `${assets}/hola-${theme}.png`
  const picture = $.NSImage.alloc.initWithContentsOfFile(art)
  if (!picture.isNil()) {
    const image = $.NSImageView.imageViewWithImage(picture)
    image.setImageScaling(SCALE_TO_FIT)
    image.setFrame(at(12, 14, 68, 80))
    view.addSubview(image)
  }

  const title = $.NSTextField.labelWithString('CONSEJO DE NARSIL')
  title.setFont($.NSFont.boldSystemFontOfSize(11))
  title.setTextColor(gold)
  title.setFrame(at(left, 12, textWidth, 16))
  view.addSubview(title)

  body.setFrame(at(left, 32, textWidth, textHeight))
  view.addSubview(body)

  const close = $.NSButton.buttonWithTitleTargetAction('✕', target, 'close:')
  close.setBordered(false)
  close.setFrame(at(width - 30, 6, 24, 22))
  view.addSubview(close)

  let x = left
  const y = 32 + textHeight + 12
  if (link) {
    const go = $.NSButton.buttonWithTitleTargetAction('Ir a la conversación', target, 'goBack:')
    go.sizeToFit
    go.setFrame(at(x, y, go.frame.size.width + 8, buttonHeight))
    view.addSubview(go)
    x += go.frame.size.width + 8
  }
  const shut = $.NSButton.buttonWithTitleTargetAction('Cerrar', target, 'close:')
  shut.sizeToFit
  shut.setFrame(at(x, y, shut.frame.size.width + 8, buttonHeight))
  view.addSubview(shut)

  const [px, py] = placeFor(width, height)
  panel.setFrameOrigin($.NSMakePoint(px, py))
  panel.orderFrontRegardless

  const seconds = Math.max(5, parseInt(env('NARSIL_SECONDS'), 10) || 180)
  $.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(seconds, target, 'close:', null, false)
  app.run
}
