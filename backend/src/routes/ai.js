/**
 * 龟钮印证 — AI 智能客服路由
 * 基于 GLM 大模型回答平台使用、交易查询、规则解释等问题
 */

const express = require('express');
const router = express.Router();
const glmClient = require('../glmClient');
const { userStore, paymentStore, walletStore } = require('../models/dataStore');
const { TransactionSummary } = require('../transactionSummary');

const txnSummary = new TransactionSummary();

/**
 * POST /api/ai/chat — AI 客服对话
 * body: { userId, message, context? }
 */
router.post('/chat', async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, error: '请输入问题' });
    }

    // 获取用户上下文（用于回答个性化问题）
    let userContext = {};
    if (userId) {
      const user = userStore.getById(userId);
      if (user) {
        const txs = paymentStore.getByUser(userId);
        const wallet = walletStore.get(userId);
        userContext = {
          nickName: user.nickName,
          role: user.role,
          roleLabel: user.role === 'C' ? '个人用户' : user.role === 'B' ? '机构用户' : user.role === 'G' ? '政府用户' : '未知',
          txCount: txs.length,
          totalAmount: txs.reduce((s, t) => s + (t.amount || 0), 0),
          balance: wallet?.balance || 0,
          dataEarnings: wallet?.dataEarnings || 0,
          promotionBalance: wallet?.promotionBalance || 0,
        };
      }
    }

    const systemPrompt = `你是一个支付平台「龟钮印证」的智能客服助手。平台定位是 L0 结算公益壳，支付数据与支付系统隔离的保密支付平台。

平台核心功能：
1. 支付 — 个人/机构间转账支付，支持多种通道
2. 收款 — 生成个人收款码，扫码支付
3. 账单 — 查看交易流水和记录
4. 数据市场 — BC 端授权数据 → 脱敏后 G 端购买 → BC 分佣 50%
5. 公证 — 可选在线公证服务（15% 服务费）
6. Agent 支付 — AI 智能体发起的微交易
7. B 端企业中心 — 机构认证、收款码管理、智能规则
8. G 端监管看板 — 交易审计、企业监管、风险预警
9. 钱包 — 余额管理、数据收益、推广收益

定价规则：
- C 端个人用户：全免费
- B 端机构用户：单笔 ≤2000 免费，>2000 银行标准费率 0.38%（封顶 20 元）
- G 端政府用户：数据购买方

${userContext.userId ? `当前用户：${userContext.nickName || '未登录'}（${userContext.roleLabel}）
交易统计：${userContext.txCount} 笔，总额 ¥${userContext.totalAmount}
钱包余额：¥${userContext.balance}
数据收益：¥${userContext.dataEarnings}
推广收益：¥${userContext.promotionBalance}` : '用户未登录，可回答通用问题。'}

回答要求：
- 简洁、准确、友好
- 涉及金额的数据给出精确数字
- 不确定的功能说"暂未支持"
- 涉及用户隐私的问题引导到安全设置页面
- 纯文本回复，不要 Markdown 格式
- 直接回答问题，不要前缀`;

    const result = await glmClient.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ]);

    const reply = result.choices?.[0]?.message?.content || '抱歉，我暂时无法回答这个问题，请稍后再试。';

    res.json({ success: true, data: { reply } });
  } catch (err) {
    console.error('[AI Chat Error]', err);
    res.status(500).json({ success: false, error: 'AI 服务异常，请稍后再试' });
  }
});

/**
 * POST /api/ai/trade-query — AI 交易查询（自然语言）
 * body: { userId, query }
 */
router.post('/trade-query', async (req, res) => {
  try {
    const { userId, query } = req.body;
    if (!userId || !query) {
      return res.status(400).json({ success: false, error: '缺少参数' });
    }

    const txs = paymentStore.getByUser(userId);
    const recentTxs = txs.slice(-20).reverse().map(t => ({
      id: t.id,
      amount: t.amount,
      subject: t.subject,
      status: t.status,
      time: t.createdAt,
      isIncome: t.payeeId === userId,
    }));

    const result = await glmClient.chat([
      { role: 'system', content: '你是交易查询助手。根据用户提问和交易数据，返回最相关的 1-3 笔交易信息。直接回答问题，不要 JSON 格式。用户共有 ' + txs.length + ' 笔交易。' },
      { role: 'user', content: `用户提问：${query}\n\n最近交易：${JSON.stringify(recentTxs.slice(0, 10))}` },
    ]);

    const reply = result.choices?.[0]?.message?.content || '未找到相关交易';

    res.json({ success: true, data: { reply, matchedTxs: recentTxs.slice(0, 3) } });
  } catch (err) {
    console.error('[AI Trade Query Error]', err);
    res.status(500).json({ success: false, error: '查询服务异常' });
  }
});

/**
 * POST /api/ai/voice-command — 语音指令解析
 * body: { text }
 * 解析自然语言语音指令，返回意图和参数
 */
router.post('/voice-command', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, error: '缺少语音文本' });
    }

    const result = await glmClient.chat([
      {
        role: 'system',
        content: '你是一个语音指令解析器。将用户的自然语言语音指令解析为结构化的意图和参数。\n\n支持的意图:\n- pay: 付款/转账（参数: payeeName 收款人, amount 金额, subject 备注）\n- search: 搜索/查询/账单\n- collect: 收款\n- biz: 企业中心/企业\n- chat: 客服/咨询/帮助\n\n返回格式: 只有 JSON 对象，不要其他文字。\n格式: {"intent":"pay","params":{"payeeName":"张三","amount":"50"}}\n如果无法识别，返回: {"intent":"unknown"}'
      },
      { role: 'user', content: text },
    ]);

    const reply = result.choices?.[0]?.message?.content || '{"intent":"unknown"}';
    let cmd;
    try {
      cmd = JSON.parse(reply);
    } catch {
      cmd = { intent: 'unknown' };
    }

    res.json({ success: true, data: cmd });
  } catch (err) {
    console.error('[Voice Command Error]', err);
    res.status(500).json({ success: false, data: { intent: 'unknown' } });
  }
});

/**
 * GET /api/ai/summary — 获取用户交易摘要
 */
router.get('/summary', async (req, res) => {
  try {
    const { userId } = req.query;
    const result = await txnSummary.getSummary(userId, paymentStore, userStore, walletStore);
    res.json(result);
  } catch (err) {
    console.error('[AI Summary Error]', err);
    res.status(500).json({ success: false, error: '摘要服务异常' });
  }
});

module.exports = router;