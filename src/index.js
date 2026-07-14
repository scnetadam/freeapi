const express = require('express');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const HTTP_PORT = process.env.HTTP_PORT || 80;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// ============ 中间件 ============
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 支付宝小程序 body 格式兼容中间件
// 支付宝 uni.request 有时会发送 urlencoded 或 form-data 格式而非 JSON
// 导致 express.json() 解析后 body 为空，手动尝试解析
app.use((req, _res, next) => {
  if (req.method === 'POST' && (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length === 0)) {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      if (raw) {
        try {
          req.body = JSON.parse(raw);
        } catch (e) {
          // 不是 JSON，尝试 URL 编码解析
          try {
            const params = new URLSearchParams(raw);
            const obj = {};
            for (const [k, v] of params) { obj[k] = v; }
            req.body = obj;
          } catch (e2) { /* 无法解析，保持原样 */ }
        }
      }
      next();
    });
  } else {
    next();
  }
});

// ============ 跨项目 API 密钥验证中间件 ============
// 允许其他项目（龟钮印信等）调用龟钮印证的 Agent 微交易 API
const API_KEYS = new Map();
// 从环境变量读取 API 密钥，格式: API_KEY_xxx=项目名:密钥
Object.keys(process.env).forEach(k => {
  if (k.startsWith('API_KEY_')) {
    const parts = (process.env[k] || '').split(':');
    if (parts.length === 2) {
      API_KEYS.set(parts[1], parts[0]);
    }
  }
});

function verifyApiKey(req, res, next) {
  // 内部请求（同项目前端）不需要验证
  if (req.headers['x-internal'] === 'true') return next();
  // 来自前端的内部请求跳过验证
  if (req.headers['referer'] || req.headers['origin']?.includes('localhost')) return next();

  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !API_KEYS.has(apiKey)) {
    return res.status(401).json({ success: false, error: '无效的 API 密钥' });
  }
  req.clientProject = API_KEYS.get(apiKey);
  next();
}

// ============ 路由 ============
const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payment');
const walletRoutes = require('./routes/wallet');
const hashRoutes = require('./routes/hash');
const notaryRoutes = require('./routes/notary');
const agentPayRoutes = require('./routes/agentPay');
const dataMarketRoutes = require('./routes/dataMarket');
const riskRoutes = require('./routes/risk');
const governanceRoutes = require('./routes/governance');
const { router: bizRoutes } = require('./routes/biz');
const aiRoutes = require('./routes/ai');
const promoRoutes = require('./routes/promo');
const guinieuRoutes = require('./guinieu/index');

app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/hash', hashRoutes);
app.use('/api/notary', notaryRoutes);
app.use('/api/agent-pay', verifyApiKey, agentPayRoutes);
app.use('/api/data-market', dataMarketRoutes);
app.use('/api/risk', riskRoutes);
app.use('/api/governance', governanceRoutes);
app.use('/api/biz', bizRoutes);
app.use('/api/promo', promoRoutes);
app.use('/api/guinieu', guinieuRoutes);

// ============ 健康检查 ============
app.get('/health', (req, res) => {
  res.json({
    service: '龟钮印证 L0 结算壳',
    version: '0.1.0',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// ============ 错误处理 ============
app.use((err, req, res, _next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// ============ Seed 数据初始化 ============
const { seed } = require('./seed');
seed();

// HTTP (开发用)
app.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[龟钮印证] L0 结算壳 v0.1.0 启动`);
  console.log(`[龟钮印证] HTTP:  http://0.0.0.0:${HTTP_PORT}`);
  console.log(`[龟钮印证] HTTPS: https://0.0.0.0:${HTTPS_PORT}`);
  console.log(`[龟钮印证] 健康检查: http://localhost:${HTTP_PORT}/health`);
});

// HTTPS (自签名证书，供支付宝小程序 IDE 使用)
// 优先使用 mkcert 证书，后备自签名证书
const certDir = path.join(__dirname, '..', 'certs');
let certPath = path.join(certDir, '192.168.0.109+2.pem');
let keyPath = path.join(certDir, '192.168.0.109+2-key.pem');

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  certPath = path.join(certDir, 'server.crt');
  keyPath = path.join(certDir, 'server.key');
}

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsOptions = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
  https.createServer(httpsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`[龟钮印证] HTTPS 就绪: https://localhost:${HTTPS_PORT}`);
  });
}

module.exports = app;