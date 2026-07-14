const express = require('express');
const router = express.Router();
const { walletStore } = require('../models/dataStore');

// GET /api/wallet/balance — 查询钱包
router.get('/balance', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId required' });
  }
  const wallet = walletStore.get(userId);
  res.json({ success: true, data: wallet });
});

// GET /api/wallet/transactions — 交易流水
router.get('/transactions', (req, res) => {
  const { userId, page } = req.query;
  if (!userId) {
    return res.status(400).json({ success: false, error: 'userId required' });
  }
  const result = walletStore.getTransactions(userId, parseInt(page) || 1);
  res.json({ success: true, data: result });
});

module.exports = router;