# Says $env:NARSIL_TEXT aloud. The text comes from the environment, never
# from argv, so nothing Claude wrote can be interpreted as code.
# Voice order: a Spanish SAPI voice, natural ones first (NaturalVoiceSAPIAdapter
# exposes Narrator voices such as Dalia there), Latin American before Spain's;
# then a Spanish WinRT voice (OneCore, installed from Windows Settings), Latin
# American first too; then the SAPI default.
# With NARSIL_FOLLOW=1 (the answer to a message sent by voice) it tells the hub
# at NARSIL_PORT, with NARSIL_TOKEN, once it has finished speaking: the hub then
# opens Claude's dictation for your answer.
$text = $env:NARSIL_TEXT
if (-not $text) { exit 0 }

function Invoke-Speech($text) {
  Add-Type -AssemblyName System.Speech
  $sapi = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $spanish = $sapi.GetInstalledVoices() |
    Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'es*' } |
    Sort-Object { $_.VoiceInfo.Description -notlike '*Natural*' }, { $_.VoiceInfo.Culture.Name -eq 'es-ES' } |
    Select-Object -First 1
  if ($spanish) {
    $sapi.SelectVoice($spanish.VoiceInfo.Name)
    $sapi.Speak($text)
    return
  }

  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
    $winrt = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
    $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -like 'es*' } | Sort-Object { $_.Language -eq 'es-ES' } | Select-Object -First 1
    if (-not $voice) { throw 'no Spanish WinRT voice' }
    $winrt.Voice = $voice
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
      Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } |
      Select-Object -First 1
    $task = $asTask.MakeGenericMethod([Windows.Media.SpeechSynthesis.SpeechSynthesisStream]).Invoke($null, @($winrt.SynthesizeTextToStreamAsync($text)))
    $task.Wait()
    $player = New-Object System.Media.SoundPlayer([System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($task.Result))
    $player.PlaySync()
  } catch {
    $sapi.Speak($text)
  }
}

Invoke-Speech $text

if ($env:NARSIL_FOLLOW -eq '1' -and $env:NARSIL_PORT -and $env:NARSIL_TOKEN) {
  try {
    Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$($env:NARSIL_PORT)/ear/follow" -Headers @{ 'x-narsil-token' = $env:NARSIL_TOKEN } -TimeoutSec 3 | Out-Null
  } catch {
    # the hub is gone: nothing opens
  }
}
