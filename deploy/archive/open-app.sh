#!/bin/bash

# 快速打开应用的脚本

echo "🚀 签单业绩分析看板"
echo "===================="
echo ""
echo "开发服务器: http://localhost:5175/"
echo "测试数据: test_data.parquet (5.56 MB)"
echo ""
echo "📊 数据概况:"
echo "  - 保单数: 542,816"
echo "  - 业务员: 313"
echo "  - 机构数: 14"
echo "  - 总保费: 4.22亿"
echo ""
echo "🧪 测试步骤:"
echo "  1. 在浏览器打开上述地址"
echo "  2. 上传 test_data.parquet"
echo "  3. 查看 TESTING_GUIDE.md 获取详细测试说明"
echo ""
echo "正在打开浏览器..."

# 根据操作系统打开浏览器
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    open http://localhost:5175/
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    xdg-open http://localhost:5175/
else
    echo "请手动打开: http://localhost:5175/"
fi

echo ""
echo "✅ 浏览器已打开！"
echo "📖 查看 TESTING_GUIDE.md 了解详细测试步骤"
