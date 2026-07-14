/**
 * 龟钮印证 — 数据存储 (PostgreSQL 版)
 * 所有方法改为 async
 */

const { query } = require('./database.pg');

// ==================== 用户存储 ====================
class UserStore {
  async getAll() {
    const r = await query('SELECT * FROM users');
    return r.rows;
  }

  async create({ id, openId, nickName, avatarUrl, platform, role = 'C' }) {
    const userId = id || `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await query(
      `INSERT INTO users (id, "openId", "nickName", "avatarUrl", platform, role)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [userId, openId || userId, nickName || '用户', avatarUrl || '', platform || 'alipay', role]
    );
    return this.getById(userId);
  }

  async getById(id) {
    const r = await query('SELECT * FROM users WHERE id = $1', [id]);
    return r.rows[0] || null;
  }

  async getByOpenId(openId) {
    const r = await query('SELECT * FROM users WHERE "openId" = $1', [openId]);
    return r.rows[0] || null;
  }

  async update(id, updates) {
    if (!updates || Object.keys(updates).length === 0) return this.getById(id);
    const fields = Object.keys(updates).map((k, i) => `"${k}" = $${i + 1}`).join(', ');
    const values = Object.keys(updates).map(k => updates[k]);
    await query(`UPDATE users SET ${fields} WHERE id = $${values.length + 1}`, [...values, id]);
    return this.getById(id);
  }
}

// ==================== 支付存储 ====================
class PaymentStore {
  async getAll() {
    const r = await query('SELECT * FROM payments ORDER BY "createdAt" DESC');
    return r.rows;
  }

  async create(args) {
    let id, data;
    if (typeof args === 'string') {
      id = args;
      data = arguments[1] || {};
    } else {
      data = args || {};
      id = data.id || `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    }

    const {
      userId, amount, subject, description, payerId, payeeId, channel = 'alipay',
      status = 'pending', tradeNo = '', hash = '', nonce = '', createdAt,
    } = data;

    const now = createdAt || new Date().toISOString();
    await query(
      `INSERT INTO payments (id, "userId", amount, subject, description, "payerId", "payeeId", channel, status, "tradeNo", hash, "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, userId || payerId || '', amount || 0, subject || '', description || '',
       payerId || '', payeeId || '', channel, status, tradeNo || '', hash || '', now]
    );
    return this.getById(id);
  }

  async getById(id) {
    const r = await query('SELECT * FROM payments WHERE id = $1', [id]);
    return r.rows[0] || null;
  }

  async getByUserId(userId) {
    const r = await query('SELECT * FROM payments WHERE "userId" = $1 ORDER BY "createdAt" DESC', [userId]);
    return r.rows;
  }

  async getByUser(userId) {
    return this.getByUserId(userId);
  }

  async confirmSuccess(id, tradeNo) {
    const now = new Date().toISOString();
    await query('UPDATE payments SET status = $1, "tradeNo" = $2, "paidAt" = $3 WHERE id = $4',
      ['success', tradeNo || '', now, id]);
    return this.getById(id);
  }

  async update(id, updates) {
    if (!updates || Object.keys(updates).length === 0) return this.getById(id);
    const fields = Object.keys(updates).map((k, i) => `"${k}" = $${i + 1}`).join(', ');
    const values = Object.keys(updates).map(k => updates[k]);
    await query(`UPDATE payments SET ${fields} WHERE id = $${values.length + 1}`, [...values, id]);
    return this.getById(id);
  }

  async refund(id) {
    await query("UPDATE payments SET status = 'refunded' WHERE id = $1", [id]);
    return this.getById(id);
  }

  async list(page = 1, pageSize = 20) {
    const c = await query('SELECT COUNT(*) as c FROM payments');
    const total = parseInt(c.rows[0].c);
    const r = await query('SELECT * FROM payments ORDER BY "createdAt" DESC LIMIT $1 OFFSET $2',
      [pageSize, (page - 1) * pageSize]);
    return { list: r.rows, total, page, pageSize };
  }
}

// ==================== 钱包存储 ====================
class WalletStore {
  async get(userId) {
    return this.getOrCreate(userId);
  }

  async getOrCreate(userId) {
    const r = await query('SELECT * FROM wallets WHERE "userId" = $1', [userId]);
    if (r.rows[0]) return r.rows[0];
    await query(
      `INSERT INTO wallets ("userId", balance, "dataEarnings", "pendingBalance", "promotionBalance", "totalIncome", "totalExpense")
       VALUES ($1, 0, 0, 0, 0, 0, 0) ON CONFLICT ("userId") DO NOTHING`,
      [userId]
    );
    const r2 = await query('SELECT * FROM wallets WHERE "userId" = $1', [userId]);
    return r2.rows[0];
  }

