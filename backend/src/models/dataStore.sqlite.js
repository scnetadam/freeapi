/**
 * 龟钮印证 — 数据存储 (SQLite 持久化版)
 * 完整版：补齐所有路由依赖的缺失方法
 */

const { getDb } = require('./database');

// ==================== 用户存储 ====================
class UserStore {
  getAll() {
    return getDb().prepare('SELECT * FROM users').all();
  }

  create({ id, openId, nickName, avatarUrl, platform, role = 'C' }) {
    const userId = id || `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO users (id, openId, nickName, avatarUrl, platform, role) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId, openId || userId, nickName || '用户', avatarUrl || '', platform || 'alipay', role);
    return this.getById(userId);
  }

  getById(id) {
    return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  }

  getByOpenId(openId) {
    return getDb().prepare('SELECT * FROM users WHERE openId = ?').get(openId) || null;
  }

  update(id, updates) {
    if (!updates || Object.keys(updates).length === 0) return this.getById(id);
    const fields = Object.keys(updates).map(k => `"${k}" = ?`).join(', ');
    const values = Object.keys(updates).map(k => updates[k]);
    getDb().prepare(`UPDATE users SET ${fields} WHERE id = ?`).run(...values, id);
    return this.getById(id);
  }
}

// ==================== 支付存储 ====================
class PaymentStore {
  constructor() {
    this._pendingRefunds = new Map();
  }

  getAll() {
    return getDb().prepare('SELECT * FROM payments ORDER BY createdAt DESC').all();
  }

  create(args) {
    // 兼容两种调用方式: create({...}) 或 create(id, obj)
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
      status = 'pending', tradeNo = '', hash = '', nonce = '',
      createdAt, paidAt,
    } = data;

    const now = createdAt || new Date().toISOString();
    getDb().prepare(`
      INSERT INTO payments (id, userId, amount, subject, description, payerId, payeeId, channel, status, tradeNo, hash, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId || payerId || '', amount || 0, subject || '', description || '',
      payerId || '', payeeId || '', channel, status, tradeNo || '', hash || '', now
    );
    return this.getById(id);
  }

  getById(id) {
    return getDb().prepare('SELECT * FROM payments WHERE id = ?').get(id) || null;
  }

  getByUserId(userId) {
    return getDb().prepare('SELECT * FROM payments WHERE userId = ? ORDER BY createdAt DESC').all(userId);
  }

  // 别名：路由中同时使用 getByUser 和 getByUserId
  getByUser(userId) {
    return this.getByUserId(userId);
  }

  confirmSuccess(id, tradeNo) {
    const now = new Date().toISOString();
    getDb().prepare('UPDATE payments SET status = ?, tradeNo = ?, paidAt = ? WHERE id = ?')
      .run('success', tradeNo || '', now, id);
    return this.getById(id);
  }

  update(id, updates) {
    if (!updates || Object.keys(updates).length === 0) return this.getById(id);
    const fields = Object.keys(updates).map(k => `"${k}" = ?`).join(', ');
    const values = Object.keys(updates).map(k => updates[k]);
    getDb().prepare(`UPDATE payments SET ${fields} WHERE id = ?`).run(...values, id);
    return this.getById(id);
  }

  refund(id) {
    getDb().prepare("UPDATE payments SET status = 'refunded' WHERE id = ?").run(id);
    return this.getById(id);
  }

  list(page = 1, pageSize = 20) {
    const total = getDb().prepare('SELECT COUNT(*) as c FROM payments').get().c;
    const list = getDb().prepare('SELECT * FROM payments ORDER BY createdAt DESC LIMIT ? OFFSET ?')
      .all(pageSize, (page - 1) * pageSize);
    return { list, total, page, pageSize };
  }
}

// ==================== 钱包存储 ====================
class WalletStore {
  get(userId) {
    return this.getOrCreate(userId);
  }

  getOrCreate(userId) {
    const db = getDb();
    let w = db.prepare('SELECT * FROM wallets WHERE userId = ?').get(userId);
    if (!w) {
      db.prepare('INSERT INTO wallets (userId, balance, dataEarnings, pendingBalance, promotionBalance, totalIncome, totalExpense) VALUES (?, 0, 0, 0, 0, 0, 0)')
        .run(userId);
      w = db.prepare('SELECT * FROM wallets WHERE userId = ?').get(userId);
    }
    return w;
  }

