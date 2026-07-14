/**
 * 龟钮印证 — B 端企业认证路由
 * 机构认证申请、审核、信息管理
 */

const express = require('express');
const router = express.Router();
const { userStore, paymentStore, walletStore } = require('../models/dataStore');
const glmClient = require('../glmClient');
const riskEngine = require('../riskEngine');
const QRCode = require('qrcode');

// 企业认证存储
class BizStore {
  constructor() {
    this._apps = new Map();   // Map<userId, application>
    this._bizs = new Map();   // Map<userId, businessInfo>
  }

  createApp(userId, info) {
    const app = {
      id: `biz_app_${userId}`,
      userId,
      companyName: info.companyName || '',
      creditCode: info.creditCode || '',  // 统一社会信用代码
      legalPerson: info.legalPerson || '',
      businessLicense: info.businessLicense || '', // 营业执照图片
      contactName: info.contactName || '',
      contactPhone: info.contactPhone || '',
      industry: info.industry || '',
      scale: info.scale || '',
      status: 'pending', // pending | approved | rejected
      rejectReason: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this._apps.set(userId, app);
    return app;
  }

  getApp(userId) {
    return this._apps.get(userId) || null;
  }

  listApps(status) {
    const apps = Array.from(this._apps.values());
    if (status) return apps.filter(a => a.status === status);
    return apps;
  }

  approve(userId) {
    const app = this._apps.get(userId);
    if (!app) return null;
    app.status = 'approved';
    app.updatedAt = new Date().toISOString();
    // 同步创建企业信息
    this._bizs.set(userId, {
      userId,
      companyName: app.companyName,
      creditCode: app.creditCode,
      legalPerson: app.legalPerson,
      industry: app.industry,
      scale: app.scale,
      creditRating: 'A',  // 默认 A 级
      annualTrade: 0,
      approvedAt: new Date().toISOString(),
    });
    // 更新用户角色
    const user = userStore.getById(userId);
    if (user) user.role = 'B';
    return app;
  }

  reject(userId, reason) {
    const app = this._apps.get(userId);
    if (!app) return null;
    app.status = 'rejected';
    app.rejectReason = reason || '';
    app.updatedAt = new Date().toISOString();
    return app;
  }

  getBiz(userId) {
    return this._bizs.get(userId) || null;
  }

  listBizs() {
    return Array.from(this._bizs.values());
  }
}

const bizStore = new BizStore();

// ==================== 企业认证 ====================

/** POST /api/biz/apply — 提交企业认证申请（AI 自动审核） */
router.post('/apply', async (req, res) => {
  const { userId, companyName, creditCode, legalPerson, contactName, contactPhone, industry, scale } = req.body;
  if (!userId) return res.status(400).json({ success: false, error: '缺少 userId' });
  if (!companyName) return res.status(400).json({ success: false, error: '缺少企业名称' });

  const existing = bizStore.getApp(userId);
  if (existing && existing.status === 'approved') {
    return res.json({ success: true, data: { message: '已认证通过', app: existing } });
  }

  const app = bizStore.createApp(userId, { companyName, creditCode, legalPerson, contactName, contactPhone, industry, scale });
  
  // AI 审核
  try {
    const aiResult = await reviewBizInfo({ companyName, creditCode, legalPerson, contactName, contactPhone, industry, scale });
    if (aiResult.approved) {
      const approved = bizStore.approve(userId);
      return res.json({ success: true, data: { message: 'AI 审核通过', app: approved, aiReview: aiResult } });
    } else {
      // 标记为待人工审核
      app.status = 'pending_review';
      app.aiReview = { reason: aiResult.reason, suggestions: aiResult.suggestions };
      app.updatedAt = new Date().toISOString();
      return res.json({ success: true, data: { message: 'AI 审核未通过，需人工复核', status: 'pending_review', app, aiReview: aiResult } });
    }
  } catch (e) {
    console.error('AI 审核异常:', e.message);
    // 兜底：直接通过
    const approved = bizStore.approve(userId);
    return res.json({ success: true, data: { message: '认证通过（AI 审核异常，已自动通过）', app: approved } });
  }
});

/** GET /api/biz/status — 查询认证状态 */
/** GET /api/biz/search — 搜索已认证企业 */
router.get('/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ success: true, data: null });
  const query = String(q).toLowerCase();
  const bizs = bizStore.listBizs();
  const matched = bizs.find(b =>
    b.companyName.toLowerCase().includes(query) ||
    b.userId.toLowerCase().includes(query)
  );
  if (matched) {
    res.json({ success: true, data: { userId: matched.userId, companyName: matched.companyName, creditRating: matched.creditRating, industry: matched.industry, scale: matched.scale } });
  } else {
    res.json({ success: true, data: null });
  }
});

