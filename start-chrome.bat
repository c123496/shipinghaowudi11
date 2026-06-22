@echo off
chcp 65001 >nul
rem 启动「视频号下载」专用 Chrome：开启 CDP 9222 调试端口 + 专用 profile + 打开元宝
set "PROFILE=%~dp0.chrome-profile"
set "CHROME="
for %%p in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do if exist "%%~p" set "CHROME=%%~p"

if "%CHROME%"=="" (
  echo [X] 没找到 chrome.exe，请手动把路径填到本脚本的 CHROME 变量。
  pause & exit /b 1
)

echo 启动专用 Chrome（调试端口 9222）...
start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%PROFILE%" https://yuanbao.tencent.com
echo.
echo 接下来：在打开的窗口里确认已登录元宝（yuanbao.tencent.com）。
echo 然后回到项目目录运行：python preflight.py  自检全绿即可开跑。
