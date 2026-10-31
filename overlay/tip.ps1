# Shows one of Narsil's tips, whole, in a small window of its own: above her
# floating window when that is on screen, else in a corner of the screen
# Claude is on. It never takes the focus, stays on top, carries her icon and
# closes by itself after $env:NARSIL_SECONDS, or when a newer tip opens.
#   $env:NARSIL_TEXT     the tip
#   $env:NARSIL_LINK     the conversation to go back to (optional)
#   $env:NARSIL_STAGE    her stage of growth, 1 to 5, for her picture
#   $env:NARSIL_ASSETS   the mod's assets folder
#   $env:NARSIL_SECONDS  how long it stays
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Windows.Forms;

public class NarsilTip : Form {
  public const string Title = "Narsil · Consejo";
  static readonly Regex Link = new Regex(@"^claude://code/continue\?session=local_[A-Za-z0-9-]{1,64}&source=desktop_action$");

  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ReleaseCapture();
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, int w, int l);
  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int value, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  readonly string link;
  readonly IntPtr claude;

  // It shows without taking the focus from what you are doing.
  protected override bool ShowWithoutActivation { get { return true; } }

  public static void Prepare() {
    SetProcessDPIAware();
    // One tip at a time: a newer one closes the one on show (WM_CLOSE).
    for (IntPtr old = FindWindow(null, Title); old != IntPtr.Zero; old = FindWindow(null, Title)) {
      PostMessage(old, 0x10, IntPtr.Zero, IntPtr.Zero);
      System.Threading.Thread.Sleep(150);
      if (FindWindow(null, Title) == old) break;
    }
  }

  public NarsilTip(string text, string link, string art, string icon, bool isDark, IntPtr narsil, IntPtr claude, int seconds) {
    this.link = Link.IsMatch(link ?? "") ? link : "";
    this.claude = claude;
    Color bg = isDark ? Color.FromArgb(0x16, 0x18, 0x2A) : Color.FromArgb(0xF7, 0xF6, 0xFB);
    Color fg = isDark ? Color.FromArgb(0xEC, 0xEB, 0xF3) : Color.FromArgb(0x1E, 0x1C, 0x2C);
    Color soft = isDark ? Color.FromArgb(0x2A, 0x2E, 0x4A) : Color.FromArgb(0xE6, 0xE3, 0xF0);
    Color gold = Color.FromArgb(0xE6, 0xB2, 0x3A);

    float s;
    using (Graphics g = CreateGraphics()) s = g.DpiX / 96f;
    Func<float, int> px = n => (int)Math.Round(n * s);

    Text = Title;
    FormBorderStyle = FormBorderStyle.None;
    StartPosition = FormStartPosition.Manual;
    TopMost = true;
    ShowInTaskbar = true;
    BackColor = bg;
    ForeColor = fg;
    Font = new Font("Segoe UI", 10f);
    if (System.IO.File.Exists(icon)) using (Bitmap b = new Bitmap(icon)) Icon = Icon.FromHandle(b.GetHicon());

    int width = px(380), left = px(92), right = px(34);
    Controls.Add(new Panel { Dock = DockStyle.Top, Height = px(3), BackColor = gold });

    if (System.IO.File.Exists(art)) {
      Controls.Add(new PictureBox { Image = Image.FromFile(art), SizeMode = PictureBoxSizeMode.Zoom, Left = px(12), Top = px(14), Width = px(68), Height = px(80), BackColor = bg });
    }
    Label title = new Label { Text = "CONSEJO DE NARSIL", Font = new Font("Segoe UI Semibold", 8.5f), ForeColor = gold, AutoSize = true, Left = left, Top = px(12) };
    Controls.Add(title);
    Label body = new Label { Text = text, AutoSize = true, MaximumSize = new Size(width - left - right, 0), Left = left, Top = px(32) };
    Controls.Add(body);
    Label close = new Label { Text = "✕", Font = new Font("Segoe UI", 10f), AutoSize = true, Cursor = Cursors.Hand, Top = px(8) };
    close.Left = width - close.PreferredWidth - px(10);
    close.Click += (o, e) => Close();
    Controls.Add(close);

    int y = body.Top + body.PreferredHeight + px(12);
    int x = left;
    if (this.link != "") {
      Button go = Pill("Ir a la conversación", gold, Color.FromArgb(0x3A, 0x2A, 0x00), x, y, px);
      go.Click += (o, e) => { GoBack(); Close(); };
      Controls.Add(go);
      x = go.Right + px(8);
    }
    Button shut = Pill("Cerrar", soft, fg, x, y, px);
    shut.Click += (o, e) => Close();
    Controls.Add(shut);

    ClientSize = new Size(width, Math.Max(shut.Bottom + px(12), px(108)));
    Place(narsil, claude, px(8), px(16));

    // Dragged from anywhere but its buttons, like a title bar.
    MouseDown += Drag;
    foreach (Control c in Controls) if (!(c is Button) && c != close) c.MouseDown += Drag;

    Timer timer = new Timer { Interval = Math.Max(5, seconds) * 1000 };
    timer.Tick += (o, e) => Close();
    timer.Start();
  }

  static Button Pill(string text, Color back, Color fore, int x, int y, Func<float, int> px) {
    Button b = new Button { Text = text, BackColor = back, ForeColor = fore, FlatStyle = FlatStyle.Flat, AutoSize = true, Left = x, Top = y, Cursor = Cursors.Hand, Padding = new Padding(px(4), 0, px(4), 0) };
    b.FlatAppearance.BorderSize = 0;
    return b;
  }

  // Above the floating window when it shows, its right edges lined up; else
  // in the bottom right corner of the screen Claude is on.
  void Place(IntPtr narsil, IntPtr claude, int gap, int margin) {
    RECT r;
    if (narsil != IntPtr.Zero && IsWindowVisible(narsil) && !IsIconic(narsil) && GetWindowRect(narsil, out r)) {
      Rectangle area = Screen.FromHandle(narsil).WorkingArea;
      int top = r.Top - Height - gap;
      if (top >= area.Top) {
        Location = new Point(Math.Max(area.Left, r.Right - Width), top);
        return;
      }
    }
    Screen screen = claude != IntPtr.Zero && !IsIconic(claude) ? Screen.FromHandle(claude) : Screen.PrimaryScreen;
    Rectangle wa = screen.WorkingArea;
    Location = new Point(wa.Right - Width - margin, wa.Bottom - Height - margin);
  }

  void GoBack() {
    if (claude != IntPtr.Zero) {
      if (IsIconic(claude)) ShowWindow(claude, 9);
      SetForegroundWindow(claude);
    }
    Process.Start(new ProcessStartInfo(link) { UseShellExecute = true });
  }

  void Drag(object o, MouseEventArgs e) {
    if (e.Button != MouseButtons.Left) return;
    ReleaseCapture();
    SendMessage(Handle, 0xA1, 2, 0);
  }

  protected override void OnHandleCreated(EventArgs e) {
    base.OnHandleCreated(e);
    // Windows 11 rounds its corners (DWMWA_WINDOW_CORNER_PREFERENCE: round).
    int round = 2;
    try { DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int)); } catch { }
  }
}
'@

