#Requires -Version 5.1
<#
.SYNOPSIS
  从 assets/audio/narration-script.txt 批量生成中文旁白音频（edge-tts）。
.DESCRIPTION
  每条流程：edge-tts 生成临时音频 -> 实测时长，超「建议时长+0.5s」的条目
  按 --rate 加速重生成一次 -> ffmpeg 垫首尾各 0.2s 静音 -> 输出 assets/audio/capNN.mp3。
  最终在控制台打印时长对照表，并写 scripts/debug/narration-durations.json。
.NOTES
  依赖：uv（提供 edge-tts 临时环境）、完整版 ffmpeg/ffprobe（.local/bin）。
  用法：pwsh -File scripts/generate-narration.ps1 [-Voice zh-CN-YunxiNeural]
#>
param(
  [string]$Voice = "zh-CN-YunxiNeural",
  [string]$ScriptFile = "assets/audio/narration-script.txt",
  [string]$OutDir = "assets/audio",
  [string]$Rate = "",            # 全局语速，如 "+20%"（edge-tts 原生变速，不改音调）
  [double]$TailSilence = 0.2,
  [double]$LeadSilence = 0.2,
  [double]$Tolerance = 0.5
)

# 逐条微调（覆盖全局默认）：rate/volume 走 edge-tts 原生参数，lead/tail 为首尾垫片秒，
# parts 可把一条拆成多段分别合成再拼接（用于制造语气对比，如疑问+陈述），gap 为段间停顿
$entryOverrides = @{
  "01" = @{ parts = @("最好又最便宜的手机？", "并不存在。"); gap = 0.22
            tail = 0.10 }                                 # 设问升调 -> 顿 -> 肯定句收
  "06" = @{ rate = "+8%";  lead = 0.30; tail = 0.55 }     # 产品名揭示：放慢+前后留白着重
  "08" = @{ tail = 0.30 }                                 # 产品 tour 段落收尾
  "14" = @{ rate = "+8%";  volume = "+15%"; tail = 0.50 } # 结尾句：更有力，收束留白
}

$ErrorActionPreference = "Stop"
$ffprobe = "C:\Users\Administrator\.local\bin\ffprobe.exe"
$ffmpeg  = "C:\Users\Administrator\.local\bin\ffmpeg.exe"
$edgeTts = Join-Path $env:USERPROFILE ".local\bin\edge-tts.exe"
# 清空代理变量：经代理访问 speech.platform.bing.com 时 TLS 偶发被重置（NoAudioReceived）
"HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","http_proxy","https_proxy","all_proxy" |
  ForEach-Object { Set-Item -Path "Env:$_" -Value "" }
$tmpDir = Join-Path $PSScriptRoot "debug\narration-tmp"
New-Item -ItemType Directory -Force $tmpDir | Out-Null

function Invoke-WithRetry([scriptblock]$Block, [int]$Times = 3) {
  for ($i = 1; $i -le $Times; $i++) {
    try { return & $Block }
    catch {
      if ($i -eq $Times) { throw }
      Write-Host "  retry $i/$($Times-1) ..." -ForegroundColor Yellow
      Start-Sleep -Seconds (2 * $i)
    }
  }
}

function Get-AudioDuration([string]$Path) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  try {
    $out = & $ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $Path 2>$null
  } finally { $ErrorActionPreference = $prev }
  $s = "$out".Trim()
  if (-not $s) { throw "ffprobe 无法读取 $Path（音频为空或损坏）" }
  return [double]::Parse($s, [Globalization.CultureInfo]::InvariantCulture)
}

function Invoke-Tts([string]$Text, [string]$OutFile, [string]$Rate = "", [string]$Volume = "") {
  if (Test-Path $OutFile) { Remove-Item $OutFile -Force }
  $ttsArgs = @("--voice", $Voice, "--text", $Text)
  if ($Rate)   { $ttsArgs += "--rate=$Rate" }
  if ($Volume) { $ttsArgs += "--volume=$Volume" }
  $ttsArgs += @("--write-media", $OutFile)
  & $edgeTts @ttsArgs 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "edge-tts 退出码 $LASTEXITCODE" }
  if (-not (Test-Path $OutFile) -or (Get-Item $OutFile).Length -lt 2048) { throw "产物缺失或过小：$OutFile" }
  Get-AudioDuration $OutFile | Out-Null
}

