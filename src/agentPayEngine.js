/**
 * 龟钮印证 — Agent 微交易引擎 (L1)
 * 智能体自主支付：大模型风控授权 + 自动扣款 + 超额提醒
 */

const { v4: uuid } = require('uuid');
const glmClient = require('./glmClient');
const riskEngine = require('./riskEngine');

// 用户预设的 Agent 支付规则 (内存存储，后续可持久化)
class AgentPayRuleStore {
  constructor() {
    this._rules = new Map();     // userId -> rule
    this._approvals = new Map(); // pendingApprovalId -> record
  }

  /**
   * 设置用户的 Agent 支付规则
   */
  setRule(userId, rule) {
    const r = {
      userId,
      // 日限额
      dailyLimit: rule.dailyLimit || 500,        // 默认 ¥500/天
      // 单笔免审上限 (低于此金额直接放行)
      autoPassLimit: rule.autoPassLimit || 50,    // 默认 ¥50 以下免审
      // 单笔需要 LLM 审核的上限
      llmReviewLimit: rule.llmReviewLimit || 200, // 默认 ¥50-200 需 LLM 审核
      // 超过此金额需要用户确认
      userConfirmLimit: rule.userConfirmLimit || 500, // 默认 ¥500+ 需用户确认
      // 允许的收款方白名单 (空 = 不限制)
      allowedPayees: rule.allowedPayees || [],
      // 允许的交易类型
      allowedTypes: rule.allowedTypes || ['data_purchase', 'subscription', 'notary', 'charity'],
      // 禁止的交易类型
      blockedTypes: rule.blockedTypes || [],
      // 是否启用
      enabled: rule.enabled !== false,
      // 今日已用额度
      todayUsed: 0,
      // 规则更新时间
      updatedAt: new Date().toISOString(),
    };
    this._rules.set(userId, r);
    return r;
  }

  getRule(userId) {
    return this._rules.get(userId) || null;
  }

  /**
   * 重置日额度 (每日凌晨调用)
   */
  resetDailyLimits() {
    for (const rule of this._rules.values()) {
      rule.todayUsed = 0;
    }
  }

  /**
   * 记录待审批的超额请求
   */
  addPendingApproval(record) {
    const id = `aprv_${uuid().slice(0, 12)}`;
    const aprv = {
      id,
      ...record,
      status: 'pending',   // pending / approved / rejected / expired
      createdAt: new Date().toISOString(),
    };
    this._approvals.set(id, aprv);
    return aprv;
  }

  getPendingApproval(id) {
    return this._approvals.get(id) || null;
  }

  approve(id) {
    const a = this._approvals.get(id);
    if (!a || a.status !== 'pending') return null;
    a.status = 'approved';
    a.approvedAt = new Date().toISOString();
    return a;
  }

  reject(id) {
    const a = this._approvals.get(id);
    if (!a || a.status !== 'pending') return null;
    a.status = 'rejected';
    a.rejectedAt = new Date().toISOString();
    return a;
  }

