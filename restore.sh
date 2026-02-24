#!/bin/bash
set -ex
cd /var/www/chexian
curl -s -H "Authorization: token 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" -o deploy.tar.gz https://raw.githubusercontent.com/alongor666/chexian-api/deploy-bin-temp/chexian-deploy.tar.gz
tar -xzf deploy.tar.gz
cat > server/.env << \ENVEOF
NODE_ENV=production
PORT=3000
JWT_SECRET=$(openssl rand -base64 32 | tr -d '\n')
JWT_EXPIRES_IN=24h
CORS_ORIGIN=https://chexian.cretvalu.com
DUCKDB_PATH=./data/chexian.duckdb
DATA_PATH=./data
LOG_LEVEL=warn
AUDIT_LOG_PATH=../logs/audit.log
WECOM_CORP_ID=ww1a072f6b68b053e2
WECOM_AGENT_ID=10000002
WECOM_SECRET=iP8pUP2K06rU17n2omdMuDpVF0khVWufaR3xKyjSYiQ
WECOM_ADMIN_USERIDS=alongor
ENVEOF
mkdir -p logs server/data
mkdir -p $(printf '\xe6\x95\xb0\xe6\x8d\xae\xe7\xae\xa1\xe7\x90\x86/warehouse/dim/\xe4\xb8\x9a\xe5\x8a\xa1\xe5\x91\x98\xe5\xbd\x92\xe5\xb1\x9e\xe4\xb8\x8e\xe8\xa7\x84\xe5\x88\x92') 2>/dev/null || true
ln -sf /var/www/chexian/server/data/salesman_organization_mapping.json $(printf '\xe6\x95\xb0\xe6\x8d\xae\xe7\xae\xa1\xe7\x90\x86/warehouse/dim/\xe4\xb8\x9a\xe5\x8a\xa1\xe5\x91\x98\xe5\xbd\x92\xe5\xb1\x9e\xe4\xb8\x8e\xe8\xa7\x84\xe5\x88\x92')/salesman_organization_mapping.json 2>/dev/null || true
cd server
npm i --production --ignore-scripts
pm2 restart chexian-api
nginx -s reload
echo "=== RESTORE COMPLETED SUCCESSFULLY ==="
