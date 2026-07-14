/**
 * 龟钮印证 — 腾讯云 SCF 云函数入口
 * 使用 serverless-http 包裹 Express 应用
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

// 设置环境变量默认值
process.env.DB_TYPE = process.env.DB_TYPE || 'pg';
process.env.HTTP_PORT = process.env.HTTP_PORT || '80';
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// PostgreSQL 连接配置（从 CloudBase 环境变量读取）
process.env.PG_HOST = process.env.PG_HOST || process.env.TCB_PG_HOST || 'localhost';
process.env.PG_PORT = process.env.PG_PORT || process.env.TCB_PG_PORT || '5432';
process.env.PG_DATABASE = process.env.PG_DATABASE || process.env.TCB_PG_DATABASE || 'x402';
process.env.PG_USER = process.env.PG_USER || process.env.TCB_PG_USER || 'x402';
process.env.PG_PASSWORD = process.env.PG_PASSWORD || process.env.TCB_PG_PASSWORD || '';
process.env.TENCENT_CLOUD_RUNENV = process.env.TENCENT_CLOUD_RUNENV || '';

// 初始化数据库
const { initSchema } = require('./src/models/database.pg');

// 加载路由
const app = express();
app.use(cors());
app.use(express.json());

// ============ 路由挂载 ============
const authRoutes = require('./src/routes/auth');
const bizRoutes = require('./src/routes/biz');
const agentPayRoutes = require('./src/routes/agentPay');
const aiRoutes = require('./src/routes/ai');
const dataMarketRoutes = require('./src/routes/dataMarket');
const governanceRoutes = require('./src/routes/governance');
const hashRoutes = require('./src/routes/hash');

app.use('/api/auth', authRoutes);
app.use('/api/biz', bizRoutes);
app.use('/api/agent-pay', agentPayRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/data-market', dataMarketRoutes);
app.use('/api/governance', governanceRoutes);
app.use('/api/hash', hashRoutes);

// 支付宝支付路由
const alipayBackend = require('./src/paymentBackends/alipay');
app.use('/api/pay/alipay', alipayBackend);

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', mode: process.env.ALIPAY_SIMULATE === 'true' ? 'simulate' : 'real', db: 'postgresql' });
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

  // 将 SCF 事件转换为 Express 请求
  const { httpMethod, path: requestPath, headers, queryString, body, isBase64Encoded } = event;

  const reqPath = requestPath || '/';
  const method = httpMethod || 'GET';

  // 构建请求/响应对象
  return new Promise((resolve, reject) => {
    const { createServer } = require('http');
    const server = createServer(app);

    // 构造请求
    const options = {
      hostname: '127.0.0.1',
      port: 80,
      path: reqPath + (queryString ? '?' + queryString : ''),
      method: method,
      headers: headers || {},
    };

    const req = require('http').request(options, (res) => {
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