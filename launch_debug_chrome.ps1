# 启动带 9222 调试端口 + 专用 profile 的 Chrome（供视频号下载用）
# 加防后台冻结参数，避免标签页被节流导致 CDP eval 超时。
$ErrorActionPreference = "SilentlyContinue"
$profile = Join-Path $PSScriptRoot ".chrome-profile"

# 先杀掉旧的调试实例（仅匹配用了本 .chrome-profile 的 chrome，不动普通 Chrome）
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like "*$profile*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 2

$p = Get-Process chrome | Select-Object -First 1 -ExpandProperty Path
if (-not $p) { $p = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe').'(default)' }
if (-not $p) { $p = "C:\Program Files\Google\Chrome\Application\chrome.exe" }
Write-Output ("using: " + $p)

Start-Process $p -ArgumentList `
  "--remote-debugging-port=9222", `
  "--user-data-dir=$profile", `
  "--disable-background-timer-throttling", `
  "--disable-backgrounding-occluded-windows", `
  "--disable-renderer-backgrounding", `
  "--disable-features=CalculateNativeWinOcclusion,TabHoverCardImages", `
  "https://yuanbao.tencent.com"
Write-Output "launched"
