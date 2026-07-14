/**
 * 龟钮印证 — 端到端自动化测试
 * 验证所有核心 API 接口
 */

const BASE = 'http://localhost:3000';
const { default: fetch } = await import('node-fetch');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

async function main() {
  console.log('🧪 龟钮印证 L0 结算壳 — 端到端测试\n');

  // 1. 健康检查
  await test('健康检查', async () => {
    const r = await fetch(`${BASE}/health`).then(r => r.json());
    if (r.status !== 'ok') throw new Error('status not ok');
  });

  // 2. 登录
  let userC, userB, userG;
  await test('C端登录', async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'test_c', nickName: '小明', role: 'C' }),
    }).then(r => r.json());
    if (!r.success) throw new Error('login failed');
    userC = r.data.user;
  });

  await test('B端登录', async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'test_b', nickName: '商户', role: 'B' }),
    }).then(r => r.json());
    if (!r.success) throw new Error('login failed');
    userB = r.data.user;
  });

  await test('G端登录', async () => {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'test_g', nickName: '数据局', role: 'G' }),
    }).then(r => r.json());
    if (!r.success) throw new Error('login failed');
    userG = r.data.user;
  });

  // 3. 创建支付 (C端→B端, 小额, 应免费)
  let payId;
  await test('C→B 小额支付 (免费)', async () => {
    const r = await fetch(`${BASE}/api/payment/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100, subject: '商品', payerId: userC.id, payeeId: userB.id }),
    }).then(r => r.json());
    if (!r.success) throw new Error('create failed');
    if (r.data.bFee !== 0) throw new Error('C端不应收资费');
    payId = r.data.id;
  });

  await test('B端大额支付 (资费+封顶)', async () => {
    const r = await fetch(`${BASE}/api/payment/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100000, subject: '大额交易', payerId: userB.id, payeeId: userC.id }),
    }).then(r => r.json());
    if (!r.success) throw new Error('create failed');
    if (r.data.bFee !== 20) throw new Error(`资费应为20(封顶), 实际=${r.data.bFee}`);
  });

  // 4. 确认支付
  await test('确认支付', async () => {
    const r = await fetch(`${BASE}/api/payment/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: payId, channelTradeNo: 'ali_test_001' }),
    }).then(r => r.json());
    if (!r.success) throw new Error('confirm failed');
    if (r.data.status !== 'success') throw new Error('status not success');
  });

  // 5. 钱包余额
  await test('钱包余额', async () => {
    const r = await fetch(`${BASE}/api/wallet/balance?userId=${userB.id}`).then(r => r.json());
    if (!r.success) throw new Error('balance failed');
    if (r.data.balance <= 0) throw new Error('余额应为正数');
  });

  // 6. HASH 存证
  await test('HASH 存证查询', async () => {
    const r = await fetch(`${BASE}/api/hash/query?txId=${payId}`).then(r => r.json());
    if (!r.success) throw new Error('hash query failed');
  });

  // 7. 数据授权
  await test('数据授权', async () => {
    const r = await fetch(`${BASE}/api/data-market/consent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: userC.id, scope: 'all' }),
    }).then(r => r.json());
    if (!r.success) throw new Error('consent failed');
  });

  // 8. 数据产品
  await test('数据产品列表', async () => {
    const r = await fetch(`${BASE}/api/data-market/products`).then(r => r.json());
    if (!r.success) throw new Error('products failed');
    if (r.data.length === 0) throw new Error('无数据产品');
  });

  // 9. G端购买 + 分佣
  await test('G端购买数据 + BC分佣50%', async () => {
    const r = await fetch(`${BASE}/api/data-market/purchase`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: 'dp_1', buyerId: userG.id, quantity: 1 }),
    }).then(r => r.json());
    if (!r.success) throw new Error('purchase failed');
    const { commission } = r.data;
    if (commission.totalCommission !== commission.saleAmount * 0.5) {
      throw new Error(`分佣比例不对: ${commission.totalCommission} / ${commission.saleAmount}`);
    }
  });

  // 10. 数据收益
  await test('数据收益查询', async () => {
    const r = await fetch(`${BASE}/api/data-market/earnings?userId=${userC.id}`).then(r => r.json());
    if (!r.success) throw new Error('earnings failed');
    if (r.data.dataEarnings <= 0) throw new Error('收益应为正数');
  });

  // 11. 风控
  await test('AI 风控鉴定', async () => {
    const r = await fetch(`${BASE}/api/risk/assess`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 50000, userId: userC.id }),
    }).then(r => r.json());
    if (!r.success) throw new Error('risk assess failed');
    if (!r.data.decision) throw new Error('无决策结果');
  });

  // 12. 公证
  await test('公证服务商列表', async () => {
    const r = await fetch(`${BASE}/api/notary/providers`).then(r => r.json());
    if (!r.success) throw new Error('providers failed');
    if (r.data.length < 2) throw new Error('应至少2个服务商');
  });

  console.log('\n🎉 全部测试完成!');
}

main().catch(console.error);