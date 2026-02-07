# 添加用户到 .htpasswd 文件
# 使用 SHA1 格式（Nginx 支持）

param(
    [Parameter(Mandatory=$true)][string]$Username,
    [Parameter(Mandatory=$true)][string]$Password
)

$htpasswdPath = Join-Path $PSScriptRoot "..\conf\.htpasswd"
$confDir = Join-Path $PSScriptRoot "..\conf"

# 确保 conf 目录存在
if (!(Test-Path $confDir)) {
    New-Item -ItemType Directory -Path $confDir -Force | Out-Null
}

# 生成 SHA1 密码哈希（Nginx 支持的 {SHA} 格式）
$sha1 = [System.Security.Cryptography.SHA1]::Create()
$passwordBytes = [System.Text.Encoding]::UTF8.GetBytes($Password)
$hashBytes = $sha1.ComputeHash($passwordBytes)
$base64Hash = [Convert]::ToBase64String($hashBytes)

$entry = "${Username}:{SHA}${base64Hash}"

# 检查用户是否已存在
if (Test-Path $htpasswdPath) {
    $existingContent = Get-Content $htpasswdPath -ErrorAction SilentlyContinue
    $userExists = $existingContent | Where-Object { $_ -match "^${Username}:" }

    if ($userExists) {
        # 更新现有用户
        $newContent = $existingContent | ForEach-Object {
            if ($_ -match "^${Username}:") {
                $entry
            } else {
                $_
            }
        }
        $newContent | Set-Content $htpasswdPath
        Write-Host "用户 $Username 已更新"
    } else {
        # 添加新用户
        Add-Content -Path $htpasswdPath -Value $entry
        Write-Host "用户 $Username 已添加"
    }
} else {
    # 创建新文件
    $entry | Set-Content $htpasswdPath
    Write-Host "用户 $Username 已添加"
}
