const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'gn_data.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      openId TEXT UNIQUE,
      nickName TEXT DEFAULT '',
      avatarUrl TEXT DEFAULT '',
      platform TEXT DEFAULT 'alipay',
      role TEXT DEFAULT 'C',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      userId TEXT,
      amount REAL DEFAULT 0,
      subject TEXT DEFAULT '',
      description TEXT DEFAULT '',
      payerId TEXT,
      payeeId TEXT,
      channel TEXT DEFAULT 'alipay',
      status TEXT DEFAULT 'pending',
      tradeNo TEXT DEFAULT '',
      hash TEXT DEFAULT '',
      nonce TEXT DEFAULT '',
      bFee REAL DEFAULT 0,
      paidAt TEXT,
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      userId TEXT,
      amount REAL DEFAULT 0,
      type TEXT DEFAULT '',
      description TEXT DEFAULT '',
      refId TEXT DEFAULT '',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wallets (
      userId TEXT PRIMARY KEY,
      balance REAL DEFAULT 0,
      dataEarnings REAL DEFAULT 0,
      pendingBalance REAL DEFAULT 0,
      promotionBalance REAL DEFAULT 0,
      totalIncome REAL DEFAULT 0,
      totalExpense REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS hashes (
      id TEXT PRIMARY KEY,
      txId TEXT,
      hash TEXT,
      dataDigest TEXT,
      dataType TEXT DEFAULT 'payment',
      metadata TEXT DEFAULT '{}',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notaries (
      id TEXT PRIMARY KEY,
      txId TEXT,
      userId TEXT,
      provider TEXT DEFAULT '',
      certificateNo TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      metadata TEXT DEFAULT '{}',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS data_products (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      description TEXT DEFAULT '',
      dataType TEXT DEFAULT '',
      dimensions TEXT DEFAULT '[]',
      price REAL DEFAULT 0,
      sampleSize INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS data_orders (
      id TEXT PRIMARY KEY,
      productId TEXT,
      buyerId TEXT,
      amount REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS data_consents (
      userId TEXT PRIMARY KEY,
      scope TEXT DEFAULT 'none',
      updatedAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS agent_payments (
      id TEXT PRIMARY KEY,
      agentId TEXT,
      userId TEXT,
      amount REAL DEFAULT 0,
      useCase TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      report TEXT DEFAULT '',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT,
      key TEXT,
      value TEXT,
      source TEXT DEFAULT 'manual',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS governance_alerts (
      id TEXT PRIMARY KEY,
      userId TEXT,
      level TEXT DEFAULT 'info',
      type TEXT DEFAULT '',
      message TEXT DEFAULT '',
      status TEXT DEFAULT 'unread',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS promo_records (
      id TEXT PRIMARY KEY,
      promoterId TEXT,
      campaign TEXT DEFAULT '',
      inviteCount INTEGER DEFAULT 0,
      reward REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(userId);
    CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments(payerId);
    CREATE INDEX IF NOT EXISTS idx_payments_payee ON payments(payeeId);
    CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(userId);
    CREATE INDEX IF NOT EXISTS idx_hashes_tx ON hashes(txId);
    CREATE INDEX IF NOT EXISTS idx_notary_user ON notaries(userId);
    CREATE INDEX IF NOT EXISTS idx_user_tags_user ON user_tags(userId);
    CREATE INDEX IF NOT EXISTS idx_governance_alerts_user ON governance_alerts(userId);

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
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_guinieu_prev ON guinieu_events(prev_event_id);
    CREATE INDEX IF NOT EXISTS idx_guinieu_ref_tx ON guinieu_events(ref_tx_id);
  `);

  // 兼容性迁移：旧表可能缺少新增列
  const migrations = [
    "ALTER TABLE payments ADD COLUMN hash TEXT DEFAULT ''",
    "ALTER TABLE payments ADD COLUMN nonce TEXT DEFAULT ''",
    "ALTER TABLE payments ADD COLUMN bFee REAL DEFAULT 0",
    "ALTER TABLE payments ADD COLUMN paidAt TEXT",
    "ALTER TABLE payments ADD COLUMN guinieu_event_id TEXT",
    "ALTER TABLE wallets ADD COLUMN promotionBalance REAL DEFAULT 0",
    "ALTER TABLE wallets ADD COLUMN totalIncome REAL DEFAULT 0",
    "ALTER TABLE wallets ADD COLUMN totalExpense REAL DEFAULT 0",
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (e) { /* column already exists */ }
  }
}

module.exports = { getDb, DB_PATH };