router.get('/status', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ success: false, error: '缺少 userId' });

  const app = bizStore.getApp(userId);
  if (!app) {
    return res.json({ success: true, data: { status: 'none', message: '未提交认证' } });
  }

  res.json({ success: true, data: { status: app.status, app, biz: bizStore.getBiz(userId) } });
});

// ==================== B 端看板 ====================

/** GET /api/biz/dashboard — B 端看板数据 */
router.get('/dashboard', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ success: false, error: '缺少 userId' });

  const biz = bizStore.getBiz(userId);
  if (!biz) {
    return res.status(403).json({ success: false, error: '未认证企业，请先提交认证' });
  }

  // 钱包
  const wallet = walletStore.get(userId);

  // 交易统计
  const txsResult = paymentStore.list();
  const txs = Array.isArray(txsResult) ? txsResult : (txsResult.list || []);
  const bizTxs = txs.filter(tx => tx.payerId === userId || tx.payeeId === userId);
  const totalIncome = bizTxs.filter(tx => tx.payeeId === userId).reduce((s, t) => s + t.amount, 0);
  const totalExpense = bizTxs.filter(tx => tx.payerId === userId).reduce((s, t) => s + t.amount, 0);

  // B 端资费统计
  const bFeeTxs = bizTxs.filter(tx => tx.payerId === userId && tx.bFee);
  const totalBFee = bFeeTxs.reduce((s, t) => s + (t.bFee || 0), 0);

  // 数据产品（通过 dataMarketStore 查）
  let dataProducts = [];
  try {
    const dm = require('../models/dataStore').dataMarketStore;
    if (dm && dm.listProducts) {
      dataProducts = dm.listProducts().filter(p => p.sellerId === userId);
    }
  } catch (e) { /* ignore */ }

  res.json({
    success: true,
    data: {
      biz,
      wallet: {
        balance: wallet?.balance || 0,
        promotionBalance: wallet?.promotionBalance || 0,
        dataEarnings: wallet?.dataEarnings || 0,
        totalIncome: wallet?.totalIncome || 0,
        totalExpense: wallet?.totalExpense || 0,
      },
      stats: {
        totalTxs: bizTxs.length,
        totalIncome,
        totalExpense,
        totalBFee,
        dataProducts: dataProducts.length,
      },
      recentTxs: bizTxs.slice(-10).reverse().map(tx => ({
        id: tx.id,
        amount: tx.amount,
        bFee: tx.bFee || 0,
        subject: tx.subject || '通用支付',
        isIncome: tx.payeeId === userId,
        createdAt: tx.createdAt,
      })),
    },
  });
});


// ==================== 收款码管理 ====================

class QRCodeStore {
  constructor() {
    this._codes = new Map();
  }
  create(bizUserId, { type = 'fixed', amount = 0, subject = '', description = '', orderId = '', orderAmount = 0 }) {
    const codeId = 'qrcode_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const code = { id: codeId, bizUserId, type, amount: Number(amount) || 0, subject: subject || '扫码支付', description, orderId, orderAmount: Number(orderAmount) || 0, active: true, totalCollect: 0, totalCount: 0, createdAt: new Date().toISOString() };
    this._codes.set(codeId, code); return code;
  }
  getById(codeId) { return this._codes.get(codeId) || null; }
  listByUser(uid) { return Array.from(this._codes.values()).filter(c => c.bizUserId === uid); }
  toggleActive(codeId) { const c = this._codes.get(codeId); if (!c) return null; c.active = !c.active; c.updatedAt = new Date().toISOString(); return c; }
  recordCollect(codeId, amt) { const c = this._codes.get(codeId); if (!c) return; c.totalCollect += amt; c.totalCount += 1; c.updatedAt = new Date().toISOString(); }
}
const qrCodeStore = new QRCodeStore();

