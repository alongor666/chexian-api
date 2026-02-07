@echo off
chcp 65001 >nul
:menu
cls
echo ============================================================
echo   车险业务分析系统 - 访问日志审计
echo ============================================================
echo.
echo   1. 查看最近50条访问记录
echo   2. 查看今日访问记录
echo   3. 查看指定用户的访问记录
echo   4. 统计各用户访问次数
echo   5. 查看错误日志
echo   6. 导出完整日志
echo   0. 返回
echo.
set /p choice=请选择 (0-6):

if "%choice%"=="1" goto recent
if "%choice%"=="2" goto today
if "%choice%"=="3" goto user
if "%choice%"=="4" goto stats
if "%choice%"=="5" goto error
if "%choice%"=="6" goto export
if "%choice%"=="0" exit /b
goto menu

:recent
echo.
echo ============ 最近50条访问记录 ============
if exist "logs\access.log" (
    powershell -Command "Get-Content 'logs\access.log' -Tail 50"
) else (
    echo [提示] 暂无访问日志
)
echo.
pause
goto menu

:today
echo.
echo ============ 今日访问记录 ============
set today=%date:~0,10%
if exist "logs\access.log" (
    powershell -Command "$today = Get-Date -Format 'dd/MMM/yyyy'; Get-Content 'logs\access.log' | Select-String $today"
) else (
    echo [提示] 暂无访问日志
)
echo.
pause
goto menu

:user
echo.
set /p username=请输入用户名:
echo.
echo ============ 用户 %username% 的访问记录 ============
if exist "logs\access.log" (
    powershell -Command "Get-Content 'logs\access.log' | Select-String ' %username% '"
) else (
    echo [提示] 暂无访问日志
)
echo.
pause
goto menu

:stats
echo.
echo ============ 用户访问统计 ============
if exist "logs\access.log" (
    powershell -Command "$log = Get-Content 'logs\access.log'; $users = $log | ForEach-Object { if($_ -match '- (\w+) \[') { $matches[1] } }; $users | Group-Object | Sort-Object Count -Descending | Format-Table Name, Count -AutoSize"
) else (
    echo [提示] 暂无访问日志
)
echo.
pause
goto menu

:error
echo.
echo ============ 错误日志（最近30条） ============
if exist "logs\error.log" (
    powershell -Command "Get-Content 'logs\error.log' -Tail 30"
) else (
    echo [提示] 暂无错误日志
)
echo.
pause
goto menu

:export
echo.
set filename=访问日志_%date:~0,4%%date:~5,2%%date:~8,2%.txt
copy logs\access.log "%filename%" >nul 2>&1
if exist "%filename%" (
    echo [成功] 已导出到 %filename%
) else (
    echo [错误] 导出失败
)
pause
goto menu
