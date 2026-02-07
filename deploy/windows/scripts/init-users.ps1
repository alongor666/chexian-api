# 批量初始化用户
# 为12个分支机构创建默认账号

$branches = @(
    @{Name="branch01"; Desc="分支机构1"},
    @{Name="branch02"; Desc="分支机构2"},
    @{Name="branch03"; Desc="分支机构3"},
    @{Name="branch04"; Desc="分支机构4"},
    @{Name="branch05"; Desc="分支机构5"},
    @{Name="branch06"; Desc="分支机构6"},
    @{Name="branch07"; Desc="分支机构7"},
    @{Name="branch08"; Desc="分支机构8"},
    @{Name="branch09"; Desc="分支机构9"},
    @{Name="branch10"; Desc="分支机构10"},
    @{Name="branch11"; Desc="分支机构11"},
    @{Name="branch12"; Desc="分支机构12"}
)

# 管理员账号
$admins = @(
    @{Name="admin"; Desc="系统管理员"}
)

Write-Host "============================================================"
Write-Host "  车险业务分析系统 - 初始化用户账号"
Write-Host "============================================================"
Write-Host ""

# 生成随机密码
function Generate-Password {
    $chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
    $password = -join (1..8 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
    return $password
}

$outputFile = Join-Path $PSScriptRoot "..\初始账号密码.txt"
$output = @()
$output += "============================================================"
$output += "  车险业务分析系统 - 初始账号密码"
$output += "  生成时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$output += "============================================================"
$output += ""
$output += "【重要】请将此文件安全保存，并通知各分支机构修改密码"
$output += ""
$output += "管理员账号："
$output += "----------------------------------------"

# 创建管理员
foreach ($admin in $admins) {
    $password = Generate-Password
    & "$PSScriptRoot\add-user.ps1" -Username $admin.Name -Password $password
    $output += "  用户名: $($admin.Name)"
    $output += "  密码: $password"
    $output += "  说明: $($admin.Desc)"
    $output += ""
}

$output += "分支机构账号："
$output += "----------------------------------------"

# 创建分支账号
foreach ($branch in $branches) {
    $password = Generate-Password
    & "$PSScriptRoot\add-user.ps1" -Username $branch.Name -Password $password
    $output += "  用户名: $($branch.Name)"
    $output += "  密码: $password"
    $output += "  说明: $($branch.Desc)"
    $output += ""
}

$output += "============================================================"
$output += "  首次登录后请立即修改密码！"
$output += "============================================================"

# 保存到文件
$output | Set-Content $outputFile -Encoding UTF8

Write-Host ""
Write-Host "[成功] 已创建 $($admins.Count + $branches.Count) 个账号"
Write-Host ""
Write-Host "初始账号密码已保存到: $outputFile"
Write-Host ""
Write-Host "请将密码文件安全发送给各分支机构负责人"

Read-Host "按回车键继续..."
