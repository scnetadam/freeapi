/**
 * 龟纽印信 · 存证路由 — guinieu:v1 规范
 * 融合至龟钮印证 L0 结算壳
 *
 * 功能：
 *   - seal — 链式存证（自动链至上一事件）
 *   - export — 导出可核验凭证包
 *   - verify — 验证凭证包完整性
 *   - query — 查询存证链
 *
 * 集成点：
 *   - POST /api/payment/create → 自动 sealImpress('settle_instruct')
 *   - POST /api/payment/confirm → 自动 sealImpress('proof_submit')
 *   POST /api/hash/create → 自动 sealImpress('seal_impressed')
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../models/database');
const { sealImpress, exportBundle, computeHash } = require('./seal');
const { verifyBundle, formatReport } = require('./verify');

// ==================== 工具函数 ====================

/** 获取链上最新事件（用于 prevEventId） */
function getLatestEvent() {
  return getDb().prepare('SELECT * FROM guinieu_events ORDER BY rowid DESC LIMIT 1').get() || null;
}

/** 按 event_id 查找事件 */
function getEvent(eventId) {
  return getDb().prepare('SELECT * FROM guinieu_events WHERE event_id = ?').get(eventId) || null;
}

/** 写入事件到 DB */
function insertEvent(event) {
  getDb().prepare(`
    INSERT INTO guinieu_events (event_id, type, ts, payload_json, payload_hash, prev_event_id, sig_method, sig, status, reason, created_by, ref_tx_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.event_id, event.type, event.ts, event.payload_json,
    event.payload_hash, event.prev_event_id, event.sig_method, event.sig,
    event.status || 'active', event.reason || null, event.created_by || 'system',
    event.ref_tx_id || null, new Date().toISOString(),
  );
  return getEvent(event.event_id);
}

/** 按 ref_tx_id 查找事件链 */
function getChainByRefTx(refTxId) {
  return getDb().prepare(`
    SELECT * FROM guinieu_events WHERE ref_tx_id = ? ORDER BY rowid ASC
  `).all(refTxId);
}

/** **核心**：seal 并写入 DB，自动链至上一事件 */
function doSeal({ type, payload, createdBy, sigMethod, secretOrKey, refTxId }) {
  const latest = getLatestEvent();
  const prevEventId = latest ? latest.event_id : null;
  const event = sealImpress({ type, payload, prevEventId, createdBy, sigMethod, secretOrKey });
  event.ref_tx_id = refTxId || null;
  return insertEvent(event);
}

// ==================== 路由 ====================

/**
 * POST /api/guinieu/seal — 存证
 * body: { type, payload, createdBy, sigMethod?, secretOrKey?, refTxId? }
 * 自动确定 prevEventId（链至最新事件）
 */
router.post('/seal', (req, res) => {
  try {
    const { type, payload, createdBy, sigMethod, secretOrKey, refTxId } = req.body;
    if (!type || !payload || !createdBy) {
      return res.status(400).json({ success: false, error: 'type, payload, createdBy 为必填' });
    }
    const record = doSeal({ type, payload, createdBy, sigMethod, secretOrKey, refTxId });
    res.json({
      success: true,
      data: {
        event_id: record.event_id,
        type: record.type,
        ts: record.ts,
        payload_hash: record.payload_hash,
        prev_event_id: record.prev_event_id,
        ref_tx_id: record.ref_tx_id,
      },
    });
  } catch (err) {
    console.error('[Guinieu Seal Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/guinieu/seal-chain — 按自定义 prevEventId 存证
 * body: { type, payload, prevEventId, createdBy, ... }
 */
router.post('/seal-chain', (req, res) => {
  try {
    const { type, payload, prevEventId, createdBy, sigMethod, secretOrKey, refTxId } = req.body;
    if (!type || !payload || !createdBy) {
      return res.status(400).json({ success: false, error: 'type, payload, createdBy 为必填' });
    }
    const event = sealImpress({ type, payload, prevEventId, createdBy, sigMethod, secretOrKey });
    event.ref_tx_id = refTxId || null;
    const record = insertEvent(event);
    res.json({
      success: true,
      data: {
        event_id: record.event_id,
        type: record.type,
        ts: record.ts,
        payload_hash: record.payload_hash,
        prev_event_id: record.prev_event_id,
      },
    });
  } catch (err) {
    console.error('[Guinieu SealChain Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/guinieu/export — 导出可核验凭证包
 * body: { credentialId, subject, type, refTxId?, eventIds?, additional? }
 */
router.post('/export', (req, res) => {
  try {
    const { credentialId, subject, type, refTxId, eventIds, additional } = req.body;
    if (!credentialId || !subject || !type) {
      return res.status(400).json({ success: false, error: 'credentialId, subject, type 为必填' });
    }

    let events;
    if (eventIds && Array.isArray(eventIds)) {
      events = eventIds.map(id => getEvent(id)).filter(Boolean);
    } else if (refTxId) {
      events = getChainByRefTx(refTxId);
    } else {
      // 导出全部事件
      events = getDb().prepare('SELECT * FROM guinieu_events ORDER BY rowid ASC').all();
    }

    if (events.length === 0) {
      return res.status(404).json({ success: false, error: '未找到事件' });
    }

    const bundle = exportBundle({ credentialId, subject, type, events, additional });
    res.json({ success: true, data: bundle });
  } catch (err) {
    console.error('[Guinieu Export Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/guinieu/verify — 验证凭证包
 * body: { bundle } 或 body 直接为 bundle 对象
 */
router.post('/verify', (req, res) => {
  try {
    const bundle = req.body.bundle || req.body;
    if (!bundle || !bundle.schema) {
      return res.status(400).json({ success: false, error: '缺少凭证包数据' });
    }
    const result = verifyBundle(bundle);
    res.json({
      success: result.valid,
      data: {
        valid: result.valid,
        summary: result.summary,
        results: result.results,
        report: formatReport(result),
      },
    });
  } catch (err) {
    console.error('[Guinieu Verify Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/guinieu/query — 查询存证链
 * query: { eventId?, refTxId?, limit? }
 */
router.get('/query', (req, res) => {
  try {
    const { eventId, refTxId, limit = 50 } = req.query;

    if (eventId) {
      const event = getEvent(eventId);
      if (!event) return res.status(404).json({ success: false, error: '事件不存在' });
      return res.json({ success: true, data: { event } });
    }

    if (refTxId) {
      const events = getChainByRefTx(refTxId);
      return res.json({ success: true, data: { events, total: events.length } });
    }

    // 全部事件（分页）
    const events = getDb().prepare('SELECT * FROM guinieu_events ORDER BY rowid DESC LIMIT ?').all(parseInt(limit));
    const total = getDb().prepare('SELECT COUNT(*) as c FROM guinieu_events').get().c;
    res.json({ success: true, data: { events, total, limit: parseInt(limit) } });
  } catch (err) {
    console.error('[Guinieu Query Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/guinieu/stats — 存证统计
 */
router.get('/stats', (req, res) => {
  try {
    const total = getDb().prepare('SELECT COUNT(*) as c FROM guinieu_events').get().c;
    const byType = getDb().prepare(`
      SELECT type, COUNT(*) as count FROM guinieu_events GROUP BY type ORDER BY count DESC
    `).all();
    const latest = getDb().prepare('SELECT event_id, type, ts, created_by FROM guinieu_events ORDER BY rowid DESC LIMIT 5').all();
    res.json({ success: true, data: { total, byType, latest } });
  } catch (err) {
    console.error('[Guinieu Stats Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