router.post('/qrcode/create', async (req, res) => {
  const { userId, type, amount, subject, description, orderId, orderAmount } = req.body;
  if (!userId) return res.status(400).json({ success: false, error: '缺少 userId' });
  if (!bizStore.getBiz(userId)) return res.status(403).json({ success: false, error: '未认证企业' });
  const code = qrCodeStore.create(userId, { type, amount, subject, description, orderId, orderAmount });
  
  // 生成二维码图片（base64 PNG）
  // 编码内容：codeId，客户端扫码后根据 codeId 调支付接口
  let qrDataUrl = '';
  try {
    const payUrl = JSON.stringify({ action: 'biz_qrcode_pay', codeId: code.id, bizUserId: userId });
    qrDataUrl = await QRCode.toDataURL(payUrl, { width: 256, margin: 2, color: { dark: '#000', light: '#fff' } });
  } catch (e) {
    console.error('二维码生成失败:', e.message);
  }
  
  res.json({ success: true, data: { code, qrDataUrl } });
});

router.get('/qrcode/list', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ success: false, error: '缺少 userId' });
  const codes = qrCodeStore.listByUser(userId);
  // 为每个码生成二维码图片
  const codesWithQR = await Promise.all(codes.map(async (c) => {
    if (c.qrDataUrl) return c;
    try {
      const payUrl = JSON.stringify({ action: 'biz_qrcode_pay', codeId: c.id, bizUserId: c.bizUserId });
      c.qrDataUrl = await QRCode.toDataURL(payUrl, { width: 256, margin: 2, color: { dark: '#000', light: '#fff' } });
    } catch (e) {}
    return c;
  }));
  res.json({ success: true, data: { codes: codesWithQR, total: codesWithQR.length } });
});

router.get('/qrcode/detail', (req, res) => {
  const { codeId } = req.query;
  if (!codeId) return res.status(400).json({ success: false, error: '缺少 codeId' });
  const code = qrCodeStore.getById(codeId);
  if (!code) return res.status(404).json({ success: false, error: '收款码不存在' });
  const biz = bizStore.getBiz(code.bizUserId);
  res.json({ success: true, data: { code, biz } });
});

router.post('/qrcode/toggle', (req, res) => {
  const { codeId } = req.body;
  const code = qrCodeStore.toggleActive(codeId);
  if (!code) return res.status(404).json({ success: false, error: '收款码不存在' });
  res.json({ success: true, data: { code } });
});

router.get('/qrcode/pay', (req, res) => {
  const { codeId, userId, amount } = req.query;
  if (!codeId || !userId) return res.status(400).json({ success: false, error: '缺少参数' });
  const code = qrCodeStore.getById(codeId);
  if (!code || !code.active) return res.status(404).json({ success: false, error: '收款码无效' });
  const payAmount = code.type === 'fixed' ? code.amount : (Number(amount) || 0);
  if (payAmount <= 0) return res.status(400).json({ success: false, error: '金额无效' });
  const pw = walletStore.get(userId);
  if (!pw || pw.balance < payAmount) return res.status(400).json({ success: false, error: '余额不足' });
  walletStore.deductBalance(userId, payAmount, '扫码支付');
  walletStore.addBalance(code.bizUserId, payAmount, '扫码收款');
  qrCodeStore.recordCollect(codeId, payAmount);
  const txId = 'scan_' + Date.now();
  paymentStore.create(txId, { id: txId, payerId: userId, payeeId: code.bizUserId, amount: payAmount, subject: code.subject, status: 'completed', createdAt: new Date().toISOString() });
  res.json({ success: true, data: { message: '支付成功', amount: payAmount } });
});

