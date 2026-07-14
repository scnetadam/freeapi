/**
 * 龟钮印证 — G 端监管看板路由 (L0)
 * 政府/监管部门：交易审计、存证验证、用户画像、异常预警
 */

const express = require('express');
const router = express.Router();
const { userStore, paymentStore, hashStore, walletStore, dataMarketStore } = require('../models/dataStore');
const glmClient = require('../glmClient');

// 获取全局 TagEngine 实例
function getTagEngine() {
  return global.tagEngine || null;
}

// 中间件：仅 G 端可访问
function requireG(req, res, next) {
  const { userId } = req.query;
  if (userId) {
    const user = userStore.getById(userId);
    if (user && user.role === 'G') return next();
  }
  if (req.headers['x-role'] === 'G') return next();
  return res.status(403).json({ success: false, error: '仅监管机构(G端)可访问' });
}

// ==================== 交易审计 ====================

/** GET /api/governance/dashboard — 监管概览数据 */
router.get('/dashboard', requireG, function(req, res) {
  var allTxs = paymentStore.getAll().filter(function(tx) { return tx.status === 'success'; });
  var allUsers = [];
  userStore.getAll().forEach(u => { if (u && u.id) allUsers.push(u); });
  var unique = {};
  allUsers.forEach(function(u) { unique[u.id] = u; });
  var users = Object.values(unique);

  var totalAmount = allTxs.reduce(function(s, t) { return s + (t.amount || 0); }, 0);
  var totalCount = allTxs.length;

  // 按角色统计交易
  var byRoleTx = { C: 0, B: 0 };
  allTxs.forEach(function(tx) {
    var payer = userStore.getById(tx.payerId);
    if (payer && payer.role === 'B') byRoleTx.B += tx.amount;
    else byRoleTx.C += tx.amount;
  });

  // 数据市场统计
  var dmProducts = dataMarketStore.listProducts ? dataMarketStore.listProducts() : [];
  var dmSales = dataMarketStore._sales ? dataMarketStore._sales.size : 0;
  var dmRevenue = 0;
  if (dataMarketStore._sales) {
    dataMarketStore._sales.forEach(function(s) { dmRevenue += s.amount || 0; });
  }

  // 用户授权统计
  var consentCount = 0;
  var consents = dataMarketStore._consents;
  if (consents) {
    consents.forEach(function() { consentCount++; });
  }

  res.json({
    success: true,
    data: {
      transactions: { total: totalCount, totalAmount: totalAmount, avgAmount: totalCount > 0 ? (totalAmount / totalCount).toFixed(2) : 0 },
      users: { total: users.length, byRole: { C: users.filter(function(u) { return u.role === 'C'; }).length, B: users.filter(function(u) { return u.role === 'B'; }).length, G: users.filter(function(u) { return u.role === 'G'; }).length } },
      dataMarket: { products: dmProducts.length, sales: dmSales, revenue: dmRevenue, authorizedUsers: consentCount },
      byRoleTx: byRoleTx,
    },
  });
});

/** GET /api/governance/audit — 交易流水审计 */
router.get('/audit', requireG, function(req, res) {
  var page = parseInt(req.query.page) || 1;
  var pageSize = parseInt(req.query.pageSize) || 50;
  var role = req.query.role;
  var minAmount = parseFloat(req.query.minAmount) || 0;
  var maxAmount = parseFloat(req.query.maxAmount) || Infinity;
  var dateFrom = req.query.dateFrom;
  var dateTo = req.query.dateTo;

  var txs = paymentStore.getAll();

  if (role) {
    txs = txs.filter(function(tx) {
      var payer = userStore.getById(tx.payerId);
      return payer && payer.role === role;
    });
  }
  if (minAmount) txs = txs.filter(function(tx) { return tx.amount >= minAmount; });
  if (maxAmount < Infinity) txs = txs.filter(function(tx) { return tx.amount <= maxAmount; });
  if (dateFrom) txs = txs.filter(function(tx) { return tx.createdAt >= dateFrom; });
  if (dateTo) txs = txs.filter(function(tx) { return tx.createdAt <= dateTo; });

  txs.sort(function(a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });

  var total = txs.length;
  var totalPages = Math.ceil(total / pageSize);
  var data = txs.slice((page - 1) * pageSize, page * pageSize).map(function(tx) {
    var payer = userStore.getById(tx.payerId);
    var payee = userStore.getById(tx.payeeId);
    return {
      id: tx.id,
      amount: tx.amount,
      subject: tx.subject,
      payerId: tx.payerId,
      payerName: payer ? payer.nickName : tx.payerId,
      payerRole: payer ? payer.role : '?',
      payeeId: tx.payeeId,
      payeeName: payee ? payee.nickName : tx.payeeId,
      payeeRole: payee ? payee.role : '?',
      hash: tx.hash,
      status: tx.status,
      createdAt: tx.createdAt,
    };
  });

  var totalAmount = txs.reduce(function(s, t) { return s + t.amount; }, 0);
  var avgAmount = total > 0 ? (totalAmount / total).toFixed(2) : 0;

  res.json({
    success: true,
    data: {
      list: data,
      pagination: { page: page, pageSize: pageSize, total: total, totalPages: totalPages },
      summary: { totalAmount: totalAmount, totalCount: total, avgAmount: avgAmount },
    },
  });
});

