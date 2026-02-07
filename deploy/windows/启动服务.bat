@echo off
chcp 65001 >nul
echo ============================================================
echo   车险业务分析系统 - 启动服务
echo ============================================================
echo.

cd /d "%~dp0"

REM 检查 nginx 是否已运行
tasklist /FI "IMAGENAME eq nginx.exe" 2>NUL | find /I /N "nginx.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo [警告] Nginx 已在运行中
    echo.
    echo 如需重启，请先运行"停止服务.bat"
    pause
    exit /b
)

REM 检查配置文件
if not exist "nginx.exe" (
    echo [错误] 未找到 nginx.exe
    echo 请先下载 Nginx for Windows 并解压到此目录
    echo 下载地址: https://nginx.org/en/download.html
    pause
    exit /b
)

REM 检查密码文件
if not exist "conf\.htpasswd" (
    echo [警告] 未找到用户密码文件 conf\.htpasswd
    echo 请先运行"用户管理.bat"创建用户
    pause
    exit /b
)

REM 检查数据文件
if not exist "data\data.parquet" (
    echo [警告] 未找到数据文件 data\data.parquet
    echo 请将业务数据文件复制到 data 目录并命名为 data.parquet
)

REM 启动 Nginx
echo 正在启动服务...
start nginx.exe

timeout /t 2 >nul

REM 检查是否启动成功
tasklist /FI "IMAGENAME eq nginx.exe" 2>NUL | find /I /N "nginx.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo.
    echo ============================================================
    echo   [成功] 服务已启动！
    echo ============================================================
    echo.

    REM 获取本机IP
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| find "IPv4"') do (
        set IP=%%a
        goto :found
    )
    :found
    set IP=%IP:~1%

    echo   本机访问: http://localhost:8080
    echo   内网访问: http://%IP%:8080
    echo.
    echo   用户登录后可查看数据分析
    echo   审计日志: logs\access.log
    echo.
) else (
    echo [错误] 服务启动失败，请检查 logs\error.log
)

pause
