/**
 * 龟钮印证 — 数据市场路由
 * BC 数据 → 脱敏 → G 端购买 → BC 分佣 50%
 */

const express = require('express');
const router = express.Router();
const { dataMarketStore, walletStore, userStore, paymentStore } = require('../models/dataStore');
const glmClient = require('../glmClient');
const dataMarketEngine = require('../dataMarketEngine');

// ==================== 数据授权 (BC端) ====================

// POST /api/data-market/consent — 用户授权
router.post('/consent', (req, res) => {
  const { userId, scope } = req.body;
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId required' });
  }

  const consent = dataMarketStore.setConsent(userId, { scope: scope || 'all' });
  res.json({ success: true, data: consent });
});

// GET /api/data-market/consent — 查询授权状态
router.get('/consent', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId required' });
  }
  const consent = dataMarketStore.getConsent(userId);
  res.json({ success: true, data: consent || { userId, consented: false } });
});

// POST /api/data-market/consent/revoke — 撤销授权
router.post('/consent/revoke', (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId required' });
  }
  const result = dataMarketStore.revokeConsent(userId);
  res.json({ success: true, data: result });
});

// ==================== 数据产品 (G端可见) ====================

// POST /api/data-market/product — 创建数据产品 (管理端，支持 AI 定价)
router.post('/product', async (req, res) => {
  const { name, description, dataType, dimensions, price, sampleSize, aiPricing } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, error: 'name required' });
  }

  let finalPrice = price;
  let aiSuggestion = null;

  // AI 智能定价
  if (aiPricing || !price) {
    try {
      const prompt = `你是一个数据产品定价专家。请为以下数据产品给出合理定价建议：

产品名称：${name}
描述：${description || '无'}
数据类型：${dataType || '通用交易数据'}
数据维度：${dimensions ? dimensions.join(', ') : '通用'}
数据样本量：${sampleSize || '未指定'}

参考定价规则：
- 基础数据报告（简单聚合）：¥50-200
- 中等粒度数据（按维度分类）：¥200-800
- 细粒度脱敏数据（可深入分析）：¥800-5000
- 大样本定制数据：¥5000-20000

请返回以下 JSON 格式（不要 Markdown）：
{
  "suggestedPrice": <数字,建议价格>,
  "priceRange": "<最低价-最高价>",
  "reason": "<定价理由,一句话说明>",
  "confidence": "low|medium|high"
}`;

      const glmResult = await glmClient.chat([
        { role: 'user', content: prompt },
      ]);
      const text = glmResult.choices?.[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiSuggestion = JSON.parse(jsonMatch[0]);
        if (!finalPrice && aiSuggestion.suggestedPrice) {
          finalPrice = aiSuggestion.suggestedPrice;
        }
      }
    } catch (e) {
      console.error('[AI Pricing Error]', e.message);
    }
  }

  if (!finalPrice) {
    return res.status(400).json({ success: false, error: '价格不能为空，请手动输入或启用 AI 定价' });
  }

  const product = dataMarketStore.createProduct({
    name, description, dataType, dimensions, price: finalPrice, sampleSize,
  });
  res.json({ success: true, data: { product, aiSuggestion } });
});

// GET /api/data-market/price-suggest — AI 定价建议（独立查询）
router.get('/price-suggest', async (req, res) => {
  const { name, description, dataType, dimensions, sampleSize } = req.query;
  if (!name) {
    return res.status(400).json({ success: false, error: 'name required' });
  }

  try {
    const prompt = `你是一个数据产品定价专家。请为以下数据产品给出合理定价建议：

产品名称：${name}
描述：${description || '无'}
数据类型：${dataType || '通用交易数据'}
数据维度：${dimensions || '通用'}
数据样本量：${sampleSize || '未指定'}

参考定价规则：
- 基础数据报告（简单聚合）：¥50-200
- 中等粒度数据（按维度分类）：¥200-800
- 细粒度脱敏数据（可深入分析）：¥800-5000
- 大样本定制数据：¥5000-20000

请返回以下 JSON 格式（不要 Markdown）：
{
  "suggestedPrice": <数字,建议价格>,
  "priceRange": "<最低价-最高价>",
  "reason": "<定价理由,一句话说明>",
  "confidence": "low|medium|high"
}`;

    const glmResult = await glmClient.chat([
      { role: 'user', content: prompt },
    ]);
    const text = glmResult.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const suggestion = JSON.parse(jsonMatch[0]);
      return res.json({ success: true, data: suggestion });
    }
    res.json({ success: false, error: 'AI 无法生成定价建议' });
  } catch (e) {
    console.error('[AI Price Suggest Error]', e.message);
    res.status(500).json({ success: false, error: 'AI 定价服务异常' });
  }
});

