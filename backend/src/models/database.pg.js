/**
 * 龟钮印证 — 数据库连接 (PostgreSQL for CloudBase)
 * 使用 pg 连接 CloudBase PostgreSQL
 */

const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    const host = process.env.PG_HOST || '29.126.137.25';
    const port = parseInt(process.env.PG_PORT || '5432');
    const database = process.env.PG_DATABASE || 'x402';
    const user = process.env.PG_USER || 'x402';
    const password = process.env.PG_PASSWORD || '***';
    pool = new Pool({ host, port, database, user, password, max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
  }
  return pool;
}

async function query(sql, params = []) {
  const client = await getPool().connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
  }
}

async function getDb() {
  return { query, getPool: () => pool };
}

async function initSchema() {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      "openId" TEXT UNIQUE,
      "nickName" TEXT DEFAULT '',
      "avatarUrl" TEXT DEFAULT '',
      platform TEXT DEFAULT 'alipay',
      role TEXT DEFAULT 'C',
      "createdAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      "userId" TEXT,
      amount REAL DEFAULT 0,
      subject TEXT DEFAULT '',
      description TEXT DEFAULT '',
      "payerId" TEXT,
      "payeeId" TEXT,
      channel TEXT DEFAULT 'alipay',
      status TEXT DEFAULT 'pending',
      "tradeNo" TEXT DEFAULT '',
      hash TEXT DEFAULT '',
      nonce TEXT DEFAULT '',
      "bFee" REAL DEFAULT 0,
      "paidAt" TIMESTAMP,
      "createdAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      "userId" TEXT,
      amount REAL DEFAULT 0,
      type TEXT DEFAULT '',
      description TEXT DEFAULT '',
      "refId" TEXT DEFAULT '',
      "createdAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wallets (
      "userId" TEXT PRIMARY KEY,
      balance REAL DEFAULT 0,
      "dataEarnings" REAL DEFAULT 0,
      "pendingBalance" REAL DEFAULT 0,
      "promotionBalance" REAL DEFAULT 0,
      "totalIncome" REAL DEFAULT 0,
      "totalExpense" REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS hashes (
      id TEXT PRIMARY KEY,
      "txId" TEXT,
      hash TEXT,
      "dataDigest" TEXT,
      "dataType" TEXT DEFAULT 'payment',
      metadata TEXT DEFAULT '{}',
      "createdAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notaries (
      id TEXT PRIMARY KEY,
      "txId" TEXT,
      "userId" TEXT,
      provider TEXT DEFAULT '',
      "certificateNo" TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      metadata TEXT DEFAULT '{}',
      "createdAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS data_products (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      "dataType" TEXT DEFAULT '',
      dimensions TEXT DEFAULT '[]',
      price REAL DEFAULT 0,
      "sampleSize" INTEGER DEFAULT 0,
      "createdAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS data_orders (
      id TEXT PRIMARY KEY,
      "productId" TEXT,
      "buyerId" TEXT,
      amount REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      "createdAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS data_consents (
      "userId" TEXT PRIMARY KEY,
      scope TEXT DEFAULT 'none',
      "updatedAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agent_payments (
      id TEXT PRIMARY KEY,
      "agentId" TEXT,
      "userId" TEXT,
      amount REAL DEFAULT 0,
      "useCase" TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      report TEXT DEFAULT '',
      "createdAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_tags (
      id SERIAL PRIMARY KEY,
      "userId" TEXT,
      key TEXT,
      value TEXT,
      source TEXT DEFAULT 'manual',
      "createdAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS governance_alerts (
      id TEXT PRIMARY KEY,
      "userId" TEXT,
      level TEXT DEFAULT 'info',
      type TEXT DEFAULT '',
      message TEXT DEFAULT '',
      status TEXT DEFAULT 'unread',
      "createdAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS promo_records (
      id TEXT PRIMARY KEY,
      "promoterId" TEXT,
      campaign TEXT DEFAULT '',
      "inviteCount" INTEGER DEFAULT 0,
      reward REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      "createdAt" TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS guinieu_events (
      event_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      ts TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      payload_hash TEXT NOT NULL,
      prev_event_id TEXT,
      sig_method TEXT DEFAULT 'none',
      sig TEXT,
      status TEXT DEFAULT 'active',
      reason TEXT,
      created_by TEXT,
      ref_tx_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_payments_user ON payments("userId");
    CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments("payerId");
    CREATE INDEX IF NOT EXISTS idx_payments_payee ON payments("payeeId");
    CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions("userId");
    CREATE INDEX IF NOT EXISTS idx_hashes_tx ON hashes("txId");
    CREATE INDEX IF NOT EXISTS idx_notary_user ON notaries("userId");
    CREATE INDEX IF NOT EXISTS idx_user_tags_user ON user_tags("userId");
    CREATE INDEX IF NOT EXISTS idx_governance_alerts_user ON governance_alerts("userId");
    CREATE INDEX IF NOT EXISTS idx_guinieu_prev ON guinieu_events(prev_event_id);
    CREATE INDEX IF NOT EXISTS idx_guinieu_ref_tx ON guinieu_events(ref_tx_id);
  `;

  await query(sql);
  console.log('[数据库] 表结构初始化完成');
}

module.exports = { getDb, query, initSchema };