  addBalance(userId, amount, description, refId) {
    const db = getDb();
    const txId = `wt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    db.prepare('UPDATE wallets SET balance = balance + ?, totalIncome = totalIncome + ? WHERE userId = ?')
      .run(amount, amount > 0 ? amount : 0, userId);
    db.prepare(
      'INSERT INTO wallet_transactions (id, userId, amount, type, description, refId) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(txId, userId, amount, amount > 0 ? 'income' : 'expense', description || '', refId || '');
    return { balance: this.getOrCreate(userId).balance, txId };
  }

  deductBalance(userId, amount, description, refId) {
    const wallet = this.getOrCreate(userId);
    const absAmount = Math.abs(amount);
    if (wallet.balance < absAmount) return null;
    const db = getDb();
    const txId = `wt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    db.prepare('UPDATE wallets SET balance = balance - ?, totalExpense = totalExpense + ? WHERE userId = ?')
      .run(absAmount, absAmount, userId);
    db.prepare(
      'INSERT INTO wallet_transactions (id, userId, amount, type, description, refId) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(txId, userId, -absAmount, 'expense', description || '', refId || '');
    return { balance: this.getOrCreate(userId).balance, txId };
  }

  addDataEarnings(userId, amount, description, refId) {
    const db = getDb();
    const txId = `wt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    db.prepare('UPDATE wallets SET dataEarnings = dataEarnings + ?, balance = balance + ? WHERE userId = ?')
      .run(amount, amount, userId);
    db.prepare(
      'INSERT INTO wallet_transactions (id, userId, amount, type, description, refId) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(txId, userId, amount, 'data_earnings', description || '数据收益', refId || '');
    return { balance: this.getOrCreate(userId).balance, txId };
  }

  getBalance(userId) {
    return this.getOrCreate(userId);
  }

  getTransactions(userId, page = 1, pageSize = 50) {
    const total = getDb().prepare('SELECT COUNT(*) as c FROM wallet_transactions WHERE userId = ?').get(userId).c;
    const list = getDb().prepare('SELECT * FROM wallet_transactions WHERE userId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?')
      .all(userId, pageSize, (page - 1) * pageSize);
    return { list, total, page, pageSize };
  }

  // 用于推广模块的日志记录
  _logTx(userId, type, amount, description, refId, balanceAfter) {
    const db = getDb();
    const txId = `wt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    db.prepare(
      'INSERT INTO wallet_transactions (id, userId, amount, type, description, refId) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(txId, userId, amount, type, description || '', refId || '');
  }
}

// ==================== 存证存储 ====================
class HashStore {
  create({ txId, hash, dataDigest, dataType = 'payment', metadata = {} }) {
    const id = `hash_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    getDb().prepare(
      'INSERT INTO hashes (id, txId, hash, dataDigest, dataType, metadata) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, txId, hash || '', dataDigest || '', dataType, JSON.stringify(metadata));
    return this.getById(id);
  }

  getById(id) {
    const row = getDb().prepare('SELECT * FROM hashes WHERE id = ?').get(id);
    if (row) row.metadata = JSON.parse(row.metadata || '{}');
    return row || null;
  }

  getByTxId(txId) {
    return getDb().prepare('SELECT * FROM hashes WHERE txId = ? ORDER BY createdAt DESC').all(txId);
  }

  getByHash(hash) {
    const row = getDb().prepare('SELECT * FROM hashes WHERE hash = ?').get(hash);
    if (row) row.metadata = JSON.parse(row.metadata || '{}');
    return row || null;
  }

  list(page = 1, pageSize = 100) {
    const total = getDb().prepare('SELECT COUNT(*) as c FROM hashes').get().c;
    const list = getDb().prepare('SELECT * FROM hashes ORDER BY createdAt DESC LIMIT ? OFFSET ?')
      .all(pageSize, (page - 1) * pageSize);
    return { list, total, page, pageSize };
  }
}

// ==================== 公证存储 ====================
class NotaryStore {
  getAll(userId) {
    if (userId) {
      return getDb().prepare('SELECT * FROM notaries WHERE userId = ? ORDER BY createdAt DESC').all(userId);
    }
    return getDb().prepare('SELECT * FROM notaries ORDER BY createdAt DESC').all();
  }

  create({ txId, userId, provider, certificateNo, status = 'pending', metadata = {} }) {
    const id = `not_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    getDb().prepare(
      'INSERT INTO notaries (id, txId, userId, provider, certificateNo, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, txId || '', userId || '', provider || '', certificateNo || '', status, JSON.stringify(metadata));
    return this.getById(id);
  }

  getById(id) {
    const row = getDb().prepare('SELECT * FROM notaries WHERE id = ?').get(id);
    if (row) row.metadata = JSON.parse(row.metadata || '{}');
    return row || null;
  }

  updateStatus(id, status) {
    getDb().prepare('UPDATE notaries SET status = ? WHERE id = ?').run(status, id);
    return this.getById(id);
  }

  update(id, updates) {
    if (!updates || Object.keys(updates).length === 0) return this.getById(id);
    const fields = Object.keys(updates).map(k => `"${k}" = ?`).join(', ');
    const values = Object.keys(updates).map(k => updates[k]);
    getDb().prepare(`UPDATE notaries SET ${fields} WHERE id = ?`).run(...values, id);
    return this.getById(id);
  }
}

// ==================== 数据市场存储 ====================
class DataMarketStore {
  constructor() {
    this._consents = new Map();
    this._sales = new Map();
  }

  createProduct({ name, description, dataType, dimensions, price, sampleSize }) {
    const id = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    getDb().prepare(
      'INSERT INTO data_products (id, name, description, dataType, dimensions, price, sampleSize) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, name || '', description || '', dataType || '', JSON.stringify(dimensions || []), price || 0, sampleSize || 0);
    return this.getProductById(id);
  }

  getProductById(id) {
    const row = getDb().prepare('SELECT * FROM data_products WHERE id = ?').get(id);
    if (row) row.dimensions = JSON.parse(row.dimensions || '[]');
    return row || null;
  }

  // 别名
  getProduct(id) {
    return this.getProductById(id);
  }

  getProducts() {
    const rows = getDb().prepare('SELECT * FROM data_products ORDER BY createdAt DESC').all();
    return rows.map(r => ({ ...r, dimensions: JSON.parse(r.dimensions || '[]') }));
  }

  // 别名
  listProducts() {
    return this.getProducts();
  }

  createOrder({ productId, buyerId, amount, quantity = 1 }) {
    const id = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    getDb().prepare(
      'INSERT INTO data_orders (id, productId, buyerId, amount, quantity) VALUES (?, ?, ?, ?, ?)'
    ).run(id, productId, buyerId, amount || 0, quantity);
    return getDb().prepare('SELECT * FROM data_orders WHERE id = ?').get(id);
  }

  confirmOrder(id) {
    getDb().prepare("UPDATE data_orders SET status = 'completed' WHERE id = ?").run(id);
    // 记录销售
    const order = getDb().prepare('SELECT * FROM data_orders WHERE id = ?').get(id);
    if (order) this._sales.set(id, order);
    return order;
  }

  getOrders(buyerId) {
    if (buyerId) {
      return getDb().prepare('SELECT * FROM data_orders WHERE buyerId = ? ORDER BY createdAt DESC').all(buyerId);
    }
    return getDb().prepare('SELECT * FROM data_orders ORDER BY createdAt DESC').all();
  }

  // 别名
  listOrders(buyerId) {
    return this.getOrders(buyerId);
  }

  setConsent(userId, { scope }) {
    getDb().prepare(
      `INSERT OR REPLACE INTO data_consents (userId, scope, updatedAt) VALUES (?, ?, datetime('now'))`
    ).run(userId, scope || 'none');
    this._consents.set(userId, { userId, scope: scope || 'none' });
  }

  getConsent(userId) {
    const row = getDb().prepare('SELECT * FROM data_consents WHERE userId = ?').get(userId);
    const result = row || { userId, scope: 'none' };
    this._consents.set(userId, result);
    return result;
  }

  revokeConsent(userId) {
    getDb().prepare(
      `UPDATE data_consents SET scope = 'none', updatedAt = datetime('now') WHERE userId = ?`
    ).run(userId);
    this._consents.delete(userId);
    return { userId, scope: 'none', revokedAt: new Date().toISOString() };
  }
}

// ==================== 单例导出 ====================
const userStore = new UserStore();
const paymentStore = new PaymentStore();
const walletStore = new WalletStore();
const hashStore = new HashStore();
const notaryStore = new NotaryStore();
const dataMarketStore = new DataMarketStore();

module.exports = {
  userStore, paymentStore, walletStore, hashStore, notaryStore, dataMarketStore,
};