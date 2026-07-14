const express = require('express');
const router = express.Router();
const { hashStore, paymentStore } = require('../models/dataStore');

// POST /api/hash/create — 创建存证
router.post('/create', (req, res) => {
  const { txId, hash, dataDigest, dataType, metadata } = req.body;
  if (!txId || !hash) {
    return res.status(400).json({ success: false, error: 'txId and hash required' });
  }
  const record = hashStore.create({ txId, hash, dataDigest, dataType, metadata });
  res.json({ success: true, data: record });
});

// GET /api/hash/query — 查询存证
router.get('/query', (req, res) => {
  const { txId, hash } = req.query;
  let record = null;
  if (txId) record = hashStore.getByTxId(txId);
  else if (hash) record = hashStore.getByHash(hash);
  if (!record) {
    return res.status(404).json({ success: false, error: '存证不存在' });
  }
  res.json({ success: true, data: record });
});

// GET /api/hash/list — 存证列表
router.get('/list', (req, res) => {
  const { page } = req.query;
  const result = hashStore.list(parseInt(page) || 1);
  res.json({ success: true, data: result });
});

// POST /api/hash/verify — 验证存证
router.post('/verify', (req, res) => {
  const { txData, hash, nonce } = req.body;
  if (!txData || !hash) {
    return res.status(400).json({ success: false, error: 'txData and hash required' });
  }
  const hashEngine = require('../hashEngine');
  const valid = hashEngine.verify(txData, hash, nonce || '');
  res.json({ success: true, data: { valid, hash } });
});

module.exports = router;