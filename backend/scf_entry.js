/**
 * 龟钮印证 — 腾讯云 SCF 云函数入口
 * 使用 serverless-http 包裹 Express 应用
 */

const express = require('express');
const cors = require('cors');

// 设置环境变量默认值
process.env.DB_TYPE = process.env.DB_TYPE || 'pg';
process.env.HTTP_PORT = process.env.HTTP_PORT || '80';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// PostgreSQL 连接配置
process.env.PG_HOST = process.env.PG_HOST || process.env.TCB_PG_HOST || 'localhost';
process.env.PG_PORT = process.env.PG_PORT || process.env.TCB_PG_PORT || '5432';
process.env.PG_DATABASE = process.env.PG_DATABASE || process.env.TCB_PG_DATABASE || 'x402';
process.env.PG_USER = process.env.PG_USER || process.env.TCB_PG_USER || 'x402';
process.env.PG_PASSWORD = process.env.PG_PASSWORD || process.env.TCB_PG_PASSWORD || '';

// 初始化数据库
const { initSchema } = require('./src/models/database.pg');

// ============ Express 应用 ============
const app = express();
app.use(cors());
app.use(express.json());

// 加载路由
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/biz', require('./src/routes/biz'));
app.use('/api/agent-pay', require('./src/routes/agentPay'));
app.use('/api/ai', require('./src/routes/ai'));
app.use('/api/data-market', require('./src/routes/dataMarket'));
app.use('/api/governance', require('./src/routes/governance'));
app.use('/api/hash', require('./src/routes/hash'));
app.use('/api/notary', require('./src/routes/notary'));
app.use('/api/wallet', require('./src/routes/wallet'));
app.use('/api/payment', require('./src/routes/payment'));
app.use('/api/promo', require('./src/routes/promo'));
app.use('/api/risk', require('./src/routes/risk'));
app.use('/api/pay/alipay', require('./src/paymentBackends/alipay'));

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: 'postgresql' });
});

app.get('/api/data', (req, res) => {
  res.json({
    status: 'ok',
    mode: process.env.ALIPAY_SIMULATE === 'true' ? 'simulate' : 'real',
    message: '龟钮印证 API 运行中',
  });
});

// ============ SCF 入口 ============
let initialized = false;

exports.main_handler = async (event, context) => {
  if (!initialized) {
    try {
      await initSchema();
      initialized = true;
      console.log('[SCF] 数据库初始化完成');
    } catch (err) {
      console.error('[SCF] 数据库初始化失败:', err.message);
    }
  }

  const { httpMethod, path: requestPath, headers, queryString, body, isBase64Encoded } = event;
  const reqPath = requestPath || '/';
  const method = httpMethod || 'GET';

  return new Promise((resolve, reject) => {
    const { request } = require('http');
    const options = {
      hostname: '127.0.0.1',
      port: process.env.HTTP_PORT || 80,
      path: reqPath + (queryString ? '?' + queryString : ''),
      method,
      headers: headers || {},
    };

    const req = request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          isBase64Encoded: false,
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(isBase64Encoded ? Buffer.from(body, 'base64') : body);
    }
    req.end();
  });
};