# ---- 解析清单：行格式 "NN  capNN.mp3   建议时长 ≤X.Xs"，下一非空行为文本 ----
$entries = @()
$lines = Get-Content $ScriptFile -Encoding UTF8
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^(\d{2})\s+(cap\d{2}\.mp3)\s+建议时长\s+≤([\d.]+)s') {
    $text = $lines[$i + 1].Trim()
    $entries += [pscustomobject]@{
      Id = $Matches[1]; File = $Matches[2]
      Target = [double]::Parse($Matches[3], [Globalization.CultureInfo]::InvariantCulture)
      Text = $text
    }
  }
}
if ($entries.Count -eq 0) { throw "清单解析失败：$ScriptFile 中未找到任何条目" }
Write-Host "解析到 $($entries.Count) 条旁白，音色 $Voice`n" -ForegroundColor Cyan

# ---- 逐条生成 ----
$report = foreach ($e in $entries) {
  $raw = Join-Path $tmpDir $e.File
  $out = Join-Path $OutDir $e.File
  $o    = $entryOverrides[$e.Id]
  $rate = if ($o -and $o.rate)   { $o.rate }   else { $Rate }
  $vol  = if ($o -and $o.volume) { $o.volume } else { "" }
  $lead = if ($o -and $o.lead)   { [double]$o.lead } else { $LeadSilence }
  $tail = if ($o -and $o.tail)   { [double]$o.tail } else { $TailSilence }

  if ($o -and $o.parts) {
    # 分段合成再拼接：每段独立成句获得完整语调轮廓（如问句升调），段间垫 gap 静音
    $gap = if ($o.gap) { [double]$o.gap } else { 0.15 }
    $gapFile = Join-Path $tmpDir "_gap.mp3"
    & $ffmpeg -y -v error -f lavfi -i anullsrc=r=24000:cl=mono -t $gap -b:a 64k $gapFile
    $seq = @(); $pi = 0
    foreach ($p in $o.parts) {
      $seg = Join-Path $tmpDir ($e.File.Replace(".mp3", ".p$pi.mp3"))
      Invoke-WithRetry { Invoke-Tts $p $seg $rate $vol } | Out-Null
      $seq += $seg
      if ($pi -lt $o.parts.Count - 1) { $seq += $gapFile }
      $pi++
    }
    $ffIn = @(); $labels = @(); $i = 0
    foreach ($s in $seq) { $ffIn += @("-i", $s); $labels += "[$i`:a]"; $i++ }
    $filter = ($labels -join "") + "concat=n=$($seq.Count):v=0:a=1[a]"
    & $ffmpeg -y -v error @ffIn -filter_complex $filter -map "[a]" $raw
  } else {
    Invoke-WithRetry { Invoke-Tts $e.Text $raw $rate $vol } | Out-Null
  }

  $dur = Get-AudioDuration $raw
  $limit = $e.Target + $Tolerance
  if (-not $Rate -and $dur -gt $limit) {
    $pct = [Math]::Ceiling((($dur / ($e.Target + 0.1)) - 1) * 100)
    $pct = [Math]::Min([Math]::Max($pct, 5), 30)
    $rate = "+$pct%"
    Write-Host "  $($e.Id) 超时（$([Math]::Round($dur,2))s > $limit s），以 rate=$rate 重生成" -ForegroundColor Yellow
    Invoke-WithRetry { Invoke-Tts $e.Text $raw $rate $vol } | Out-Null
    $dur = Get-AudioDuration $raw
  }

  # 垫首尾静音（句间停顿 = 前条尾垫 + 本条首垫）
  $padMs = [int]($lead * 1000)
  & $ffmpeg -y -v error -i $raw -af "adelay=$padMs,apad=pad_dur=$tail" -ar 24000 -ac 1 -b:a 64k $out
  $finalDur = Get-AudioDuration $out

  [pscustomobject]@{
    id = $e.Id; file = $e.File; text = $e.Text
    target_s = $e.Target; voice_s = [Math]::Round($dur, 3)
    final_s = [Math]::Round($finalDur, 3)
    rate = $rate; volume = $vol; lead_s = $lead; tail_s = $tail
    ok = ($finalDur -le ($limit + $lead + $tail))
  }
  Write-Host ("{0}  {1}  语音 {2,5:N2}s + 垫片 = {3,5:N2}s（建议 ≤{4:N1}s）" -f $e.Id, $e.File, $dur, $finalDur, $e.Target)
}

# ---- 汇总 ----
$total = ($report | Measure-Object -Property final_s -Sum).Sum
$report | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot "debug\narration-durations.json") -Encoding UTF8
Write-Host ("`n合计 $($report.Count) 条，总时长 {0:N1}s" -f $total) -ForegroundColor Cyan
Write-Host "时长明细已写入 scripts/debug/narration-durations.json"
