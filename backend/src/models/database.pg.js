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
  const schemaSql = [
    'CREATE TABLE IF NOT EXISTS users (',
    '  id VARCHAR(64) PRIMARY KEY,',
    '  open_id VARCHAR(128) UNIQUE,',
    '  nick_name VARCHAR(128),',
    '  avatar_url TEXT,',
    '  role VARCHAR(16) DEFAULT \'C\',',
    '  balance DECIMAL(20,8) DEFAULT 0,',
    '  created_at TIMESTAMP DEFAULT NOW(),',
    '  updated_at TIMESTAMP DEFAULT NOW()',
    ');',
    'CREATE TABLE IF NOT EXISTS payment_records (',
    '  id SERIAL PRIMARY KEY,',
    '  trade_no VARCHAR(64) UNIQUE,',
    '  user_id VARCHAR(64),',
    '  amount DECIMAL(20,8),',
    '  channel VARCHAR(16),',
    '  status VARCHAR(16) DEFAULT \'pending\',',
    '  created_at TIMESTAMP DEFAULT NOW()',
    ');',
    'CREATE TABLE IF NOT EXISTS hash_records (',
    '  id SERIAL PRIMARY KEY,',
    '  hash VARCHAR(128) UNIQUE,',
    '  user_id VARCHAR(64),',
    '  content_type VARCHAR(32),',
    '  file_name VARCHAR(256),',
    '  file_size BIGINT,',
    '  created_at TIMESTAMP DEFAULT NOW()',
    ');',
    'CREATE TABLE IF NOT EXISTS wallet_operations (',
    '  id SERIAL PRIMARY KEY,',
    '  user_id VARCHAR(64),',
    '  amount DECIMAL(20,8),',
    '  type VARCHAR(16),',
    '  description TEXT,',
    '  created_at TIMESTAMP DEFAULT NOW()',
    ');',
    'CREATE TABLE IF NOT EXISTS data_market_products (',
    '  id SERIAL PRIMARY KEY,',
    '  name VARCHAR(256),',
    '  description TEXT,',
    '  price DECIMAL(20,8),',
    '  owner_id VARCHAR(64),',
    '  status VARCHAR(16) DEFAULT \'active\',',
    '  created_at TIMESTAMP DEFAULT NOW()',
    ');'
  ].join('\n');
  await query(schemaSql);
  console.log('[DB] Schema initialized via CloudBase API');
}

module.exports = { query, getDb, getPool: () => ({}), initSchema };