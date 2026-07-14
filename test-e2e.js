/**
 * 龟钮印证 — 端到端自动化测试
 * 使用 Node.js 内置 http 模块
 */

const http = require('http');

const BASE = 'http://localhost:3000';

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function json(method, path, body) {
  return fetch(`${BASE}${path}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function get(path) { return json('GET', path); }
function post(path, body) { return json('POST', path, body); }

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

async function main() {
  console.log('\n🧪 龟钮印证 L0 结算壳 — 端到端测试\n');

  // 1. 健康检查
  await test('健康检查', async () => {
    const r = await get('/health');
    if (r.status !== 'ok') throw new Error(`status=${r.status}`);
  });

  // 2. 登录
  let userC, userB, userG;
  await test('C端登录', async () => {
    const r = await post('/api/auth/login', { code: 'test_c', nickName: '小明', role: 'C' });
    if (!r.success) throw new Error('login failed');
    userC = r.data.user;
  });

  await test('B端登录', async () => {
    const r = await post('/api/auth/login', { code: 'test_b', nickName: '商户', role: 'B' });
    if (!r.success) throw new Error('login failed');
    userB = r.data.user;
  });

  await test('G端登录', async () => {
    const r = await post('/api/auth/login', { code: 'test_g', nickName: '数据局', role: 'G' });
    if (!r.success) throw new Error('login failed');
    userG = r.data.user;
  });

  // 3. 支付
  let payId;
  await test('C→B 小额支付 (免费)', async () => {
    const r = await post('/api/payment/create', { amount: 100, subject: '商品', payerId: userC.id, payeeId: userB.id });
    if (!r.success) throw new Error('create failed');
    if (r.data.bFee !== 0) throw new Error(`C端资费应为0, 实际=${r.data.bFee}`);
    payId = r.data.id;
  });

  await test('B端大额支付 (资费封顶 ¥20)', async () => {
    const r = await post('/api/payment/create', { amount: 100000, subject: '大额', payerId: userB.id, payeeId: userC.id });
    if (!r.success) throw new Error('create failed');
    if (r.data.bFee !== 20) throw new Error(`封顶应为20, 实际=${r.data.bFee}`);
  });

  await test('B端¥2000以下免费', async () => {
    const r = await post('/api/payment/create', { amount: 1500, subject: '小额', payerId: userB.id, payeeId: userC.id });
    if (!r.success) throw new Error('create failed');
    if (r.data.bFee !== 0) throw new Error(`≤2000应免费, 实际=${r.data.bFee}`);
  });

  // 4. 确认支付
  await test('确认支付', async () => {
    const r = await post('/api/payment/confirm', { id: payId, channelTradeNo: 'ali_test_001' });
    if (!r.success) throw new Error('confirm failed');
    if (r.data.status !== 'success') throw new Error(`status=${r.data.status}`);
  });

  // 5. 钱包
  await test('钱包余额', async () => {
    const r = await get(`/api/wallet/balance?userId=${userB.id}`);
    if (!r.success) throw new Error('balance failed');
    if (r.data.balance <= 0) throw new Error('余额应为正数');
  });

  // 6. HASH 存证
  await test('HASH 存证', async () => {
    const r = await get(`/api/hash/query?txId=${payId}`);
    if (!r.success) throw new Error('hash query failed');
  });

  // 7. 数据授权
  await test('数据授权', async () => {
    const r = await post('/api/data-market/consent', { userId: userC.id, scope: 'all' });
    if (!r.success) throw new Error('consent failed');
  });

  // 8. 数据产品
  await test('数据产品列表', async () => {
    const r = await get('/api/data-market/products');
    if (!r.success) throw new Error('products failed');
    if (r.data.length === 0) throw new Error('无数据产品');
  });

  // 9. G端购买 + 分佣
  await test('G端购买 + BC分佣50%', async () => {
    const r = await post('/api/data-market/purchase', { productId: 'dp_1', buyerId: userG.id, quantity: 1 });
    if (!r.success) throw new Error('purchase failed');
    const { commission } = r.data;
    if (Math.abs(commission.totalCommission - commission.saleAmount * 0.5) > 0.01) {
      throw new Error(`分佣比例不对: ${commission.totalCommission}/${commission.saleAmount}`);
    }
  });

  // 10. 数据收益
  await test('数据收益查询', async () => {
    const r = await get(`/api/data-market/earnings?userId=${userC.id}`);
    if (!r.success) throw new Error('earnings failed');
    if (r.data.dataEarnings <= 0) throw new Error('收益应为正数');
  });

  // 11. 风控
  await test('AI 风控鉴定', async () => {
    const r = await post('/api/risk/assess', { amount: 50000, userId: userC.id });
    if (!r.success) throw new Error('risk assess failed');
    if (!r.data.decision) throw new Error('无决策结果');
  });

  // 12. 公证
  await test('公证服务商列表', async () => {
    const r = await get('/api/notary/providers');
    if (!r.success) throw new Error('providers failed');
    if (r.data.length < 2) throw new Error('应至少2个服务商');
  });

  console.log(`\n🎉 测试完成: ${passed} 通过, ${failed} 失败`);
}

main().catch(console.error);