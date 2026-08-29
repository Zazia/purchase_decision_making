#Requires -Version 5.1
# Build BGM + intro/outro SFX for product-tour (deterministic ffmpeg synthesis, ASCII only).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\make-sfx.ps1
param(
  [double]$VideoDur = 61.48,
  [string]$BgmSrc = "assets/audio/bgm-city-sunshine.mp3",
  [string]$SfxDir = "assets/audio/sfx"
)
$ErrorActionPreference = "Stop"
$ffmpeg = "C:\Users\Administrator\.local\bin\ffmpeg.exe"
New-Item -ItemType Directory -Force $SfxDir | Out-Null

# ---- BGM: trim to video length, fade in/out ----
& $ffmpeg -y -v error -i $BgmSrc -af "atrim=0:$VideoDur,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=1.2,afade=t=out:st=$($VideoDur-2.5):d=2.5" -c:a libmp3lame -b:a 128k assets/audio/bgm-main.mp3
if ($LASTEXITCODE -ne 0) { throw "bgm failed" }
Write-Host "built bgm-main.mp3"

# ---- Intro 1. Impact: pitch-dropping thump + shimmer (logo lands at 0.25s) ----
& $ffmpeg -y -v error `
  -f lavfi -i "aevalsrc=0.85*sin(2*PI*(170-110*t)*t)*exp(-13*t):s=44100:d=0.4" `
  -f lavfi -i "aevalsrc=0.30*sin(2*PI*1568*t)*exp(-20*t):s=44100:d=0.35" `
  -filter_complex "[0][1]amix=inputs=2:duration=first:normalize=0[a]" `
  -map "[a]" -ar 24000 -ac 1 -b:a 64k "$SfxDir/sfx-intro-impact.mp3"
if ($LASTEXITCODE -ne 0) { throw "intro-impact failed" }
Write-Host "built sfx-intro-impact.mp3"

# ---- Intro 2. Dot pops: 12 rising-pitch blips, 55ms apart (dots 0.35-1.15s) ----
$popIn = @(); $popChain = @()
for ($i = 0; $i -lt 12; $i++) {
  $f = 760 + $i * 36
  $popIn += @("-f","lavfi","-i","aevalsrc=0.42*sin(2*PI*$f*t)*exp(-45*t):s=44100:d=0.09")
  $ms = [int]($i * 55)
  $popChain += "[$i]adelay=$ms|$ms[p$i]"
}
$labels = (0..11 | ForEach-Object { "[p$_]" }) -join ""
$popFilter = ($popChain -join ";") + ";" + $labels + "amix=inputs=12:duration=longest:normalize=0[a]"
& $ffmpeg -y -v error @popIn -filter_complex $popFilter -map "[a]" -ar 24000 -ac 1 -b:a 64k "$SfxDir/sfx-intro-pops.mp3"
if ($LASTEXITCODE -ne 0) { throw "intro-pops failed" }
Write-Host "built sfx-intro-pops.mp3"

# ---- Intro 3. Whoosh: band-limited pink noise, sine envelope (logo exits 1.6s) ----
& $ffmpeg -y -v error `
  -f lavfi -i "anoisesrc=color=pink:duration=0.5:amplitude=0.8" `
  -af "highpass=f=180,lowpass=f=1400,volume='pow(sin(PI*t/0.5),1.4)':eval=frame" `
  -ar 24000 -ac 1 -b:a 64k "$SfxDir/sfx-intro-whoosh.mp3"
if ($LASTEXITCODE -ne 0) { throw "intro-whoosh failed" }
Write-Host "built sfx-intro-whoosh.mp3"

# ---- Outro 1. Swell: brown-noise pad + soft sine, rising (scene enters 56.48s) ----
& $ffmpeg -y -v error `
  -f lavfi -i "anoisesrc=color=brown:duration=1.3:amplitude=0.5" `
  -f lavfi -i "aevalsrc='0.30*sin(2*PI*196*t)*min(1,t*3)*exp(-0.8*t)':s=44100:d=1.3" `
  -filter_complex "[0]lowpass=f=500,volume='pow(t/1.3,2)*1.3':eval=frame[n];[n][1]amix=inputs=2:duration=first:normalize=0[a]" `
  -map "[a]" -ar 24000 -ac 1 -b:a 64k "$SfxDir/sfx-outro-swell.mp3"
if ($LASTEXITCODE -ne 0) { throw "outro-swell failed" }
Write-Host "built sfx-outro-swell.mp3"

# ---- Outro 2. Dot pops: 12 blips, 60ms apart (outro dots 0.4-1.4s) ----
$popIn2 = @(); $popChain2 = @()
for ($i = 0; $i -lt 12; $i++) {
  $f = 660 + $i * 40
  $popIn2 += @("-f","lavfi","-i","aevalsrc=0.42*sin(2*PI*$f*t)*exp(-40*t):s=44100:d=0.10")
  $ms = [int]($i * 60)
  $popChain2 += "[$i]adelay=$ms|$ms[q$i]"
}
$labels2 = (0..11 | ForEach-Object { "[q$_]" }) -join ""
$popFilter2 = ($popChain2 -join ";") + ";" + $labels2 + "amix=inputs=12:duration=longest:normalize=0[a]"
& $ffmpeg -y -v error @popIn2 -filter_complex $popFilter2 -map "[a]" -ar 24000 -ac 1 -b:a 64k "$SfxDir/sfx-outro-pops.mp3"
if ($LASTEXITCODE -ne 0) { throw "outro-pops failed" }
Write-Host "built sfx-outro-pops.mp3"

# ---- Outro 3. Chime: major triad arpeggio, long decay (tagline 57.58s) ----
$chimeIn = @(); $chimeChain = @()
$notes = @(1046.5, 1318.5, 1568.0)
for ($i = 0; $i -lt $notes.Count; $i++) {
  $f = $notes[$i]
  $chimeIn += @("-f","lavfi","-i","aevalsrc=0.26*sin(2*PI*$f*t)*exp(-2.6*t):s=44100:d=2.2")
  $ms = [int]($i * 180)
  $chimeChain += "[$i]adelay=$ms|$ms[c$i]"
}
$labels3 = (0..2 | ForEach-Object { "[c$_]" }) -join ""
$chimeFilter = ($chimeChain -join ";") + ";" + $labels3 + "amix=inputs=3:duration=longest:normalize=0[a]"
& $ffmpeg -y -v error @chimeIn -filter_complex $chimeFilter -map "[a]" -ar 24000 -ac 1 -b:a 64k "$SfxDir/sfx-outro-chime.mp3"
if ($LASTEXITCODE -ne 0) { throw "outro-chime failed" }
Write-Host "built sfx-outro-chime.mp3"

Write-Host "done."
