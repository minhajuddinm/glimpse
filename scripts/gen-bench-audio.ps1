<#
  Generates the ASR benchmark audio: one 16 kHz mono 16-bit WAV per line of
  bench/sentences.txt, spoken by the Windows voices (alternating David / Zira).
  Output goes to bench/audio (git-ignored). Run: npm run bench:audio
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$root = Split-Path -Parent $PSScriptRoot
$sentences = Get-Content (Join-Path $root 'bench/sentences.txt') | Where-Object { $_.Trim().Length -gt 0 }
$outDir = Join-Path $root 'bench/audio'
New-Item -ItemType Directory -Force $outDir | Out-Null

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'en-US' } | ForEach-Object { $_.VoiceInfo.Name }
if ($voices.Count -eq 0) { throw 'No en-US Windows voice is installed.' }
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

for ($i = 0; $i -lt $sentences.Count; $i++) {
  $voice = $voices[$i % $voices.Count]
  $synth.SelectVoice($voice)
  $file = Join-Path $outDir ('{0:D2}.wav' -f $i)
  $synth.SetOutputToWaveFile($file, $format)
  $synth.Speak($sentences[$i])
  $synth.SetOutputToNull()
}
$synth.Dispose()
Write-Output "Wrote $($sentences.Count) files to $outDir using: $($voices -join ', ')"
