@echo off
chcp 65001 >nul
echo ============================================================
echo   车险业务分析系统 - 初始化用户账号
echo ============================================================
echo.
echo 此脚本将创建：
echo   - 1 个管理员账号 (admin)
echo   - 12 个分支机构账号 (branch01-12)
echo.
echo 初始密码将保存到 "初始账号密码.txt"
echo.
set /p confirm=确认执行？(Y/N):

if /i not "%confirm%"=="Y" exit /b

cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "scripts\init-users.ps1"
