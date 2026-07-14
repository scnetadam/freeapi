/**
 * 龟钮印证 — Seed 数据初始化脚本
 * 启动时自动填充演示数据
 */

const { userStore, paymentStore, hashStore, walletStore, dataMarketStore } = require('./models/dataStore');

const { TagEngine } = require('./tagEngine');
const glmClient = require('./glmClient');

function seed() {
  console.log('[Seed] 初始化演示数据...');

  // 1. 创建用户 - 使用 openId 作为 userId，避免前后端 ID 不一致
  const u1 = userStore.create({ id: 'demo_c_001', openId: 'demo_c_001', nickName: '用户小明', role: 'C' });
  const u2 = userStore.create({ id: 'demo_b_001', openId: 'demo_b_001', nickName: '星辰科技', role: 'B' });
  const u3 = userStore.create({ id: 'demo_c_002', openId: 'demo_c_002', nickName: '用户小红', role: 'C' });
  const g1 = userStore.create({ id: 'demo_g_001', openId: 'demo_g_001', nickName: '数据局-张', role: 'G' });

  // 1b. 打标签
  const tagEngine = new TagEngine();
  tagEngine.tagBatch(u1.id, {
    c_activity: '高',
    c_identity: '上班族',
    c_consume_level: '中',
    c_region: '二线',
    c_data_quality: '高质量',
    c_consent_scope: '全部数据',
    c_trust_score: '78',
  }, 'manual');
  tagEngine.tagBatch(u3.id, {
    c_activity: '中',
    c_identity: '学生',
    c_consume_level: '低',
    c_region: '一线',
    c_data_quality: '中等',
    c_consent_scope: '仅支付',
    c_trust_score: '62',
  }, 'manual');
  tagEngine.tagBatch(u2.id, {
    b_industry: '科技',
    b_scale: '小型',
    b_credit_rating: 'AA',
    b_annual_trade: '500000',
    b_data_demand: JSON.stringify(['支付数据', '消费行为', '信用评分']),
  }, 'manual');

  // 将 tagEngine 挂到全局，供 governance 路由使用
  global.tagEngine = tagEngine;


  // 2. 创建数据产品
  dataMarketStore.createProduct({
    name: '支付交易数据-区域分布',
    description: 'BC端脱敏支付数据，按区域分布统计',
    dataType: 'regional',
    dimensions: ['amount_range', 'region', 'category'],
    price: 500,
    sampleSize: 10000,
  });
  dataMarketStore.createProduct({
    name: '消费行为趋势-月度',
    description: '脱敏后的消费行为月度趋势分析',
    dataType: 'trend',
    dimensions: ['month', 'category', 'avg_amount'],
    price: 1200,
    sampleSize: 50000,
  });
  dataMarketStore.createProduct({
    name: 'B端商户信用评分',
    description: 'B端商户交易信用评分数据集',
    dataType: 'credit',
    dimensions: ['score', 'volume', 'refund_rate'],
    price: 2000,
    sampleSize: 5000,
  });

  // 3. 用户授权
  dataMarketStore.setConsent(u1.id, { scope: 'all' });
  dataMarketStore.setConsent(u2.id, { scope: 'payment_only' });
  dataMarketStore.setConsent(u3.id, { scope: 'all' });

  // 4. 创建几笔演示交易
  const tx1 = paymentStore.create({ userId: u1.id, amount: 1500, subject: '活动报名费', payerId: u1.id, payeeId: u2.id });
  paymentStore.confirmSuccess(tx1.id, 'ali_demo_001');
  walletStore.addBalance(u2.id, 1500, '收款: 活动报名费', tx1.id);

  const tx2 = paymentStore.create({ userId: u3.id, amount: 300, subject: '商品购买', payerId: u3.id, payeeId: u2.id });
  paymentStore.confirmSuccess(tx2.id, 'ali_demo_002');
  walletStore.addBalance(u2.id, 300, '收款: 商品购买', tx2.id);

  const tx3 = paymentStore.create({ userId: u1.id, amount: 50, subject: '打赏', payerId: u1.id, payeeId: u3.id });
  paymentStore.confirmSuccess(tx3.id, 'ali_demo_003');
  walletStore.addBalance(u3.id, 50, '收款: 打赏', tx3.id);

  console.log(`[Seed] 完成: ${userStore.getAll().length} 用户, ${paymentStore.getAll().length} 交易, ${dataMarketStore.getProducts().length} 数据产品`);
  return { u1, u2, u3, g1 };
}

module.exports = { seed };