  async addBalance(userId, amount, description, refId) {
    const txId = `wt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await query('UPDATE wallets SET balance = balance + $1, "totalIncome" = "totalIncome" + $2 WHERE "userId" = $3',
      [amount, amount > 0 ? amount : 0, userId]);
    await query(
      `INSERT INTO wallet_transactions (id, "userId", amount, type, description, "refId")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [txId, userId, amount, amount > 0 ? 'income' : 'expense', description || '', refId || '']
    );
    const w = await this.getOrCreate(userId);
    return { balance: w.balance, txId };
  }

  async deductBalance(userId, amount, description, refId) {
    const wallet = await this.getOrCreate(userId);
    const absAmount = Math.abs(amount);
    if (wallet.balance < absAmount) return null;
    const txId = `wt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await query('UPDATE wallets SET balance = balance - $1, "totalExpense" = "totalExpense" + $2 WHERE "userId" = $3',
      [absAmount, absAmount, userId]);
    await query(
      `INSERT INTO wallet_transactions (id, "userId", amount, type, description, "refId")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [txId, userId, -absAmount, 'expense', description || '', refId || '']
    );
    const w = await this.getOrCreate(userId);
    return { balance: w.balance, txId };
  }

  async addDataEarnings(userId, amount, description, refId) {
    const txId = `wt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await query('UPDATE wallets SET "dataEarnings" = "dataEarnings" + $1, balance = balance + $2 WHERE "userId" = $3',
      [amount, amount, userId]);
    await query(
      `INSERT INTO wallet_transactions (id, "userId", amount, type, description, "refId")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [txId, userId, amount, 'data_earnings', description || '数据收益', refId || '']
    );
    const w = await this.getOrCreate(userId);
    return { balance: w.balance, txId };
  }

  async getBalance(userId) {
    return this.getOrCreate(userId);
  }

  async getTransactions(userId, page = 1, pageSize = 50) {
    const c = await query('SELECT COUNT(*) as c FROM wallet_transactions WHERE "userId" = $1', [userId]);
    const total = parseInt(c.rows[0].c);
    const r = await query('SELECT * FROM wallet_transactions WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT $2 OFFSET $3',
      [userId, pageSize, (page - 1) * pageSize]);
    return { list: r.rows, total, page, pageSize };
  }

  async _logTx(userId, type, amount, description, refId) {
    const txId = `wt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await query(
      `INSERT INTO wallet_transactions (id, "userId", amount, type, description, "refId")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [txId, userId, amount, type, description || '', refId || '']
    );
  }
}

// ==================== 存证存储 ====================
class HashStore {
  async create({ txId, hash, dataDigest, dataType = 'payment', metadata = {} }) {
    const id = `hash_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await query(
      `INSERT INTO hashes (id, "txId", hash, "dataDigest", "dataType", metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, txId, hash || '', dataDigest || '', dataType, JSON.stringify(metadata)]
    );
    return this.getById(id);
  }

  async getById(id) {
    const r = await query('SELECT * FROM hashes WHERE id = $1', [id]);
    if (r.rows[0]) r.rows[0].metadata = JSON.parse(r.rows[0].metadata || '{}');
    return r.rows[0] || null;
  }

  async getByTxId(txId) {
    const r = await query('SELECT * FROM hashes WHERE "txId" = $1 ORDER BY "createdAt" DESC', [txId]);
    return r.rows.map(row => ({ ...row, metadata: JSON.parse(row.metadata || '{}') }));
  }

  async getByHash(hash) {
    const r = await query('SELECT * FROM hashes WHERE hash = $1', [hash]);
    if (r.rows[0]) r.rows[0].metadata = JSON.parse(r.rows[0].metadata || '{}');
    return r.rows[0] || null;
  }

  async list(page = 1, pageSize = 100) {
    const c = await query('SELECT COUNT(*) as c FROM hashes');
    const total = parseInt(c.rows[0].c);
    const r = await query('SELECT * FROM hashes ORDER BY "createdAt" DESC LIMIT $1 OFFSET $2',
      [pageSize, (page - 1) * pageSize]);
    return { list: r.rows.map(row => ({ ...row, metadata: JSON.parse(row.metadata || '{}') })), total, page, pageSize };
  }
}

