# Narsil's listener (Windows), started by the hub (server.cjs) while the ear is
# on. It listens to the default microphone with Windows' own recognizer, on
# this computer, for the one word "Narsil". Every 200 ms it tells the hub the
# loudest mic level since the last tick, whether it heard "Narsil" and whether
# a Claude window is in front, and presses the keys the hub answers (ctrl+d,
# enter), only while Claude is in front. It exits when the hub answers "quit"
# or stops answering. Exits 3 when no recognizer is installed.
#   NARSIL_PORT, NARSIL_TOKEN  the hub's port and token (set by the hub)
#   NARSIL_LOG                 optional: a file to trace each tick with keys
#   NARSIL_CONFIDENCE          optional: the least confidence for "Narsil" (0.6)
Add-Type -AssemblyName System.Speech
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Speech @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Speech.Recognition;
using System.Threading;

public static class NarsilEar {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  static SpeechRecognitionEngine engine;
  static int level;
  static int heard;
  public static float MinConfidence = 0.6f;

  // Starts listening; returns the recognizer's culture, or null with none.
  public static string Start() {
    RecognizerInfo chosen = null;
    foreach (RecognizerInfo r in SpeechRecognitionEngine.InstalledRecognizers()) {
      if (r.Culture.TwoLetterISOLanguageName == "es") { chosen = r; break; }
    }
    if (chosen == null) {
      foreach (RecognizerInfo r in SpeechRecognitionEngine.InstalledRecognizers()) { chosen = r; break; }
    }
    if (chosen == null) return null;
    engine = new SpeechRecognitionEngine(chosen);
    GrammarBuilder word = new GrammarBuilder("Narsil");
    word.Culture = chosen.Culture;
    Grammar wake = new Grammar(word);
    wake.Name = "narsil";
    engine.LoadGrammar(wake);
    // Everything else you say goes to dictation, so other words do not pass
    // for "Narsil".
    try {
      Grammar other = new DictationGrammar();
      other.Name = "other";
      engine.LoadGrammar(other);
    } catch (Exception) {
      // no dictation for this recognizer: "Narsil" alone, held to its confidence
    }
    engine.SpeechRecognized += (sender, e) => {
      if (e.Result.Grammar != null && e.Result.Grammar.Name == "narsil" && e.Result.Confidence >= MinConfidence) {
        Interlocked.Exchange(ref heard, 1);
      }
    };
    engine.AudioLevelUpdated += (sender, e) => {
      int now = e.AudioLevel;
      int seen;
      do {
        seen = level;
        if (now <= seen) return;
      } while (Interlocked.CompareExchange(ref level, now, seen) != seen);
    };
    engine.SetInputToDefaultAudioDevice();
    engine.RecognizeAsync(RecognizeMode.Multiple);
    return chosen.Culture.Name;
  }

  public static int TakeLevel() { return Interlocked.Exchange(ref level, 0); }
  public static bool TakeHeard() { return Interlocked.Exchange(ref heard, 0) == 1; }

  // Whether the window in front belongs to the Claude app.
  public static bool IsClaudeInFront() {
    IntPtr window = GetForegroundWindow();
    if (window == IntPtr.Zero) return false;
    uint processId;
    GetWindowThreadProcessId(window, out processId);
    try {
      return string.Equals(Process.GetProcessById((int)processId).ProcessName, "claude", StringComparison.OrdinalIgnoreCase);
    } catch (Exception) {
      return false;
    }
  }
}
'@

function Trace($text) {
  if ($env:NARSIL_LOG) { Add-Content -Path $env:NARSIL_LOG -Value "$(Get-Date -Format HH:mm:ss.fff) $text" }
}

if ($env:NARSIL_CONFIDENCE) { [NarsilEar]::MinConfidence = [float]$env:NARSIL_CONFIDENCE }
$culture = [NarsilEar]::Start()
if (-not $culture) { Trace 'no recognizer installed'; exit 3 }
Trace "listening ($culture)"

$port = $env:NARSIL_PORT
$client = New-Object System.Net.WebClient
$misses = 0
while ($true) {
  $level = [NarsilEar]::TakeLevel()
  $heard = [int][NarsilEar]::TakeHeard()
  $claude = [int][NarsilEar]::IsClaudeInFront()
  try {
    $client.Headers['x-narsil-token'] = $env:NARSIL_TOKEN
    $answer = $client.DownloadString("http://127.0.0.1:$port/ear/tick?level=$level&heard=$heard&claude=$claude")
    $misses = 0
  } catch {
    $misses++
    if ($misses -ge 5) { exit 0 }
    Start-Sleep -Milliseconds 400
    continue
  }
  foreach ($line in ($answer -split "`n")) {
    $key = $line.Trim()
    if (-not $key) { continue }
    Trace "level=$level heard=$heard claude=$claude -> $key"
    if ($key -eq 'quit') { exit 0 }
    # Only into Claude: the window in front may have changed since the tick.
    if (-not [NarsilEar]::IsClaudeInFront()) { continue }
    if ($key -eq 'ctrl+d') { [System.Windows.Forms.SendKeys]::SendWait('^d') }
    elseif ($key -eq 'enter') { [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') }
  }
  Start-Sleep -Milliseconds 200
}
