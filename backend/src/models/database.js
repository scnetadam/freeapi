/**
 * 数据库入口 — 根据环境变量 DB_TYPE 自动选择实现
 * 生产环境 (PG) 使用 database.pg.js
 * 测试环境 (SQLite) 使用 database.sqlite.js
 */

const DB_TYPE = process.env.DB_TYPE || 'sqlite';

if (DB_TYPE === 'pg') {
  module.exports = require('./database.pg');
} else {
  module.exports = require('./database.sqlite');
}