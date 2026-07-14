/**
 * 龟钮印证 — AI 交易摘要
 * 定期生成用户交易摘要，分析消费模式、趋势和异常
 */

const glmClient = require('./glmClient');

class TransactionSummary {
  constructor() {
    this._cache = new Map(); // userId -> { date, summary }
  }

  /**
   * 生成用户交易摘要（自然语言）
   * @param {string} userId
   * @param {Array} txs - 交易列表
   * @param {Object} wallet - 钱包信息
   * @param {Object} user - 用户信息
   * @returns {Promise<Object>} { summary, highlights, tips, anomaly }
   */
  async generate(userId, txs, wallet, user) {
    const today = new Date().toISOString().slice(0, 10);
    const cached = this._cache.get(userId);
    // 缓存 1 小时内有效
    if (cached && cached.date === today) {
      const age = Date.now() - cached.ts;
      if (age < 3600000) return cached.summary;
    }

    // 按时间分组
    const successTxs = txs.filter(t => t.status === 'success');
    const recentTxs = successTxs.slice(-20).reverse();

    // 统计
    const totalOut = successTxs.reduce((s, t) => s + (t.amount || 0), 0);
    const totalIn = successTxs.filter(t => t.payeeId === userId)
      .reduce((s, t) => s + (t.amount || 0), 0);
    const avgAmount = successTxs.length > 0
      ? Math.round(totalOut / successTxs.length * 100) / 100 : 0;
    const categories = [...new Set(successTxs.map(t => t.subject || '通用'))];
    const maxTx = successTxs.reduce((m, t) => (t.amount || 0) > (m.amount || 0) ? t : m, { amount: 0 });

    const prompt = `你是一个交易分析助手。请分析以下用户的交易数据，生成一段简洁的摘要（50-80字）。

用户信息：
- 昵称：${user?.nickName || '用户'}
- 角色：${user?.role === 'C' ? '个人' : user?.role === 'B' ? '机构' : '未知'}
- 钱包余额：¥${wallet?.balance || 0}
- 数据收益：¥${wallet?.dataEarnings || 0}

交易统计：
- 总交易笔数：${successTxs.length}
- 总支出：¥${totalOut.toFixed(2)}
- 总收入：¥${totalIn.toFixed(2)}
- 平均单笔：¥${avgAmount.toFixed(2)}
- 交易品类：${categories.slice(0, 5).join('、')}
- 最大单笔：¥${(maxTx.amount || 0).toFixed(2)}（${maxTx.subject || '通用'}）

最近交易（最多显示5笔）：
${recentTxs.slice(0, 5).map(t => `- ¥${t.amount} ${t.subject || '通用'} ${t.createdAt?.slice(0, 10) || ''}`).join('\n')}

请返回以下 JSON 格式（不要 Markdown）：
{
  "summary": "一句话总结用户的交易状况（50-80字）",
  "highlights": ["亮点1", "亮点2"],
  "tips": ["建议1", "建议2"],
  "anomaly": null
}

如果没有异常，anomaly 为 null。如果有异常（如大额支出、频繁交易），描述异常。`;

    try {
      const result = await glmClient.chat([
        { role: 'user', content: prompt },
      ]);
      const text = result.choices?.[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const summary = JSON.parse(jsonMatch[0]);
        this._cache.set(userId, {
          date: today,
          ts: Date.now(),
          summary,
        });
        return summary;
      }
    } catch (e) {
      console.error('[TransactionSummary] Error:', e.message);
    }

    return null;
  }

  /**
   * GET /api/ai/summary — 获取用户交易摘要
   */
  async getSummary(userId, paymentStore, userStore, walletStore) {
    if (!userId) return { success: false, error: 'userId required' };
    const user = userStore.getById(userId);
    const txs = paymentStore.getByUser(userId);
    const wallet = walletStore.get(userId);
    const summary = await this.generate(userId, txs, wallet, user);
    return { success: true, data: { summary, txCount: txs.length } };
  }
}

module.exports = { TransactionSummary };