// ==================== 存证监管 ====================

/** GET /api/governance/notary — 存证记录查询 */
router.get('/notary', requireG, function(req, res) {
  var certificateNo = req.query.certificateNo;
  var hash = req.query.hash;
  var records = hashStore.list();
  var filtered = records;

  if (certificateNo) {
    filtered = filtered.filter(function(r) { return r.certificateNo === certificateNo; });
  }
  if (hash) {
    filtered = filtered.filter(function(r) { return r.hash === hash; });
  }

  res.json({
    success: true,
    data: {
      list: filtered.slice(0, 100),
      total: filtered.length,
    },
  });
});

/** GET /api/governance/verify — 验证存证 */
router.get('/verify', requireG, function(req, res) {
  var hash = req.query.hash;
  if (!hash) return res.status(400).json({ success: false, error: '缺少 HASH' });

  var record = hashStore.getByHash(hash);
  if (!record) {
    return res.json({ success: true, data: { verified: false, message: '未找到存证记录' } });
  }

  res.json({
    success: true,
    data: {
      verified: true,
      record: {
        txId: record.txId,
        hash: record.hash,
        dataDigest: record.dataDigest,
        dataType: record.dataType,
        createdAt: record.createdAt,
        certificateNo: record.certificateNo,
      },
    },
  });
});

// ==================== 用户画像统计 ====================

/** GET /api/governance/stats/users — 用户画像统计 */
router.get('/stats/users', requireG, function(req, res) {
  var allUsers = [];
  userStore.getAll().forEach(u => {
    if (u && u.id) allUsers.push(u);
  });
  var unique = {};
  allUsers.forEach(function(u) { unique[u.id] = u; });
  var users = Object.values(unique);

  var stats = {
    total: users.length,
    byRole: { C: 0, B: 0, G: 0 },
    byPlatform: {},
    tagStats: {},
  };

  users.forEach(function(u) {
    stats.byRole[u.role] = (stats.byRole[u.role] || 0) + 1;
    stats.byPlatform[u.platform] = (stats.byPlatform[u.platform] || 0) + 1;
  });

  var te = getTagEngine();
  if (te) {
    var tagCategories = te.getCategories();
    var allCats = (tagCategories.user_c || []).concat(tagCategories.user_b || []);
    allCats.forEach(function(cat) {
      var agg = te.aggregate(cat.id);
      if (Object.keys(agg).length > 0) {
        stats.tagStats[cat.id] = { label: cat.label, values: agg };
      }
    });
  }

  res.json({ success: true, data: stats });
});

// ==================== 异常预警 ====================

