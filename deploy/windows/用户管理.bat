@echo off
chcp 65001 >nul
:menu
cls
echo ============================================================
echo   车险业务分析系统 - 用户管理
echo ============================================================
echo.
echo   1. 查看所有用户
echo   2. 添加新用户
echo   3. 删除用户
echo   4. 重置用户密码
echo   5. 批量导入用户（从CSV）
echo   6. 导出用户列表
echo   0. 退出
echo.
set /p choice=请选择操作 (0-6):

if "%choice%"=="1" goto list
if "%choice%"=="2" goto add
if "%choice%"=="3" goto delete
if "%choice%"=="4" goto reset
if "%choice%"=="5" goto import
if "%choice%"=="6" goto export
if "%choice%"=="0" exit /b
goto menu

:list
echo.
echo ============ 当前用户列表 ============
if not exist "conf\.htpasswd" (
    echo [提示] 暂无用户
) else (
    echo 用户名:
    for /f "tokens=1 delims=:" %%a in (conf\.htpasswd) do echo   - %%a
)
echo ======================================
pause
goto menu

:add
echo.
set /p username=请输入用户名:
if "%username%"=="" goto menu

set /p password=请输入密码（至少6位）:
if "%password%"=="" goto menu

REM 调用 PowerShell 生成加密密码并添加到文件
powershell -Command "$user='%username%'; $pass='%password%'; $salt = -join ((65..90) + (97..122) | Get-Random -Count 2 | ForEach-Object {[char]$_}); $hash = [System.Web.Security.FormsAuthentication]::HashPasswordForStoringInConfigFile($salt+$pass, 'SHA1'); if(!(Test-Path 'conf')){New-Item -ItemType Directory -Path 'conf' | Out-Null}; Add-Content -Path 'conf\.htpasswd' -Value ('{0}:{{SHA}}{1}' -f $user, [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($salt+$pass)))"

REM 使用更简单的apr1格式
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\add-user.ps1" "%username%" "%password%"

echo.
echo [成功] 用户 %username% 已添加
pause
goto menu

:delete
echo.
set /p username=请输入要删除的用户名:
if "%username%"=="" goto menu

powershell -Command "$content = Get-Content 'conf\.htpasswd' | Where-Object { $_ -notmatch '^%username%:' }; $content | Set-Content 'conf\.htpasswd'"

echo [成功] 用户 %username% 已删除
pause
goto menu

:reset
echo.
set /p username=请输入用户名:
set /p password=请输入新密码:

REM 先删除再添加
powershell -Command "$content = Get-Content 'conf\.htpasswd' | Where-Object { $_ -notmatch '^%username%:' }; $content | Set-Content 'conf\.htpasswd'"
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\add-user.ps1" "%username%" "%password%"

echo [成功] 用户 %username% 密码已重置
pause
goto menu

:import
echo.
echo 请将CSV文件放在当前目录，格式：用户名,密码
echo 文件名：users.csv
echo.
if not exist "users.csv" (
    echo [错误] 未找到 users.csv 文件
    pause
    goto menu
)

for /f "tokens=1,2 delims=," %%a in (users.csv) do (
    echo 添加用户: %%a
    powershell -ExecutionPolicy Bypass -File "%~dp0scripts\add-user.ps1" "%%a" "%%b"
)

echo [成功] 批量导入完成
pause
goto menu

:export
echo.
echo 用户名 > 用户列表.txt
echo -------- >> 用户列表.txt
for /f "tokens=1 delims=:" %%a in (conf\.htpasswd) do echo %%a >> 用户列表.txt
echo [成功] 已导出到 用户列表.txt
pause
goto menu