// ==================== 智能规则管理 ====================

class RuleStore {
  constructor() { this._rules = new Map(); }
  create(uid, { type, name, config }) {
    const rid = 'rule_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const r = { id: rid, bizUserId: uid, type, name, config, enabled: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this._rules.set(rid, r); return r;
  }
  getById(rid) { return this._rules.get(rid) || null; }
  listByUser(uid) { return Array.from(this._rules.values()).filter(r => r.bizUserId === uid); }
  update(rid, u) { const r = this._rules.get(rid); if (!r) return null; Object.assign(r, u); r.updatedAt = new Date().toISOString(); return r; }
  remove(rid) { return this._rules.delete(rid); }
  toggleEnabled(rid) { const r = this._rules.get(rid); if (!r) return null; r.enabled = !r.enabled; r.updatedAt = new Date().toISOString(); return r; }
}
const ruleStore = new RuleStore();

router.post('/rule/create', (req, res) => {
  const { userId, type, name, config } = req.body;
  if (!userId) return res.status(400).json({ success: false, error: '缺少 userId' });
  if (!bizStore.getBiz(userId)) return res.status(403).json({ success: false, error: '未认证企业' });
  const rule = ruleStore.create(userId, { type, name, config });
  res.json({ success: true, data: { rule } });
});

router.get('/rule/list', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ success: false, error: '缺少 userId' });
  const rules = ruleStore.listByUser(userId);
  res.json({ success: true, data: { rules, total: rules.length } });
});

router.post('/rule/update', (req, res) => {
  const { ruleId, name, config, enabled } = req.body;
  if (!ruleId) return res.status(400).json({ success: false, error: '缺少 ruleId' });
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (config !== undefined) updates.config = config;
  if (enabled !== undefined) updates.enabled = enabled;
  const rule = ruleStore.update(ruleId, updates);
  if (!rule) return res.status(404).json({ success: false, error: '规则不存在' });
  res.json({ success: true, data: { rule } });
});

router.post('/rule/toggle', (req, res) => {
  const { ruleId } = req.body;
  const rule = ruleStore.toggleEnabled(ruleId);
  if (!rule) return res.status(404).json({ success: false, error: '规则不存在' });
  res.json({ success: true, data: { rule } });
});

router.post('/rule/delete', (req, res) => {
  const { ruleId } = req.body;
  res.json({ success: true, data: { deleted: ruleStore.remove(ruleId) } });
});

router.get('/workbench', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ success: false, error: '缺少 userId' });
  if (!bizStore.getBiz(userId)) return res.status(403).json({ success: false, error: '未认证企业' });
  const codes = qrCodeStore.listByUser(userId);
  const rules = ruleStore.listByUser(userId);
  res.json({ success: true, data: {
    codes: { total: codes.length, active: codes.filter(c => c.active).length, totalCollect: codes.reduce((s, c) => s + c.totalCollect, 0) },
    rules: { total: rules.length, enabled: rules.filter(r => r.enabled).length }
  }});
});
// ==================== G 端审核接口 ====================

/** GET /api/biz/admin/apps — 查看所有认证申请（G 端） */
router.get('/admin/apps', (req, res) => {
  const { userId, status } = req.query;
  const user = userStore.getById(userId);
  if (!user || user.role !== 'G') {
    return res.status(403).json({ success: false, error: '仅 G 端可访问' });
  }

  const apps = bizStore.listApps(status || null);
  const data = apps.map(app => {
    const u = userStore.getById(app.userId);
    return { ...app, nickName: u?.nickName || '' };
  });

  res.json({ success: true, data: { list: data, total: data.length } });
});