// GET /api/data-market/products — 数据产品列表 (G端)
router.get('/products', (req, res) => {
  const products = dataMarketStore.listProducts();
  res.json({ success: true, data: products });
});

// GET /api/data-market/product/:id — 数据产品详情
router.get('/product/:id', (req, res) => {
  const product = dataMarketStore.getProduct(req.params.id);
  if (!product) {
    return res.status(404).json({ success: false, error: '数据产品不存在' });
  }
  res.json({ success: true, data: product });
});

// ==================== 购买 (G端) ====================

// POST /api/data-market/purchase — G端购买数据
router.post('/purchase', (req, res) => {
  const { productId, buyerId, quantity } = req.body;
  if (!productId || !buyerId) {
    return res.status(400).json({ success: false, error: 'productId and buyerId required' });
  }

  const product = dataMarketStore.getProduct(productId);
  if (!product) {
    return res.status(404).json({ success: false, error: '数据产品不存在' });
  }

  const amount = product.price * (quantity || 1);
  const order = dataMarketStore.createOrder({ productId, buyerId, amount, quantity: quantity || 1 });

  // 简化：直接确认订单
  dataMarketStore.confirmOrder(order.id);

  // 计算分佣
  // 去重：只取 id 格式的用户 (跳过 openId 索引)
  const consentedUsers = [];
  const seen = new Set();
  // 改用 key 迭代避免 Map 双 key 重复
  userStore.getAll().forEach(function(u) {
    if (!u || !u.id || !u.id.startsWith('u_')) return;
    if (seen.has(u.id)) return;
    seen.add(u.id);
    const consent = dataMarketStore.getConsent(u.id);
    if (consent && !consent.revokedAt) {
      consentedUsers.push(u.id);
    }
  });

  if (consentedUsers.length > 0) {
    const commission = dataMarketEngine.calculateCommission(amount, consentedUsers);

    // 给每个数据提供者发分佣
    for (const provider of commission.providers) {
      walletStore.addDataEarnings(
        provider.userId,
        provider.shareAmount,
        `数据市场分成: ${product.name}`,
        order.id,
      );
    }

    res.json({
      success: true,
      data: {
        order,
        product,
        commission,
      },
    });
  } else {
    res.json({
      success: true,
      data: {
        order,
        product,
        commission: { totalCommission: 0, platformShare: amount, providers: [] },
      },
    });
  }
});

// GET /api/data-market/orders — G端购买记录
router.get('/orders', (req, res) => {
  const { buyerId } = req.query;
  if (!buyerId) {
    return res.status(400).json({ success: false, error: 'buyerId required' });
  }
  const orders = dataMarketStore.listOrders(buyerId);
  res.json({ success: true, data: orders });
});

// ==================== 数据分成收益 (BC端) ====================

// GET /api/data-market/earnings — BC端数据分成收益
router.get('/earnings', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId required' });
  }
  const wallet = walletStore.get(userId);
  res.json({
    success: true,
    data: {
      dataEarnings: wallet.dataEarnings,
      totalEarnings: wallet.totalIncome,
      balance: wallet.balance,
    },
  });
});

// ==================== 脱敏数据预览 (G端) ====================

// GET /api/data-market/sample — 脱敏数据样本
router.get('/sample', (req, res) => {
  const { productId } = req.query;
  // 简化：从支付记录中取脱敏样本
  const payments = paymentStore.list(1, 10);
  const sanitized = payments.list.map(p => dataMarketEngine.sanitize(p));
  res.json({ success: true, data: sanitized });
});

module.exports = router;