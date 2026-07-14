const express = require('express');
const router = express.Router();
const { paymentStore } = require('../models/dataStore');
const riskEngine = require('../riskEngine');
const glmClient = require('../glmClient');

// POST /api/risk/assess — 支付风险鉴定
router.post('/assess', (req, res) => {
  const { amount, userId, payeeId } = req.body;
  if (!amount || !userId) {
    return res.status(400).json({ success: false, error: 'amount and userId required' });
  }

  const recentTxs = paymentStore.getByUser(userId).slice(-10);
  const result = riskEngine.assessPaymentRisk({ amount, userId, payeeId, recentTxs });

  res.json({ success: true, data: result });
});

// POST /api/risk/alert — 消费行为公益提醒
router.post('/alert', (req, res) => {
  const { category, monthlyTotal, threshold, frequency } = req.body;
  if (!category) {
    return res.status(400).json({ success: false, error: 'category required' });
  }

  const alerts = riskEngine.consumptionAlert({
    category,
    monthlyTotal: monthlyTotal || 0,
    threshold: threshold || 100,
    frequency: frequency || 0,
  });

  res.json({ success: true, data: alerts });
});

// POST /api/risk/llm — 大模型风控分析
router.post('/llm', async (req, res) => {
  try {
    const { amount, userId, payeeId } = req.body;
    const recentTxs = paymentStore.getByUser(userId).slice(-10);
    const result = await riskEngine.llmRiskAnalysis({
      amount, userId, payeeId, recentTxs,
    }, glmClient);

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[Risk LLM Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;