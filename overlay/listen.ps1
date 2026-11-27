# Narsil's listener (Windows), started by the hub (server.cjs) while the ear is
# on. It listens to the default microphone with Windows' own speech recognizer
# (Windows.Media.SpeechRecognition), on this computer, for the one word
# "Narsil", in Spanish when Windows has Spanish speech installed. Every 200 ms
# it tells the hub whether you were talking since the last tick, whether it
# heard "Narsil" and whether a Claude window is in front, and presses the keys
# the hub answers (ctrl+d, enter), only while Claude is in front. It exits when
# the hub answers "quit" or stops answering. Exits 3 when Windows has no speech
# recognition language, 4 when the recognizer keeps failing or hangs.
#   NARSIL_PORT, NARSIL_TOKEN  the hub's port and token (set by the hub)
#   NARSIL_LOG                 optional: a file to trace what it hears and presses
#   NARSIL_LANG                optional: the recognition language (es-MX, en-US...)
#   NARSIL_CONFIDENCE          optional: the least raw confidence for "Narsil" (0)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechRecognition.SpeechRecognizer, Windows.Media.SpeechRecognition, ContentType = WindowsRuntime]
$null = [Windows.Media.SpeechRecognition.SpeechRecognitionListConstraint, Windows.Media.SpeechRecognition, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

# The mic, read on its own: the recognizer gives no levels, and some mics are
# far quieter than others, so "talking" is a level well above this mic's own
# noise floor.
Add-Type @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class NarsilMic {
  [StructLayout(LayoutKind.Sequential)] struct WAVEFORMATEX { public short wFormatTag, nChannels; public int nSamplesPerSec, nAvgBytesPerSec; public short nBlockAlign, wBitsPerSample, cbSize; }
  [StructLayout(LayoutKind.Sequential)] struct WAVEHDR { public IntPtr lpData; public int dwBufferLength, dwBytesRecorded; public IntPtr dwUser; public int dwFlags, dwLoops; public IntPtr lpNext, reserved; }
  [DllImport("winmm.dll")] static extern int waveInOpen(out IntPtr handle, int device, ref WAVEFORMATEX format, IntPtr callback, IntPtr instance, int flags);
  [DllImport("winmm.dll")] static extern int waveInPrepareHeader(IntPtr handle, IntPtr header, int size);
  [DllImport("winmm.dll")] static extern int waveInUnprepareHeader(IntPtr handle, IntPtr header, int size);
  [DllImport("winmm.dll")] static extern int waveInAddBuffer(IntPtr handle, IntPtr header, int size);
  [DllImport("winmm.dll")] static extern int waveInStart(IntPtr handle);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  const int WAVE_MAPPER = -1;
  const int WHDR_DONE = 1;
  const int Samples = 800; // 50 ms at 16 kHz
  // A block is talking at or above both: a floor for silent mics, and a
  // multiple of the noise floor for noisy ones (16-bit peaks).
  const int MinVoicePeak = 250;
  const double FloorTimes = 3.0;

  static double noiseFloor = 300;
  static int voice;

  // Starts reading the default mic; returns false when it cannot be opened.
  public static bool Start() {
    WAVEFORMATEX format = new WAVEFORMATEX { wFormatTag = 1, nChannels = 1, nSamplesPerSec = 16000, nAvgBytesPerSec = 32000, nBlockAlign = 2, wBitsPerSample = 16 };
    IntPtr handle;
    if (waveInOpen(out handle, WAVE_MAPPER, ref format, IntPtr.Zero, IntPtr.Zero, 0) != 0) return false;
    int size = Marshal.SizeOf(typeof(WAVEHDR));
    IntPtr[] headers = new IntPtr[8];
    for (int i = 0; i < headers.Length; i++) {
      headers[i] = Marshal.AllocHGlobal(size);
      Marshal.StructureToPtr(new WAVEHDR { lpData = Marshal.AllocHGlobal(Samples * 2), dwBufferLength = Samples * 2 }, headers[i], false);
      waveInPrepareHeader(handle, headers[i], size);
      waveInAddBuffer(handle, headers[i], size);
    }
    waveInStart(handle);
    Thread reader = new Thread(() => {
      short[] samples = new short[Samples];
      int next = 0;
      while (true) {
        WAVEHDR header = (WAVEHDR)Marshal.PtrToStructure(headers[next], typeof(WAVEHDR));
        if ((header.dwFlags & WHDR_DONE) == 0) { Thread.Sleep(5); continue; }
        int count = Math.Min(Samples, header.dwBytesRecorded / 2);
        Marshal.Copy(header.lpData, samples, 0, count);
        Hear(samples, count);
        waveInUnprepareHeader(handle, headers[next], size);
        waveInPrepareHeader(handle, headers[next], size);
        waveInAddBuffer(handle, headers[next], size);
        next = (next + 1) % headers.Length;
      }
    });
    reader.IsBackground = true;
    reader.Start();
    return true;
  }

  static void Hear(short[] samples, int count) {
    int peak = 0;
    for (int i = 0; i < count; i++) {
      int sample = Math.Abs((int)samples[i]);
      if (sample > peak) peak = sample;
    }
    if (peak >= Math.Max(MinVoicePeak, noiseFloor * FloorTimes)) Interlocked.Exchange(ref voice, 1);
    // Falls fast to quieter blocks, rises slowly with louder ones, so talking
    // does not lift it much.
    noiseFloor = peak < noiseFloor ? noiseFloor * 0.9 + peak * 0.1 : noiseFloor + (peak - noiseFloor) * 0.001;
  }

  // Whether you talked since the last call.
  public static bool TakeVoice() { return Interlocked.Exchange(ref voice, 0) == 1; }

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

# The recognition language: the one asked for, else Spanish, else Windows' own.
function Select-Language {
  $installed = @([Windows.Media.SpeechRecognition.SpeechRecognizer]::SupportedGrammarLanguages | ForEach-Object { $_.LanguageTag })
  if ($installed.Count -eq 0) { return $null }
  if ($env:NARSIL_LANG -and $installed -contains $env:NARSIL_LANG) { return $env:NARSIL_LANG }
  $spanish = $installed | Where-Object { $_ -like 'es*' } | Select-Object -First 1
  if ($spanish) { return $spanish }
  $system = [Windows.Media.SpeechRecognition.SpeechRecognizer]::SystemSpeechLanguage.LanguageTag
  if ($installed -contains $system) { return $system }
  return $installed[0]
}

# Windows' async operations, waited on as .NET tasks.
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } |
  Select-Object -First 1
function ConvertTo-Task($operation, [Type]$type) { $asTask.MakeGenericMethod($type).Invoke($null, @($operation)) }

$language = Select-Language
if (-not $language) { Trace 'no speech recognition language installed'; exit 3 }
$recognizer = New-Object Windows.Media.SpeechRecognition.SpeechRecognizer ([Windows.Globalization.Language]::new($language))
# How the recognizer writes "Narsil" back as it hears it.
$words = New-Object 'System.Collections.Generic.List[string]'
foreach ($word in 'Narsil', 'Nar sil', 'Narcil') { $words.Add($word) }
$wake = New-Object Windows.Media.SpeechRecognition.SpeechRecognitionListConstraint ($words, 'narsil')
# The constraint list reaches PowerShell as a bare COM object: add through its
# .NET interface.
[System.Collections.Generic.ICollection[Windows.Media.SpeechRecognition.ISpeechRecognitionConstraint]].GetMethod('Add').Invoke($recognizer.Constraints, [object[]]@($wake.psobject.BaseObject)) | Out-Null
$compiled = ConvertTo-Task ($recognizer.CompileConstraintsAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionCompilationResult])
$null = $compiled.Wait(-1)
if ("$($compiled.Result.Status)" -ne 'Success') { Trace "grammar not compiled: $($compiled.Result.Status)"; exit 4 }
$recognizer.Timeouts.InitialSilenceTimeout = [TimeSpan]::FromSeconds(10)
$recognizer.Timeouts.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(500)
$recognizer.Timeouts.BabbleTimeout = [TimeSpan]::FromSeconds(4)
$minConfidence = 0.0
if ($env:NARSIL_CONFIDENCE) { $minConfidence = [double]$env:NARSIL_CONFIDENCE }