/** POST /api/biz/admin/approve — 审核通过 */
router.post('/admin/approve', (req, res) => {
  const { userId: gUserId, targetUserId } = req.body;
  const gUser = userStore.getById(gUserId);
  if (!gUser || gUser.role !== 'G') {
    return res.status(403).json({ success: false, error: '仅 G 端可操作' });
  }

  const app = bizStore.approve(targetUserId);
  if (!app) return res.status(404).json({ success: false, error: '申请不存在' });

  res.json({ success: true, data: { message: '认证通过', app } });
});

/** POST /api/biz/admin/reject — 驳回 */
router.post('/admin/reject', (req, res) => {
  const { userId: gUserId, targetUserId, reason } = req.body;
  const gUser = userStore.getById(gUserId);
  if (!gUser || gUser.role !== 'G') {
    return res.status(403).json({ success: false, error: '仅 G 端可操作' });
  }

  const app = bizStore.reject(targetUserId, reason);
  if (!app) return res.status(404).json({ success: false, error: '申请不存在' });

  res.json({ success: true, data: { message: '已驳回', app } });
});

// ==================== AI 企业信息审核 ====================

/** 调用 GLM 审核企业认证信息 */
async function reviewBizInfo({ companyName, creditCode, legalPerson, contactName, contactPhone, industry, scale }) {
  const prompt = `你是一个企业认证审核助手。请审核以下企业信息，判断是否合理。

企业名称：${companyName}
统一社会信用代码：${creditCode || '未提供'}
法人代表：${legalPerson || '未提供'}
联系人：${contactName}
联系电话：${contactPhone}
所属行业：${industry}
企业规模：${scale}

审核要点：
1. 企业名称是否完整、合理
2. 信用代码格式（18位字母数字组合，非必填）
3. 法人代表姓名是否合理
4. 联系电话是否为合理手机号（11位数字）
5. 行业与规模是否匹配
6. 信息之间逻辑一致性

请返回 JSON 格式（不要 Markdown 标记）：
{
  "approved": true/false,
  "reason": "如果拒绝，说明具体问题；如果通过则为空",
  "suggestions": ["建议1", "建议2"]
}`;

  const res = await glmClient.chat([
    { role: 'system', content: '你是一个严格但公平的企业信息审核助手。只审核信息格式和逻辑合理性，不涉及业务判断。返回纯 JSON。' },
    { role: 'user', content: prompt }
  ]);

  const text = res.choices?.[0]?.message?.content || '';
  // 尝试提取 JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) { /* fall through */ }
  }
  // 兜底
  return { approved: true, reason: '', suggestions: [] };
}

// ==================== 交易明细筛选 ====================
router.get('/transactions', (req, res) => {
  const { userId, orderId, subject, dateFrom, dateTo, minAmount, maxAmount, status, page, pageSize } = req.query;
  if (!userId) return res.status(400).json({ success: false, error: 'userId' });
  let txs = paymentStore.getByUser(userId);
  if (orderId) txs = txs.filter(t => (t.subject||'').includes(orderId) || (t.description||'').includes(orderId) || (t.id||'').includes(orderId));
  if (subject) txs = txs.filter(t => (t.subject||'').includes(subject) || (t.description||'').includes(subject));
  if (dateFrom) txs = txs.filter(t => new Date(t.createdAt) >= new Date(dateFrom));
  if (dateTo) txs = txs.filter(t => new Date(t.createdAt) <= new Date(dateTo+'T23:59:59'));
  if (minAmount) txs = txs.filter(t => t.amount >= Number(minAmount));
  if (maxAmount) txs = txs.filter(t => t.amount <= Number(maxAmount));
  if (status) txs = txs.filter(t => t.status === status);
  const p = parseInt(page)||1, ps = parseInt(pageSize)||20;
  const list = txs.slice((p-1)*ps, p*ps);
  res.json({ success: true, data: { list, total: txs.length, page: p, pageSize: ps } });
});

