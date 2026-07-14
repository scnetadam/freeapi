/**
 * 龟钮印证 — Agent 支付路由 (L0)
 * 智能体自主支付：大模型风控 + 自动扣款 + 超额提醒
 */

const express = require('express');
const router = express.Router();
const { paymentStore, walletStore, hashStore } = require('../models/dataStore');
const hashEngine = require('../hashEngine');
const { AgentPayEngine } = require('../agentPayEngine');

const agentPay = new AgentPayEngine();

// POST /api/agent-pay/rule — 设置用户 Agent 支付规则
router.post('/rule', (req, res) => {
  const { userId, ...rule } = req.body;
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId required' });
  }

  const saved = agentPay.ruleStore.setRule(userId, rule);
  res.json({
    success: true,
    data: {
      userId: saved.userId,
      dailyLimit: saved.dailyLimit,
      autoPassLimit: saved.autoPassLimit,
      llmReviewLimit: saved.llmReviewLimit,
      userConfirmLimit: saved.userConfirmLimit,
      allowedTypes: saved.allowedTypes,
      allowedPayees: saved.allowedPayees,
      enabled: saved.enabled,
    },
  });
});

// GET /api/agent-pay/rule — 获取用户的 Agent 支付规则
router.get('/rule', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId required' });
  }

  const rule = agentPay.ruleStore.getRule(userId);
  if (!rule) {
    return res.json({ success: true, data: null, message: '未设置 Agent 支付规则' });
  }

  res.json({
    success: true,
    data: agentPay.getStats(userId),
  });
});

// POST /api/agent-pay/decide — Agent 支付决策（风控审核，不执行扣款）
router.post('/decide', async (req, res) => {
  try {
    const { userId, amount, subject, payeeId, type } = req.body;

    if (!userId || !amount || !subject) {
      return res.status(400).json({ success: false, error: '缺少必要参数' });
    }

    const recentTxs = paymentStore.getByUser(userId).slice(-10);
    const ctx = {
      userId,
      amount: parseFloat(amount),
      subject,
      payeeId: payeeId || '',
      type: type || 'data_purchase',
      recentTxs,
    };

    const result = await agentPay.decide(ctx);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[AgentPay Decide Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/agent-pay/execute — 执行 Agent 支付（决策 + 自动扣款 + 存证）
router.post('/execute', async (req, res) => {
  try {
    const { userId, amount, subject, payeeId, type, approvalId } = req.body;

    if (!userId || !amount || !subject) {
      return res.status(400).json({ success: false, error: '缺少必要参数' });
    }

    // 如果有 approvalId 且已审批通过，跳过决策直接执行
    if (approvalId) {
      const aprv = agentPay.ruleStore.getPendingApproval(approvalId);
      if (aprv && aprv.status === 'approved') {
        const ctx = {
          userId,
          amount: parseFloat(amount),
          subject,
          payeeId: payeeId || '',
          type: type || 'data_purchase',
        };
        const payment = await agentPay.executePay(ctx, paymentStore, walletStore, hashStore, hashEngine);
        return res.json({
          success: true,
          data: {
            id: payment.id,
            amount: payment.amount,
            subject: payment.subject,
            hash: payment.hash,
            status: payment.status,
            paidAt: payment.paidAt,
            decision: { decision: 'approved_executed', reason: '审批通过后执行' },
          },
        });
      }
      return res.status(400).json({ success: false, error: '审批请求未通过或已过期' });
    }

    const ctx = {
      userId,
      amount: parseFloat(amount),
      subject,
      payeeId: payeeId || '',
      type: type || 'data_purchase',
      recentTxs: paymentStore.getByUser(userId).slice(-10),
    };

    // 1. 先决策
    const decision = await agentPay.decide(ctx);

    if (decision.action === 'reject') {
      return res.json({
        success: false,
        error: decision.reason,
        decision,
      });
    }

    if (decision.action === 'pending_approval') {
      return res.json({
        success: false,
        error: decision.reason,
        decision,
        action: 'pending_approval',
        approvalId: decision.approvalId,
      });
    }

    // 2. 决策通过，执行支付
    if (decision.action === 'proceed') {
      const payment = await agentPay.executePay(ctx, paymentStore, walletStore, hashStore, hashEngine);

      return res.json({
        success: true,
        data: {
          id: payment.id,
          amount: payment.amount,
          subject: payment.subject,
          hash: payment.hash,
          status: payment.status,
          paidAt: payment.paidAt,
          decision,
        },
      });
    }

    // 不应到达这里
    res.status(500).json({ success: false, error: '未知决策结果' });
  } catch (err) {
    console.error('[AgentPay Execute Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/agent-pay/pending — 获取用户的待审批请求
router.get('/pending', (req, res) => {
  const { userId } = req.query;
  if (userId) {
    const list = agentPay.ruleStore.getPendingApprovals(userId);
    return res.json({ success: true, data: { list, total: list.length } });
  }
  const all = agentPay.ruleStore.getAllPendingApprovals();
  res.json({ success: true, data: { list: all, total: all.length } });
});

// POST /api/agent-pay/approve — 审批（同意/拒绝）
router.post('/approve', (req, res) => {
  const { approvalId, action } = req.body;
  if (!approvalId || !action) {
    return res.status(400).json({ success: false, error: 'approvalId and action required' });
  }

  let result;
  if (action === 'approve') {
    result = agentPay.ruleStore.approve(approvalId);
  } else if (action === 'reject') {
    result = agentPay.ruleStore.reject(approvalId);
  } else {
    return res.status(400).json({ success: false, error: 'action must be approve or reject' });
  }

  if (!result) {
    return res.status(404).json({ success: false, error: '审批请求不存在或已处理' });
  }

  res.json({ success: true, data: result });
});

// GET /api/agent-pay/stats — Agent 支付统计
router.get('/stats', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId required' });
  }

  const stats = agentPay.getStats(userId);
  if (!stats) {
    return res.json({ success: true, data: null, message: '未配置 Agent 支付' });
  }

  res.json({ success: true, data: stats });
});

module.exports = router;