if (-not [NarsilMic]::Start()) { Trace 'no microphone'; exit 4 }
Trace "listening ($language)"

$resultType = [Windows.Media.SpeechRecognition.SpeechRecognitionResult]
$listening = $null
$listeningSince = Get-Date
$spoke = $false
$failures = 0
$heard = 0
$port = $env:NARSIL_PORT
$client = New-Object System.Net.WebClient
$misses = 0
while ($true) {
  # One phrase at a time: when one ends, see whether it was "Narsil", then
  # listen for the next.
  # A phrase lasts at most about 15 s (10 s of silence, or 4 s of talk and a
  # pause): one running past 30 s has hung, and a new listener starts afresh.
  if ($listening -and -not $listening.IsCompleted -and ((Get-Date) - $listeningSince).TotalSeconds -gt 30) {
    Trace 'recognizer stuck, starting again'
    exit 4
  }
  if ($listening -and $listening.IsCompleted) {
    if ($listening.IsFaulted) {
      $failures++
      Trace "recognizer failed: $($listening.Exception.InnerException.Message)"
      if ($failures -ge 5) { exit 4 }
    } else {
      $failures = 0
      $result = $listening.Result
      if ("$($result.Confidence)" -ne 'Rejected' -and $result.Text -and $result.RawConfidence -ge $minConfidence) {
        $heard = 1
        Trace "heard '$($result.Text)' ($($result.Confidence), $([math]::Round($result.RawConfidence, 2)))"
      } elseif ($spoke -or "$($result.Status)" -ne 'Success' -or $result.Text) {
        Trace "not taken: status $($result.Status), '$($result.Text)' ($($result.Confidence), $([math]::Round($result.RawConfidence, 2)))"
      }
    }
    $listening = $null
  }
  if (-not $listening) {
    $listening = ConvertTo-Task ($recognizer.RecognizeAsync()) $resultType
    $listeningSince = Get-Date
    $spoke = $false
  }

  $voice = [int][NarsilMic]::TakeVoice()
  # Whether you talked during this phrase: a phrase you spoke that is not
  # taken is traced, a silent one is not.
  if ($voice) { $spoke = $true }
  $claude = [int][NarsilMic]::IsClaudeInFront()
  try {
    $client.Headers['x-narsil-token'] = $env:NARSIL_TOKEN
    $answer = $client.DownloadString("http://127.0.0.1:$port/ear/tick?voice=$voice&heard=$heard&claude=$claude")
    $misses = 0
    if ($heard -and -not $answer.Trim()) { Trace "heard, nothing to press (claude=$claude)" }
    $heard = 0
  } catch {
    $misses++
    if ($misses -ge 5) { exit 0 }
    Start-Sleep -Milliseconds 400
    continue
  }
  foreach ($line in ($answer -split "`n")) {
    $key = $line.Trim()
    if (-not $key) { continue }
    Trace "voice=$voice claude=$claude -> $key"
    if ($key -eq 'quit') { exit 0 }
    # Only into Claude: the window in front may have changed since the tick.
    if (-not [NarsilMic]::IsClaudeInFront()) { continue }
    if ($key -eq 'ctrl+d') { [System.Windows.Forms.SendKeys]::SendWait('^d') }
    elseif ($key -eq 'enter') { [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') }
  }
  Start-Sleep -Milliseconds 200
}