function Find-Window($processName, $title) {
  $p = Get-Process $processName -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq $title } |
    Select-Object -First 1
  if ($p) { return $p.MainWindowHandle }
  return [IntPtr]::Zero
}

[NarsilTip]::Prepare()

# Light or dark, as the apps on this computer are.
$isDark = $false
try { $isDark = (Get-ItemPropertyValue 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' AppsUseLightTheme) -eq 0 } catch { }
$theme = $(if ($isDark) { 'oscuro' } else { 'claro' })

# Her greeting at her stage; the hatchling's (stage 1) when it is not drawn.
$stage = 1
[int]::TryParse("$env:NARSIL_STAGE", [ref]$stage) | Out-Null
$art = Join-Path $env:NARSIL_ASSETS "etapa$stage\hola-$theme.png"
if ($stage -le 1 -or -not (Test-Path $art)) { $art = Join-Path $env:NARSIL_ASSETS "hola-$theme.png" }

$seconds = 180
[int]::TryParse("$env:NARSIL_SECONDS", [ref]$seconds) | Out-Null

$tip = New-Object NarsilTip -ArgumentList @(
  "$env:NARSIL_TEXT", "$env:NARSIL_LINK", $art, (Join-Path $PSScriptRoot 'icon.png'), $isDark,
  (Find-Window 'msedge' 'Narsil'), (Find-Window 'claude' 'Claude'), $seconds
)
[System.Windows.Forms.Application]::Run($tip)