// ==================== 退款记账 ====================
router.post('/refund', async (req, res) => {
  try {
    const { txId, userId, reason } = req.body;
    if (!txId||!userId) return res.status(400).json({ success: false, error: 'params' });
    const original = paymentStore.getById(txId);
    if (!original) return res.status(404).json({ success: false, error: '交易不存在' });
    if (original.status === 'refunded') return res.status(400).json({ success: false, error: '已退款' });
    if (original.status !== 'success') return res.status(400).json({ success: false, error: '仅成功交易可退款' });

    // ============ AI 智能退款审核 ============
    // 退款金额 >= 2000 时触发 LLM 审核
    const REFUND_AUDIT_THRESHOLD = 2000;
    let auditResult = null;
    let auditRequired = false;

    if (original.amount >= REFUND_AUDIT_THRESHOLD) {
      auditRequired = true;
      try {
        // 获取交易双方信息
        const payer = userStore.getById(original.payerId);
        const payee = userStore.getById(original.payeeId);
        const userTxs = paymentStore.getByUser(userId);
        const recentRefunds = userTxs.filter(t => t.channel === 'refund' && t.createdAt > Date.now() - 86400000 * 30);

        const prompt = `你是一个支付平台退款审核系统。请评估以下退款申请的风险：

交易信息：
- 交易ID：${txId}
- 金额：¥${original.amount}
- 主题：${original.subject || '通用支付'}
- 原交易时间：${original.createdAt || '未知'}

退款申请：
- 申请人：${userId}
- 退款理由：${reason || '未提供'}

交易双方：
- 付款方：${payer ? payer.nickName || payer.id : original.payerId}（角色：${payer ? payer.role : '未知'}）
- 收款方：${payee ? payee.nickName || payee.id : original.payeeId}（角色：${payee ? payee.role : '未知'}）

申请人近30天退款记录：${recentRefunds.length} 笔

请返回以下 JSON 格式（不要 Markdown）：
{
  "riskLevel": "low|medium|high",
  "score": 0-100,
  "reason": "风险评估理由",
  "suggestedAction": "auto_approve|require_review|block"
}`;

        const glmResult = await riskEngine.llmRiskAnalysis({
          amount: original.amount,
          userId: userId,
          recentTxs: userTxs.slice(-10),
        }, glmClient);

        // 如果 llmRiskAnalysis 返回了结果，直接使用
        if (glmResult && glmResult.riskLevel) {
          auditResult = glmResult;
        } else {
          // 否则用 GLM 直接调用退款审核 prompt
          const glmChat = await glmClient.chat([
            { role: 'user', content: prompt },
          ]);
          const text = glmChat.choices?.[0]?.message?.content || '';
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            auditResult = JSON.parse(jsonMatch[0]);
          }
        }
      } catch (e) {
        console.error('[Refund AI Audit Error]', e.message);
        // AI 审核异常时自动放行（兜底）
        auditResult = { riskLevel: 'low', score: 0, reason: 'AI 审核异常，自动放行', suggestedAction: 'auto_approve' };
      }

      // AI 审核决策
      if (auditResult && auditResult.suggestedAction === 'block') {
        return res.status(403).json({
          success: false,
          error: '退款申请被 AI 风控拦截',
          audit: auditResult,
        });
      }

      if (auditResult && auditResult.suggestedAction === 'require_review') {
        // 标记为待审核状态，存入退款审核表
        const pendingRefund = {
          id: 'pend_refund_' + Date.now(),
          txId,
          userId,
          reason: reason || '',
          amount: original.amount,
          audit: auditResult,
          status: 'pending_review',
          createdAt: new Date().toISOString(),
        };
        // 存到支付 store 的扩展数据中（或专门的数据结构）
        if (!paymentStore._pendingRefunds) paymentStore._pendingRefunds = new Map();
        paymentStore._pendingRefunds.set(pendingRefund.id, pendingRefund);
        return res.json({
          success: true,
          data: {
            pending: true,
            pendingRefundId: pendingRefund.id,
            message: '该退款需要人工审核，已提交至监管端',
            audit: auditResult,
          },
        });
      }
    }

    // ============ 执行退款 ============
    const refundId = 'refund_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
    const refundTx = {
      id: refundId, originalTxId: txId,
      userId: original.userId, payerId: original.payeeId, payeeId: original.payerId,
      amount: original.amount, subject: '退款: '+(original.subject||''), description: reason||'',
      channel: 'refund', status: 'success', hash: '',
      createdAt: new Date().toISOString(), paidAt: new Date().toISOString(),
    };
    paymentStore.create(refundId, refundTx);
    original.status = 'refunded';
    original.refundedAt = new Date().toISOString();
    if (original.payeeId) {
      const ded = walletStore.deductBalance(original.payeeId, original.amount, '退款: '+original.subject, refundId);
      if (!ded) process.stderr.write('退款扣款失败(余额不足?): '+original.payeeId+' '+original.amount+'\n');
    }
    if (original.payerId) {
      walletStore.addBalance(original.payerId, original.amount, '退款退回: '+original.subject, refundId);
    }
    return res.json({
      success: true,
      data: {
        refundId,
        amount: original.amount,
        originalTxId: txId,
        auditRequired,
        audit: auditResult,
      },
    });
  } catch (e) {
    process.stderr.write('退款失败: '+e.message+' '+e.stack+'\n');
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ==================== 支付链接生成 ====================
router.post('/paylink', (req, res) => {
  const { userId, amount, subject, orderId, description } = req.body;
  if (!userId||!amount) return res.status(400).json({ success: false, error: 'params' });
  const linkId = 'paylink_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
  const payUrl = { action: 'biz_paylink', linkId, bizUserId: userId, amount: Number(amount), subject: subject||'pay', orderId: orderId||'' };
  const link = '/pages/pay/index?data='+encodeURIComponent(JSON.stringify(payUrl));
  res.json({ success: true, data: { linkId, link, payUrl } });
});

// ==================== 开发演示数据注入 ====================
// 允许前端在 B 端企业中心一键注入演示数据（开发环境）
function injectDemoData(userId) {
  const { v4: uuid } = require('uuid');
  // 如果已认证，跳过
  let app = bizStore.getApp(userId);
  if (!app) {
    app = bizStore.createApp(userId, {
      companyName: '星辰科技',
      creditCode: '91440101MA5CXXXXXX',
      legalPerson: '王总',
      contactName: '李经理',
      contactPhone: '13800138000',
      industry: '科技',
      scale: '小型',
    });
    bizStore.approve(userId);
  }

  // 注入演示交易（如果还没有）
  const existing = paymentStore.getByUser(userId);
  if (existing.length === 0) {
    // 从外部用户付款给当前用户
    const payerId = 'demo_c_001';
    const tx1 = {
      id: 'pay_demo_' + Date.now() + '_1',
      userId: payerId, payerId, payeeId: userId,
      amount: 1500, subject: '活动报名费', description: '',
      channel: 'alipay', channelTradeNo: 'ali_demo_001',
      status: 'success', hash: '', createdAt: new Date().toISOString(),
      paidAt: new Date().toISOString(),
    };
    const tx2 = {
      id: 'pay_demo_' + Date.now() + '_2',
      userId: 'demo_c_002', payerId: 'demo_c_002', payeeId: userId,
      amount: 300, subject: '商品购买', description: '',
      channel: 'alipay', channelTradeNo: 'ali_demo_002',
      status: 'success', hash: '', createdAt: new Date().toISOString(),
      paidAt: new Date().toISOString(),
    };
    paymentStore.create(tx1.id, tx1);
    paymentStore.create(tx2.id, tx2);
    walletStore.addBalance(userId, 1500, '活动报名费', tx1.id);
    walletStore.addBalance(userId, 300, '商品购买', tx2.id);
  }
}

// POST /api/biz/dev-seed — 注入开发演示数据
router.post('/dev-seed', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ success: false, error: '缺少 userId' });
  injectDemoData(userId);
  const app = bizStore.getApp(userId);
  const biz = bizStore.getBiz(userId);
  res.json({ success: true, data: { status: 'approved', app, biz } });
});

module.exports = { router, bizStore };
