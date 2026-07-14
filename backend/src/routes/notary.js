const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const glmClient = require('../glmClient');
const { paymentStore } = require('../models/dataStore');

// 简化：公证服务商配置
const NOTARY_PROVIDERS = [
  { id: 'notary_cloud', name: '公证云', baseUrl: 'https://api.notarycloud.com', feeRate: 0.15 },
  { id: 'fadada', name: '法大大', baseUrl: 'https://api.fadada.com', feeRate: 0.15 },
];

// 内存存储 (后续移入 dataStore)
const notaryRecords = new Map();

// 导出以便 payment 路由自动写入存证记录
module.exports._records = notaryRecords;

// GET /api/notary/providers — 获取公证服务商列表
router.get('/providers', (req, res) => {
  res.json({ success: true, data: NOTARY_PROVIDERS });
});

// POST /api/notary/apply — 申请公证（AI 智能审核）
router.post('/apply', async (req, res) => {
  const { txId, providerId, userId, amount } = req.body;
  if (!txId || !providerId) {
    return res.status(400).json({ success: false, error: 'txId and providerId required' });
  }

  const provider = NOTARY_PROVIDERS.find(p => p.id === providerId);
  if (!provider) {
    return res.status(400).json({ success: false, error: '公证服务商不存在' });
  }

  // ============ AI 智能审核 ============
  let auditResult = null;
  try {
    const originalTx = paymentStore.getById(txId);

    const prompt = `你是一个公证审核系统。请评估以下公证申请：

交易信息：
- 交易ID：${txId}
- 金额：¥${amount || '未知'}
- 状态：${originalTx?.status || '未知'}
- 主题：${originalTx?.subject || '未知'}
- 时间：${originalTx?.createdAt || '未知'}
${originalTx?.payerId ? `- 付款方：${originalTx.payerId}` : ''}
${originalTx?.payeeId ? `- 收款方：${originalTx.payeeId}` : ''}

公证申请：
- 服务商：${provider.name}（费率 ${provider.feeRate * 100}%）
- 公证费：¥${Math.round((amount || 0) * provider.feeRate * 100) / 100}

请评估：
1. 交易金额是否合理
2. 交易双方是否正常
3. 是否有必要公证
4. 是否存在可疑风险

请返回以下 JSON 格式（不要 Markdown）：
{
  "riskLevel": "low|medium|high",
  "reason": "审核理由（20-50字）",
  "suggestedAction": "approve|review|reject",
  "isRecommended": true/false,
  "recommendation": "建议说明"
}`;

    const result = await glmClient.chat([
      { role: 'user', content: prompt },
    ]);
    const text = result.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      auditResult = JSON.parse(jsonMatch[0]);

      if (auditResult.suggestedAction === 'reject') {
        return res.status(403).json({
          success: false,
          error: '公证申请未通过 AI 审核',
          audit: auditResult,
        });
      }

      if (auditResult.suggestedAction === 'review') {
        const id = 'pend_notary_' + uuid().slice(0, 8);
        const record = {
          id,
          txId,
          userId,
          providerId,
          providerName: provider.name,
          notaryFee: Math.round((amount || 0) * provider.feeRate * 100) / 100,
          status: 'pending_review',
          audit: auditResult,
          createdAt: new Date().toISOString(),
        };
        notaryRecords.set(id, record);
        return res.json({
          success: true,
          data: {
            ...record,
            pending: true,
            message: '公证申请已提交审核，等待监管端确认',
            audit: auditResult,
          },
        });
      }
    }
  } catch (e) {
    console.error('[Notary AI Audit Error]', e.message);
  }

  // 计算公证费 = 交易额 × 15%
  const notaryFee = Math.round((amount || 0) * provider.feeRate * 100) / 100;
  const id = `notary_${uuid().slice(0, 12)}`;

  const record = {
    id,
    txId,
    userId,
    providerId,
    providerName: provider.name,
    notaryFee,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  notaryRecords.set(id, record);

  res.json({
    success: true,
    data: {
      ...record,
      // 公证服务费说明
      feeBreakdown: {
        transactionAmount: amount,
        feeRate: provider.feeRate,
        notaryFee,
      },
    },
  });
});

// POST /api/notary/confirm — 确认公证完成
router.post('/confirm', (req, res) => {
  const { id, certificateNo } = req.body;
  if (!id) {
    return res.status(400).json({ success: false, error: 'id required' });
  }
  const record = notaryRecords.get(id);
  if (!record) {
    return res.status(404).json({ success: false, error: '公证记录不存在' });
  }
  record.status = 'completed';
  record.certificateNo = certificateNo || `cert_${uuid().slice(0, 12)}`;
  record.completedAt = new Date().toISOString();
  res.json({ success: true, data: record });
});

// GET /api/notary/query — 查询公证状态
router.get('/query', (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ success: false, error: 'id required' });
  }
  const record = notaryRecords.get(id);
  if (!record) {
    return res.status(404).json({ success: false, error: '公证记录不存在' });
  }
  res.json({ success: true, data: record });
});

module.exports = router;