  getPendingApprovals(userId) {
    return Array.from(this._approvals.values())
      .filter(a => a.userId === userId && a.status === 'pending')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getAllPendingApprovals() {
    return Array.from(this._approvals.values())
      .filter(a => a.status === 'pending')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}

// ==================== Agent 支付引擎 ====================

class AgentPayEngine {
  constructor() {
    this.ruleStore = new AgentPayRuleStore();
  }

  /**
   * Agent 支付决策流程
   * @param {object} ctx - 支付上下文
   * @param {string} ctx.userId - 用户 ID
   * @param {number} ctx.amount - 金额
   * @param {string} ctx.subject - 交易说明
   * @param {string} ctx.payeeId - 收款方
   * @param {string} ctx.type - 交易类型
   * @param {object[]} ctx.recentTxs - 近期交易
   * @returns {object} 决策结果
   */
  async decide(ctx) {
    const rule = this.ruleStore.getRule(ctx.userId);
    if (!rule || !rule.enabled) {
      return {
        decision: 'disabled',
        reason: 'Agent 支付未启用，请先在设置中开启',
        action: 'manual',  // 降级为人工支付
      };
    }

    // ===== 1. 白名单/黑名单检查 =====
    if (rule.allowedPayees.length > 0 && !rule.allowedPayees.includes(ctx.payeeId)) {
      return {
        decision: 'blocked',
        reason: `收款方 ${ctx.payeeId} 不在允许的白名单中`,
        action: 'reject',
      };
    }

    if (rule.blockedTypes.includes(ctx.type)) {
      return {
        decision: 'blocked',
        reason: `交易类型 ${ctx.type} 已被禁用`,
        action: 'reject',
      };
    }

    if (!rule.allowedTypes.includes(ctx.type)) {
      return {
        decision: 'blocked',
        reason: `交易类型 ${ctx.type} 不在允许范围内`,
        action: 'reject',
      };
    }

    // ===== 2. 计算今日剩余额度 =====
    const todayRemaining = rule.dailyLimit - rule.todayUsed;

    if (todayRemaining <= 0) {
      const pending = this.ruleStore.addPendingApproval({
        userId: ctx.userId,
        amount: ctx.amount,
        subject: ctx.subject,
        payeeId: ctx.payeeId,
        type: ctx.type,
        reason: '日限额已用完',
        dailyLimit: rule.dailyLimit,
        todayUsed: rule.todayUsed,
      });
      return {
        decision: 'over_limit',
        reason: `今日额度已用完 (已用 ¥${rule.todayUsed} / 限额 ¥${rule.dailyLimit})，已发送审批请求`,
        action: 'pending_approval',
        approvalId: pending.id,
        pendingApproval: pending,
      };
    }

    if (ctx.amount > todayRemaining) {
      const pending = this.ruleStore.addPendingApproval({
        userId: ctx.userId,
        amount: ctx.amount,
        subject: ctx.subject,
        payeeId: ctx.payeeId,
        type: ctx.type,
        reason: '单笔超额度',
        dailyLimit: rule.dailyLimit,
        todayUsed: rule.todayUsed,
        todayRemaining,
      });
      return {
        decision: 'over_limit',
        reason: `单笔 ¥${ctx.amount} 超过今日剩余额度 ¥${todayRemaining.toFixed(2)}，已发送审批请求`,
        action: 'pending_approval',
        approvalId: pending.id,
        pendingApproval: pending,
      };
    }

    // ===== 3. 小额免审 (自动通过) =====
    if (ctx.amount <= rule.autoPassLimit) {
      return {
        decision: 'auto_pass',
        reason: `小额交易 ¥${ctx.amount}，自动通过`,
        action: 'proceed',
      };
    }

    // ===== 4. LLM 风控审核 (中等金额) =====
    if (ctx.amount <= rule.llmReviewLimit) {
      try {
        const llmResult = await this._llmReview(ctx);
        if (llmResult.decision === 'approve') {
          return {
            decision: 'llm_approved',
            reason: llmResult.reason || 'LLM 风控审核通过',
            action: 'proceed',
            llmAnalysis: llmResult,
          };
        } else if (llmResult.decision === 'reject') {
          return {
            decision: 'llm_rejected',
            reason: llmResult.reason || 'LLM 风控审核未通过',
            action: 'reject',
            llmAnalysis: llmResult,
          };
        } else {
          // LLM 建议人工审核
          const pending = this.ruleStore.addPendingApproval({
            userId: ctx.userId,
            amount: ctx.amount,
            subject: ctx.subject,
            payeeId: ctx.payeeId,
            type: ctx.type,
            reason: llmResult.reason || 'LLM 建议人工审核',
            llmAnalysis: llmResult,
          });
          return {
            decision: 'llm_review',
            reason: llmResult.reason || '需人工确认',
            action: 'pending_approval',
            approvalId: pending.id,
            pendingApproval: pending,
            llmAnalysis: llmResult,
          };
        }
      } catch (err) {
        console.error('[AgentPay] LLM 审核失败:', err.message);
        // LLM 不可用时降级为本地规则
        return this._fallbackRules(ctx);
      }
    }

    // ===== 5. 大额交易：需用户确认 =====
    const pending = this.ruleStore.addPendingApproval({
      userId: ctx.userId,
      amount: ctx.amount,
      subject: ctx.subject,
      payeeId: ctx.payeeId,
      type: ctx.type,
      reason: `大额交易 ¥${ctx.amount}，需用户确认`,
      userConfirmLimit: rule.userConfirmLimit,
    });
    return {
      decision: 'user_confirm_required',
      reason: `大额交易 ¥${ctx.amount}（超过 ¥${rule.userConfirmLimit}），需用户确认`,
      action: 'pending_approval',
      approvalId: pending.id,
      pendingApproval: pending,
    };
  }

  /**
   * LLM 风控审核
   */
  async _llmReview(ctx) {
    const prompt = `你是一个支付风控审核助手。请审核以下 Agent 自主支付请求：

交易信息：
- 金额：¥${ctx.amount}
- 说明：${ctx.subject}
- 收款方ID：${ctx.payeeId}
- 交易类型：${ctx.type}
- 用户ID：${ctx.userId}
- 近期交易笔数：${ctx.recentTxs?.length || 0}

请分析是否存在风险，并输出 JSON 格式的审核结果：

{
  "decision": "approve" | "reject" | "review",
  "reason": "审核理由（简短）",
  "riskLevel": "low" | "medium" | "high",
  "riskFactors": ["风险因素1", "风险因素2"],
  "suggestion": "建议"
}`;

    const response = await glmClient.chat([
      { role: 'system', content: '你是一个严谨的支付风控审核助手。请基于交易上下文做出合理判断。小额常规交易倾向通过，异常交易需谨慎。' },
      { role: 'user', content: prompt },
    ]);

    let result;
    try {
      const content = response.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('[AgentPay] LLM 响应解析失败:', e.message);
    }

    return result || {
      decision: 'review',
      reason: 'LLM 分析异常，降级为人工审核',
      riskLevel: 'medium',
    };
  }

  /**
   * LLM 不可用时的本地规则降级
   */
  _fallbackRules(ctx) {
    // 用本地风控引擎判定
    const localResult = riskEngine.assessPaymentRisk(ctx);

    if (localResult.decision === 'block') {
      return {
        decision: 'local_blocked',
        reason: '本地规则拦截',
        action: 'reject',
        localAnalysis: localResult,
      };
    }

    if (localResult.decision === 'review' || ctx.amount > 100) {
      const pending = this.ruleStore.addPendingApproval({
        userId: ctx.userId,
        amount: ctx.amount,
        subject: ctx.subject,
        payeeId: ctx.payeeId,
        type: ctx.type,
        reason: 'LLM 不可用，本地规则建议人工审核',
        localAnalysis: localResult,
      });
      return {
        decision: 'fallback_review',
        reason: 'LLM 不可用，需人工确认',
        action: 'pending_approval',
        approvalId: pending.id,
        pendingApproval: pending,
        localAnalysis: localResult,
      };
    }

    return {
      decision: 'local_pass',
      reason: '本地规则通过（LLM 不可用）',
      action: 'proceed',
      localAnalysis: localResult,
    };
  }

  /**
   * 执行 Agent 支付（自动扣款 + 存证）
   */
  async executePay(ctx, paymentStore, walletStore, hashStore, hashEngine) {
    // 创建支付记录
    const payment = paymentStore.create({
      userId: ctx.userId,
      amount: ctx.amount,
      subject: ctx.subject,
      payerId: ctx.userId,
      payeeId: ctx.payeeId,
      channel: 'agent',
    });

    // HASH 存证
    const nonce = uuid().slice(0, 8);
    const { hash, digest } = hashEngine.digest({
      id: payment.id,
      amount: ctx.amount,
      subject: ctx.subject,
      payerId: ctx.userId,
      payeeId: ctx.payeeId,
      createdAt: payment.createdAt,
    }, nonce);

    paymentStore.update(payment.id, { hash, nonce });

    hashStore.create({
      txId: payment.id,
      hash,
      dataDigest: digest,
      dataType: 'agent_payment',
      metadata: { subject: ctx.subject, amount: ctx.amount, type: ctx.type },
    });

    // 自动扣款
    paymentStore.confirmSuccess(payment.id, `agent_${Date.now()}`);
    walletStore.deductBalance(ctx.userId, ctx.amount, `Agent 支付: ${ctx.subject}`, payment.id);
    walletStore.addBalance(ctx.payeeId, ctx.amount, `Agent 收款: ${ctx.subject}`, payment.id);

    // 更新日额度
    const rule = this.ruleStore.getRule(ctx.userId);
    if (rule) {
      rule.todayUsed += ctx.amount;
    }

    return payment;
  }

  /**
   * 获取用户 Agent 支付统计
   */
  getStats(userId) {
    const rule = this.ruleStore.getRule(userId);
    if (!rule) return null;
    return {
      enabled: rule.enabled,
      dailyLimit: rule.dailyLimit,
      todayUsed: rule.todayUsed,
      todayRemaining: Math.max(0, rule.dailyLimit - rule.todayUsed),
      autoPassLimit: rule.autoPassLimit,
      llmReviewLimit: rule.llmReviewLimit,
      userConfirmLimit: rule.userConfirmLimit,
      allowedTypes: rule.allowedTypes,
      allowedPayees: rule.allowedPayees,
    };
  }
}

module.exports = {
  AgentPayEngine,
  AgentPayRuleStore,
};