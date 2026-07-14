/**
 * 龟钮印证 — AI 风控引擎 (L1)
 * 支付行为风险鉴定 + 消费行为公益提醒
 */

class RiskEngine {
  constructor() {
    // 风险规则 (v0.1 本地规则，后续接入大模型)
    this.RULES = {
      // 高频小额检测 (疑似套现)
      highFrequencySmallAmount: {
        threshold: 5,         // 5 笔以上
        windowMinutes: 30,    // 30分钟内
        riskLevel: 'medium',
      },
      // 大额交易预警
      largeAmount: {
        threshold: 50000,     // ¥50,000
        riskLevel: 'medium',
      },
      // 夜间交易 (23:00-06:00)
      nightTrade: {
        riskLevel: 'low',
      },
    };
  }

  /**
   * 支付风险鉴定
   * @param {object} context - 交易上下文
   * @param {number} context.amount
   * @param {string} context.userId
   * @param {string} context.payeeId
   * @param {object[]} context.recentTxs - 近期交易
   * @returns {object} 风险评估结果
   */
  assessPaymentRisk(context) {
    const risks = [];
    let score = 0;

    // 1. 大额交易
    if (context.amount >= this.RULES.largeAmount.threshold) {
      risks.push({
        type: 'large_amount',
        level: this.RULES.largeAmount.riskLevel,
        message: `大额交易 ¥${context.amount}，请注意资金安全`,
      });
      score += 30;
    }

    // 2. 高频检测
    if (context.recentTxs && context.recentTxs.length >= this.RULES.highFrequencySmallAmount.threshold) {
      risks.push({
        type: 'high_frequency',
        level: this.RULES.highFrequencySmallAmount.riskLevel,
        message: `近期交易频繁 (${context.recentTxs.length}笔)，请注意异常操作`,
      });
      score += 40;
    }

    // 3. 夜间交易
    const hour = new Date().getHours();
    if (hour >= 23 || hour < 6) {
      risks.push({
        type: 'night_trade',
        level: this.RULES.nightTrade.riskLevel,
        message: '当前为夜间交易时段，请确认操作安全',
      });
      score += 10;
    }

    // 综合判定
    const decision = score >= 50 ? 'block' : (score >= 20 ? 'review' : 'pass');

    return {
      decision,
      score,
      risks,
      passed: decision === 'pass',
    };
  }

  /**
   * 消费行为公益提醒
   * @param {object} profile - 用户消费画像
   * @param {string} profile.category - 消费品类
   * @param {number} profile.monthlyTotal - 月累计消费
   * @param {number} profile.threshold - 健康阈值
   * @returns {object} 提醒内容
   */
  consumptionAlert(profile) {
    const alerts = [];

    // 烟酒类消费提醒
    if (profile.category === 'tobacco' || profile.category === 'alcohol') {
      if (profile.monthlyTotal > profile.threshold) {
        alerts.push({
          type: 'health_alert',
          category: profile.category,
          level: 'warning',
          title: profile.category === 'tobacco' ? '🚬 吸烟消费提醒' : '🍺 饮酒消费提醒',
          message: `本月${profile.category === 'tobacco' ? '烟草' : '酒类'}消费 ¥${profile.monthlyTotal}，已超过健康建议阈值 ¥${profile.threshold}`,
          suggestion: '请注意控制消费，关注身体健康。如需帮助可联系公益咨询服务。',
        });
      }
    }

    // 高频率同类消费提醒
    if (profile.frequency && profile.frequency > 20) {
      alerts.push({
        type: 'frequency_alert',
        level: 'info',
        title: '📊 消费频率提醒',
        message: `本月同类消费 ${profile.frequency} 次，消费频率较高`,
        suggestion: '建议关注消费习惯，合理规划支出。',
      });
    }

    return alerts;
  }

  /**
   * 大模型风控分析 (预留接口)
   * 后续接入 GLM / DeepSeek 等大模型进行深度分析
   */
  async llmRiskAnalysis(context, glmClient) {
    if (!glmClient) return null;

    const prompt = `你是一个支付风控分析助手。请分析以下交易是否存在风险：

交易信息：
- 金额：¥${context.amount}
- 用户ID：${context.userId}
- 收款方：${context.payeeId}
- 近期交易笔数：${context.recentTxs?.length || 0}

请判断：
1. 是否存在欺诈风险？
2. 是否存在洗钱特征？
3. 是否存在异常行为？

输出格式：
{
  "riskLevel": "low/medium/high",
  "reason": "分析理由",
  "suggestion": "建议操作"
}`;

    try {
      const result = await glmClient.chat([
        { role: 'user', content: prompt },
      ]);
      // 解析返回的 JSON（OpenAI 兼容格式）
      const text = result.choices?.[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return null;
    } catch (err) {
      console.error('[RiskEngine] LLM analysis failed:', err.message);
      return null;
    }
  }
}

module.exports = new RiskEngine();