# Says $env:NARSIL_TEXT aloud. The text comes from the environment, never
# from argv, so nothing Claude wrote can be interpreted as code.
# Voice order: a Spanish SAPI voice, natural ones first (NaturalVoiceSAPIAdapter
# exposes Narrator voices such as Elvira there); then a Spanish WinRT voice
# (OneCore, installed from Windows Settings); then the SAPI default.
$text = $env:NARSIL_TEXT
if (-not $text) { exit 0 }

Add-Type -AssemblyName System.Speech
$sapi = New-Object System.Speech.Synthesis.SpeechSynthesizer
$spanish = $sapi.GetInstalledVoices() |
  Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'es*' } |
  Sort-Object { $_.VoiceInfo.Description -notlike '*Natural*' } |
  Select-Object -First 1
if ($spanish) {
  $sapi.SelectVoice($spanish.VoiceInfo.Name)
  $sapi.Speak($text)
  exit 0
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
  $winrt = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -like 'es*' } | Select-Object -First 1
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
