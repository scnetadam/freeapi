/**
 * 龟钮印证 — 数据存储自动选择器
 * 根据环境变量 DB_TYPE 自动选择 SQLite 或 PostgreSQL
 */

if (process.env.DB_TYPE === 'pg' || process.env.PG_HOST) {
  // PostgreSQL 模式
  module.exports = require('./dataStore.pg');
} else {
  // SQLite 模式（原版同步 API）
  module.exports = require('./dataStore.sqlite');
}