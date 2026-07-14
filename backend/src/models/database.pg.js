/**
 * 龟钮印证 — 数据库连接 (PostgreSQL via CloudBase API)
 * 使用 tencentcloud-sdk 调用 ExecutePGSql API
 */

const tencentcloud = require('tencentcloud-sdk-nodejs-tcb');
const fs = require('fs');
const path = require('path');

let tcbClient;
let cachedCreds;

function getCredentials() {
  if (cachedCreds) return cachedCreds;
  
  // 优先从环境变量读取
  if (process.env.TCB_SECRET_ID && process.env.TCB_SECRET_KEY) {
    cachedCreds = { secretId: process.env.TCB_SECRET_ID, secretKey: process.env.TCB_SECRET_KEY };
    console.log('[DB] Using credentials from environment variables');
    return cachedCreds;
  } else {
    console.log('[DB] TCB_SECRET_ID:', process.env.TCB_SECRET_ID ? 'set' : 'NOT SET');
    console.log('[DB] TCB_SECRET_KEY:', process.env.TCB_SECRET_KEY ? 'set' : 'NOT SET');
  }
  
  // 尝试从 SecretKey.csv 文件读取
  const csvPaths = [
    '/app/SecretKey.csv',
    path.join(__dirname, '..', '..', 'SecretKey.csv'),
    path.join(__dirname, '..', '..', '..', 'SecretKey.csv'),
  ];
  
  for (const csvPath of csvPaths) {
    try {
      if (fs.existsSync(csvPath)) {
        const content = fs.readFileSync(csvPath, 'utf-8').trim();
        const lines = content.split('\n');
        if (lines.length >= 2) {
          const vals = lines[1].split(',');
          cachedCreds = { secretId: vals[0].trim(), secretKey: vals[1].trim() };
          console.log('[DB] Loaded credentials from:', csvPath);
          return cachedCreds;
        }
      }
    } catch (e) {
      // ignore
    }
  }
  
  // 最后的 fallback（不推荐）
  cachedCreds = {
    secretId: 'AKIDhV8YloiQ2RdcPytbAXhgS1NWUGqCbxAh',
    secretKey: 'QejcMwQlppdSEtOiDcpttkQt9FBxY5d4'
  };
  console.log('[DB] WARNING: Using hardcoded credentials');
  return cachedCreds;
}

function getTcbClient() {
  if (!tcbClient) {
    const creds = getCredentials();
    tcbClient = new (tencentcloud.tcb.v20180608.Client)({
      credential: { secretId: creds.secretId, secretKey: creds.secretKey },
      region: 'ap-shanghai',
      profile: { httpProfile: { endpoint: 'tcb.tencentcloudapi.com' } },
    });
  }
  return tcbClient;
}