// ==================== 公证存储 ====================
class NotaryStore {
  async getAll(userId) {
    let r;
    if (userId) {
      r = await query('SELECT * FROM notaries WHERE "userId" = $1 ORDER BY "createdAt" DESC', [userId]);
    } else {
      r = await query('SELECT * FROM notaries ORDER BY "createdAt" DESC');
    }
    return r.rows.map(row => ({ ...row, metadata: JSON.parse(row.metadata || '{}') }));
  }

  async create({ txId, userId, provider, certificateNo, status = 'pending', metadata = {} }) {
    const id = `not_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await query(
      `INSERT INTO notaries (id, "txId", "userId", provider, "certificateNo", status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, txId || '', userId || '', provider || '', certificateNo || '', status, JSON.stringify(metadata)]
    );
    return this.getById(id);
  }

  async getById(id) {
    const r = await query('SELECT * FROM notaries WHERE id = $1', [id]);
    if (r.rows[0]) r.rows[0].metadata = JSON.parse(r.rows[0].metadata || '{}');
    return r.rows[0] || null;
  }

  async updateStatus(id, status) {
    await query('UPDATE notaries SET status = $1 WHERE id = $2', [status, id]);
    return this.getById(id);
  }

  async update(id, updates) {
    if (!updates || Object.keys(updates).length === 0) return this.getById(id);
    const fields = Object.keys(updates).map((k, i) => `"${k}" = $${i + 1}`).join(', ');
    const values = Object.keys(updates).map(k => updates[k]);
    await query(`UPDATE notaries SET ${fields} WHERE id = $${values.length + 1}`, [...values, id]);
    return this.getById(id);
  }
}

// ==================== 数据市场存储 ====================
class DataMarketStore {
  async createProduct({ name, description, dataType, dimensions, price, sampleSize }) {
    const id = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await query(
      `INSERT INTO data_products (id, name, description, "dataType", dimensions, price, "sampleSize")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, name || '', description || '', dataType || '', JSON.stringify(dimensions || []), price || 0, sampleSize || 0]
    );
    return this.getProductById(id);
  }

  async getProductById(id) {
    const r = await query('SELECT * FROM data_products WHERE id = $1', [id]);
    if (r.rows[0]) r.rows[0].dimensions = JSON.parse(r.rows[0].dimensions || '[]');
    return r.rows[0] || null;
  }

  async getProduct(id) {
    return this.getProductById(id);
  }

  async getProducts() {
    const r = await query('SELECT * FROM data_products ORDER BY "createdAt" DESC');
    return r.rows.map(row => ({ ...row, dimensions: JSON.parse(row.dimensions || '[]') }));
  }

  async listProducts() {
    return this.getProducts();
  }

  async createOrder({ productId, buyerId, amount, quantity = 1 }) {
    const id = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await query(
      `INSERT INTO data_orders (id, "productId", "buyerId", amount, quantity)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, productId, buyerId, amount || 0, quantity]
    );
    const r = await query('SELECT * FROM data_orders WHERE id = $1', [id]);
    return r.rows[0];
  }

  async confirmOrder(id) {
    await query("UPDATE data_orders SET status = 'completed' WHERE id = $1", [id]);
    const r = await query('SELECT * FROM data_orders WHERE id = $1', [id]);
    return r.rows[0];
  }

  async getOrders(buyerId) {
    let r;
    if (buyerId) {
      r = await query('SELECT * FROM data_orders WHERE "buyerId" = $1 ORDER BY "createdAt" DESC', [buyerId]);
    } else {
      r = await query('SELECT * FROM data_orders ORDER BY "createdAt" DESC');
    }
    return r.rows;
  }

  async listOrders(buyerId) {
    return this.getOrders(buyerId);
  }

  async setConsent(userId, { scope }) {
    await query(
      `INSERT INTO data_consents ("userId", scope, "updatedAt")
       VALUES ($1, $2, NOW()) ON CONFLICT ("userId") DO UPDATE SET scope = $2, "updatedAt" = NOW()`,
      [userId, scope || 'none']
    );
  }

  async getConsent(userId) {
    const r = await query('SELECT * FROM data_consents WHERE "userId" = $1', [userId]);
    return r.rows[0] || { userId, scope: 'none' };
  }
}

module.exports = {
  userStore: new UserStore(),
  paymentStore: new PaymentStore(),
  walletStore: new WalletStore(),
  hashStore: new HashStore(),
  notaryStore: new NotaryStore(),
  dataMarketStore: new DataMarketStore(),
};