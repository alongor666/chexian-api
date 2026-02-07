#!/bin/bash

# 测试后端API的脚本

echo "=== Starting Backend Server ==="
npm run dev > /tmp/backend.log 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

echo "Waiting for server to start..."
sleep 5

echo ""
echo "=== Testing Health Check ==="
curl -s http://localhost:3000/health | jq .

echo ""
echo "=== Testing Login API (admin) ==="
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq .

# 保存Token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.data.token')

echo ""
echo "=== Testing KPI Query API (with auth) ==="
curl -s http://localhost:3000/api/query/test \
  -H "Authorization: Bearer $TOKEN" | jq .

echo ""
echo "=== Done ==="
echo "Server is running on PID: $SERVER_PID"
echo "To stop: kill $SERVER_PID"
