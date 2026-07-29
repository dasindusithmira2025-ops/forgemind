$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Speech

$root = Split-Path -Parent $PSScriptRoot
$waveDir = Join-Path $root 'out\audio-source\voice'
$mp3Dir = Join-Path $root 'public\audio\voice'
New-Item -ItemType Directory -Force -Path $waveDir, $mp3Dir | Out-Null

$lines = [ordered]@{
  fragmentation = 'Development changed. The environment didn''t.'
  pressure = 'Development moves faster. Control is scattered everywhere.'
  alignment = 'Meet PARALITH. The agentic development environment.'
  workspace = 'PARALITH brings projects, agents, terminals, repositories, and development workflows into one operational workspace.'
  parallel = 'Run specialized agents in parallel. Isolate their work. Track their state. Focus where human judgment is needed.'
  repository = 'Review every change. Branches, diffs, pull requests, workflows, releases, and risks, without leaving the workspace.'
  record = 'Tasks, attempts, sources, tests, and evidence stay attached to the work, so context survives every handoff.'
  decision = 'Automate the work. Preserve the evidence. Keep the final decision human.'
  direction = 'Don''t just code with agents. Direct them. PARALITH.'
}

$voice = 'Microsoft Mark'
$available = [System.Speech.Synthesis.SpeechSynthesizer]::new().GetInstalledVoices() |
  ForEach-Object { $_.VoiceInfo.Name }
if ($voice -notin $available) {
  $voice = 'Microsoft David Desktop'
}

foreach ($entry in $lines.GetEnumerator()) {
  $wave = Join-Path $waveDir "$($entry.Key).wav"
  $mp3 = Join-Path $mp3Dir "$($entry.Key).mp3"
  $synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
  try {
    $synth.SelectVoice($voice)
    $synth.Rate = 1
    $synth.Volume = 100
    $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
      48000,
      [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
      [System.Speech.AudioFormat.AudioChannel]::Mono
    )
    $synth.SetOutputToWaveFile($wave, $format)
    $synth.Speak($entry.Value)
  } finally {
    $synth.Dispose()
  }

  & ffmpeg -hide_banner -loglevel error -y -i $wave `
    -af 'highpass=f=72,lowpass=f=12000,acompressor=threshold=-18dB:ratio=2.5:attack=12:release=180,loudnorm=I=-16:TP=-1.5:LRA=7' `
    -ar 48000 -ac 2 -codec:a libmp3lame -b:a 192k $mp3
  if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg failed for $($entry.Key)"
  }
  $relative = $mp3.Substring($root.Length).TrimStart('\')
  Write-Host "$($entry.Key) -> $relative"
}

Write-Host "Voice: $voice"