/** GET /api/governance/alerts — 异常交易预警 */
router.get('/alerts', requireG, function(req, res) {
  var txs = paymentStore.getAll();
  var alerts = [];

  // 大额交易预警
  txs.forEach(function(tx) {
    if (tx.amount >= 4000) {
      alerts.push({
        level: 'warning',
        type: 'large_tx',
        message: '大额交易: ' + tx.amount,
        txId: tx.id,
        userId: tx.payerId,
        createdAt: tx.createdAt,
      });
    }
  });

  // 高频交易预警
  var now = Date.now();
  var recentMap = {};
  txs.forEach(function(tx) {
    var time = new Date(tx.createdAt).getTime();
    if (now - time < 300000) {
      if (!recentMap[tx.payerId]) recentMap[tx.payerId] = [];
      recentMap[tx.payerId].push(tx);
    }
  });
  Object.keys(recentMap).forEach(function(userId) {
    var recentTxs = recentMap[userId];
    if (recentTxs.length >= 5) {
      alerts.push({
        level: 'critical',
        type: 'high_frequency',
        message: '高频交易: ' + recentTxs.length + ' 笔/5分钟',
        userId: userId,
        count: recentTxs.length,
        createdAt: new Date().toISOString(),
      });
    }
  });

  // 标签异常
  var te = getTagEngine();
  if (te) {
    te._tags.forEach(function(tags, targetId) {
      var tagMap = {};
      tags.forEach(function(t) { tagMap[t.categoryId] = t.value; });
      if (tagMap.c_trust_score && parseInt(tagMap.c_trust_score) < 30) {
        alerts.push({
          level: 'warning',
          type: 'low_trust',
          message: '低信用分用户: ' + targetId + ' (' + tagMap.c_trust_score + ')',
          userId: targetId,
          createdAt: new Date().toISOString(),
        });
      }
    });
  }

  var levelOrder = { critical: 0, warning: 1, info: 2 };
  alerts.sort(function(a, b) { return (levelOrder[a.level] || 9) - (levelOrder[b.level] || 9); });

  res.json({
    success: true,
    data: {
      list: alerts.slice(0, 100),
      total: alerts.length,
      criticalCount: alerts.filter(function(a) { return a.level === 'critical'; }).length,
      warningCount: alerts.filter(function(a) { return a.level === 'warning'; }).length,
    },
  });
});

// ==================== 合规检查 ====================

/** POST /api/governance/compliance — 合规检查 */
router.post('/compliance', requireG, function(req, res) {
  var txId = req.body.txId;
  var rules = req.body.rules;
  if (!txId) return res.status(400).json({ success: false, error: '缺少 txId' });

  var tx = paymentStore.getById(txId);
  if (!tx) return res.status(404).json({ success: false, error: '交易不存在' });

  var payer = userStore.getById(tx.payerId);
  var payee = userStore.getById(tx.payeeId);

  var checks = {
    payer_role: { passed: !!payer, detail: '付款方: ' + (payer ? payer.nickName + ' (' + payer.role + ')' : '未知') },
    payee_role: { passed: !!payee, detail: '收款方: ' + (payee ? payee.nickName + ' (' + payee.role + ')' : '未知') },
    amount_valid: { passed: tx.amount > 0, detail: '金额: ' + tx.amount },
    has_hash: { passed: !!tx.hash, detail: '存证: ' + (tx.hash ? tx.hash.slice(0, 16) + '...' : '无存证') },
    data_scope: {
      passed: !(payer && payer.role === 'C' && payee && payee.role === 'B'),
      detail: 'C 端数据仅对 G 端开放（公益应用）',
    },
  };

  if (rules && Array.isArray(rules)) {
    rules.forEach(function(rule, i) {
      checks['custom_' + i] = {
        passed: evalRule(rule, tx, payer, payee),
        detail: rule.description || '自定义规则 ' + i,
      };
    });
  }

  var allPassed = true;
  for (var key in checks) {
    if (!checks[key].passed) { allPassed = false; break; }
  }

  res.json({
    success: true,
    data: {
      txId: txId,
      compliant: allPassed,
      checks: checks,
      summary: allPassed ? '合规' : '存在不合规项',
    },
  });
});

function evalRule(rule, tx, payer, payee) {
  if (!rule || !rule.type) return true;
  switch (rule.type) {
    case 'max_amount':
      return tx.amount <= (rule.value || Infinity);
    case 'allowed_role':
      return (payer && payer.role === rule.value) || (payee && payee.role === rule.value);
    case 'forbidden_role':
      return (payer && payer.role !== rule.value) && (payee && payee.role !== rule.value);
    default:
      return true;
  }
}

module.exports = router;