#!/bin/bash

echo "=== Testing APIs with Real Data ==="

# 登录并获取Token
echo -e "\n1. Login as admin..."
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  --data-raw '{"username":"admin","password":"dev"}' | jq -r '.data.token')

echo "Token: ${TOKEN:0:50}..."

# 测试查询
echo -e "\n2. Test query with permission filter..."
curl -s http://localhost:3000/api/query/test \
  -H "Authorization: Bearer $TOKEN" | jq .

echo -e "\n3. Test KPI query..."
curl -s "http://localhost:3000/api/query/kpi?startDate=2026-01-01&endDate=2026-01-31" \
  -H "Authorization: Bearer $TOKEN" | jq .

echo -e "\n=== Done ==="
