@echo off
chcp 65001 >nul
echo ============================================================
echo   车险业务分析系统 - 停止服务
echo ============================================================
echo.

cd /d "%~dp0"

tasklist /FI "IMAGENAME eq nginx.exe" 2>NUL | find /I /N "nginx.exe">NUL
if "%ERRORLEVEL%"=="1" (
    echo [提示] Nginx 未在运行
    pause
    exit /b
)

echo 正在停止服务...
nginx.exe -s quit

timeout /t 2 >nul

tasklist /FI "IMAGENAME eq nginx.exe" 2>NUL | find /I /N "nginx.exe">NUL
if "%ERRORLEVEL%"=="1" (
    echo [成功] 服务已停止
) else (
    echo 正在强制停止...
    taskkill /F /IM nginx.exe >nul 2>&1
    echo [成功] 服务已强制停止
)

pause