async function query(sql, params = []) {
  let finalSql = sql;
  if (params.length > 0) {
    for (let i = 0; i < params.length; i++) {
      const val = params[i];
      let escaped;
      if (val === null || val === undefined) {
        escaped = 'NULL';
      } else if (typeof val === 'number') {
        escaped = val.toString();
      } else if (typeof val === 'boolean') {
        escaped = val ? 'true' : 'false';
      } else {
        escaped = "'" + val.toString().replace(/'/g, "''") + "'";
      }
      finalSql = finalSql.replace(new RegExp('\\$' + (i + 1) + '(?![0-9])', 'g'), escaped);
    }
  }

  const client = getTcbClient();
  // ExecutePGSql 默认连到 cloudbase_admin 的默认库
  // 需要先切换到 x402 数据库
  const response = await client.ExecutePGSql({
    EnvId: process.env.TCB_ENV_ID || 'x402-d1g9iojop685ea11a',
    Sql: finalSql
  });

  return {
    rows: response.Rows ? response.Rows.map(r => {
      try { return JSON.parse(r); } catch(e) { return r; }
    }) : [],
    rowCount: response.Rows ? response.Rows.length : 0,
    fields: response.Columns ? response.Columns.map(c => ({ name: c })) : [],
    command: 'SELECT',
  };
}

async function getDb() {
  return { query, getPool: () => ({}) };
}

async function initSchema() {
  // 建表语句，列名匹配 dataStore.pg.js 中使用的 camelCase 带引号列名
  const schemaSql = [
    'CREATE TABLE IF NOT EXISTS users (',
    '  id VARCHAR(64) PRIMARY KEY,',
    '  "openId" VARCHAR(128) UNIQUE,',
    '  "nickName" VARCHAR(128),',
    '  "avatarUrl" TEXT,',
    '  platform VARCHAR(32) DEFAULT \'alipay\',',
    '  role VARCHAR(16) DEFAULT \'C\',',
    '  "createdAt" TIMESTAMP DEFAULT NOW()',
    ');',
    'CREATE TABLE IF NOT EXISTS payments (',
    '  id VARCHAR(64) PRIMARY KEY,',
    '  "userId" VARCHAR(64),',
    '  amount DECIMAL(20,8),',
    '  subject VARCHAR(256),',
    '  description TEXT,',
    '  "payerId" VARCHAR(64),',
    '  "payeeId" VARCHAR(64),',
    '  channel VARCHAR(32) DEFAULT \'alipay\',',
    '  status VARCHAR(32) DEFAULT \'pending\',',
    '  "tradeNo" VARCHAR(128),',
    '  hash VARCHAR(256),',
    '  "paidAt" TIMESTAMP,',
    '  "createdAt" TIMESTAMP DEFAULT NOW()',
    ');',
    'CREATE TABLE IF NOT EXISTS wallets (',
    '  "userId" VARCHAR(64) PRIMARY KEY,',
    '  balance DECIMAL(20,8) DEFAULT 0,',
    '  "dataEarnings" DECIMAL(20,8) DEFAULT 0,',
    '  "pendingBalance" DECIMAL(20,8) DEFAULT 0,',
    '  "promotionBalance" DECIMAL(20,8) DEFAULT 0,',
    '  "totalIncome" DECIMAL(20,8) DEFAULT 0,',
    '  "totalExpense" DECIMAL(20,8) DEFAULT 0,',
    '  "createdAt" TIMESTAMP DEFAULT NOW()',
    ');',
    'CREATE TABLE IF NOT EXISTS wallet_transactions (',
    '  id VARCHAR(64) PRIMARY KEY,',
    '  "userId" VARCHAR(64),',
    '  amount DECIMAL(20,8),',
    '  type VARCHAR(32),',
    '  description TEXT,',
    '  "refId" VARCHAR(128),',
    '  "createdAt" TIMESTAMP DEFAULT NOW()',
    ');',
    'CREATE TABLE IF NOT EXISTS hashes (',
    '  id VARCHAR(64) PRIMARY KEY,',
    '  "txId" VARCHAR(64),',
    '  hash VARCHAR(256),',
    '  "dataDigest" VARCHAR(256),',
    '  "dataType" VARCHAR(32),',
    '  metadata TEXT DEFAULT \'{}\'',',
    '  "createdAt" TIMESTAMP DEFAULT NOW()',
    ');',
    'CREATE TABLE IF NOT EXISTS notaries (',
    '  id VARCHAR(64) PRIMARY KEY,',
    '  "txId" VARCHAR(64),',
    '  "userId" VARCHAR(64),',
    '  provider VARCHAR(64),',
    '  "certificateNo" VARCHAR(128),',
    '  status VARCHAR(32) DEFAULT \'pending\',',
    '  metadata TEXT DEFAULT \'{}\'',',
    '  "createdAt" TIMESTAMP DEFAULT NOW()',
    ');',
    'CREATE TABLE IF NOT EXISTS data_products (',
    '  id VARCHAR(64) PRIMARY KEY,',
    '  name VARCHAR(256),',
    '  description TEXT,',
    '  "dataType" VARCHAR(64),',
    '  dimensions VARCHAR(256),',
    '  price DECIMAL(20,8),',
    '  "sampleSize" INT,',
    '  "ownerId" VARCHAR(64),',
    '  status VARCHAR(32) DEFAULT \'active\',',
    '  "createdAt" TIMESTAMP DEFAULT NOW()',
    ');',
    'CREATE TABLE IF NOT EXISTS data_consents (',
    '  id VARCHAR(64) PRIMARY KEY,',
    '  "userId" VARCHAR(64),',
    '  "productId" VARCHAR(64),',
    '  status VARCHAR(32) DEFAULT \'pending\',',
    '  "consentedAt" TIMESTAMP,',
    '  "createdAt" TIMESTAMP DEFAULT NOW()',
    ');',
  ].join('\n');
  await query(schemaSql);
  console.log('[DB] Schema initialized via CloudBase API');
}

module.exports = { query, getDb, getPool: () => ({}), initSchema };