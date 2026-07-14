/**
 * 龟钮印证 — 标签引擎 (Tag Engine)
 * 为 C 端 / B 端用户打标签，为数据产品打标签
 * 标签用于：数据脱敏销售、风控决策、用户画像、G 端监管统计
 *
 * 标签类型:
 *   user_tag    — 用户标签（C/B 端）
 *   data_tag    — 数据产品标签
 *   auto_tag    — 系统自动生成的标签（LLM 或规则生成）
 */

class TagEngine {
  constructor() {
    // 标签存储: Map<targetId, Tag[]>
    this._tags = new Map();
    // 标签分类定义
    this._categories = {
      // C 端标签
      user_c: [
        { id: 'c_activity', label: '活跃度', type: 'enum', values: ['高', '中', '低'] },
        { id: 'c_identity', label: '身份特征', type: 'enum', values: ['学生', '上班族', '自由职业', '退休'] },
        { id: 'c_consume_level', label: '消费力', type: 'enum', values: ['高', '中', '低'] },
        { id: 'c_region', label: '地域', type: 'enum', values: ['一线', '二线', '三线', '四线及以下'] },
        { id: 'c_data_quality', label: '数据质量', type: 'enum', values: ['高质量', '中等', '低质量'] },
        { id: 'c_consent_scope', label: '授权范围', type: 'enum', values: ['全部数据', '仅支付', '仅存证'] },
        { id: 'c_trust_score', label: '信用分', type: 'range', min: 0, max: 100 },
        { id: 'c_risk_level', label: '风险等级', type: 'enum', values: ['低风险', '中风险', '高风险', '极高风险'] },
        { id: 'c_agent_depth', label: 'Agent使用深度', type: 'enum', values: ['未使用', '基础使用', '中度使用', '重度使用'] },
      ],
      // B 端标签
      user_b: [
        { id: 'b_industry', label: '行业', type: 'enum', values: ['金融', '零售', '科技', '制造', '政务', '医疗', '教育', '其他'] },
        { id: 'b_scale', label: '规模', type: 'enum', values: ['微型', '小型', '中型', '大型'] },
        { id: 'b_credit_rating', label: '信用评级', type: 'enum', values: ['AAA', 'AA', 'A', 'B', 'C'] },
        { id: 'b_annual_trade', label: '年交易额', type: 'range', min: 0, max: 99999999 },
        { id: 'b_data_demand', label: '数据需求类型', type: 'multi_enum', values: ['支付数据', '消费行为', '信用评分', '区域统计', '行业报告'] },
        { id: 'b_api_activity', label: 'API调用活跃度', type: 'enum', values: ['高频', '中频', '低频', '未调用'] },
      ],
      // 数据产品标签
      data: [
        { id: 'd_type', label: '数据类型', type: 'enum', values: ['支付数据', '消费行为', '信用评分', '区域统计', '行业报告', '公证存证'] },
        { id: 'd_sensitivity', label: '敏感级别', type: 'enum', values: ['脱敏公开', '授权可查', '严格管控'] },
        { id: 'd_quality', label: '数据质量', type: 'enum', values: ['A级', 'B级', 'C级'] },
        { id: 'd_freshness', label: '时效性', type: 'enum', values: ['实时', '日更新', '周更新', '月更新', '历史'] },
        { id: 'd_sample', label: '样本量级', type: 'enum', values: ['<1K', '1K-10K', '10K-100K', '100K-1M', '>1M'] },
      ],
    };
  }

  /**
   * 获取标签分类定义
   */
  getCategories(role) {
    if (role === 'C') return this._categories.user_c;
    if (role === 'B') return this._categories.user_b;
    if (role === 'data') return this._categories.data;
    return { ...this._categories };
  }

  /**
   * 给目标打标签
   * @param {string} targetId — 用户 ID 或数据产品 ID
   * @param {string} categoryId — 标签分类 ID
   * @param {string} value — 标签值
   * @param {string} source — 标签来源: 'manual' | 'auto' | 'llm'
   */
  tag(targetId, categoryId, value, source = 'manual') {
    if (!this._tags.has(targetId)) {
      this._tags.set(targetId, []);
    }
    const tags = this._tags.get(targetId);
    // 如果已有同分类的标签，替换
    const existing = tags.find(t => t.categoryId === categoryId);
    if (existing) {
      existing.value = value;
      existing.source = source;
      existing.updatedAt = new Date().toISOString();
    } else {
      tags.push({
        categoryId,
        value,
        source,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    return tags;
  }

  /**
   * 批量打标签
   */
  tagBatch(targetId, tagMap, source = 'manual') {
    Object.entries(tagMap).forEach(([categoryId, value]) => {
      this.tag(targetId, categoryId, value, source);
    });
  }

  /**
   * 获取目标的标签
   */
  getTags(targetId) {
    return this._tags.get(targetId) || [];
  }

  /**
   * 获取目标的标签（按分类组织）
   */
  getTagMap(targetId) {
    const tags = this.getTags(targetId);
    const map = {};
    tags.forEach(t => { map[t.categoryId] = t.value; });
    return map;
  }

  /**
   * 删除目标的某个标签
   */
  removeTag(targetId, categoryId) {
    if (!this._tags.has(targetId)) return;
    const tags = this._tags.get(targetId);
    this._tags.set(targetId, tags.filter(t => t.categoryId !== categoryId));
  }

  /**
   * 按标签筛选目标 ID
   * @param {string} categoryId
   * @param {string} value
   * @returns {string[]}
   */
  filterByTag(categoryId, value) {
    const results = [];
    for (const [targetId, tags] of this._tags) {
      if (tags.some(t => t.categoryId === categoryId && t.value === value)) {
        results.push(targetId);
      }
    }
    return results;
  }

  /**
   * 聚合统计—按分类统计各标签值的人数/产品数
   */
  aggregate(categoryId) {
    const count = {};
    for (const [, tags] of this._tags) {
      const t = tags.find(t => t.categoryId === categoryId);
      if (t) {
        count[t.value] = (count[t.value] || 0) + 1;
      }
    }
    return count;
  }

  /**
   * 获取所有打了标签的目标数
   */
  getTaggedCount() {
    return this._tags.size;
  }

  /**
   * LLM 自动分析用户标签
   * 根据用户交易行为自动推断标签
   */
  async autoTagUser(userId, userData, glmClient) {
    const systemPrompt = `你是一个用户画像分析助手。根据用户的交易行为数据，输出 JSON 格式的标签建议。
可选标签分类：
- c_activity: 活跃度 (高/中/低)
- c_consume_level: 消费力 (高/中/低)
- c_trust_score: 信用分 (0-100 整数)
仅输出 JSON，不要其他内容。`;

    const userPrompt = JSON.stringify({
      userId,
      totalTransactions: userData.txCount || 0,
      totalAmount: userData.totalAmount || 0,
      avgAmount: userData.avgAmount || 0,
      categories: userData.categories || [],
      registerDays: userData.registerDays || 0,
    });

    try {
      const result = await glmClient.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ], 'glm-4-flash');

      // 解析返回内容（支持 OpenAI 兼容格式）
      const text = typeof result === 'string' ? result : (result.choices?.[0]?.message?.content || '');
      const parsed = JSON.parse(text);
      if (parsed.c_activity) this.tag(userId, 'c_activity', parsed.c_activity, 'llm');
      if (parsed.c_consume_level) this.tag(userId, 'c_consume_level', parsed.c_consume_level, 'llm');
      if (parsed.c_trust_score !== undefined) this.tag(userId, 'c_trust_score', String(parsed.c_trust_score), 'llm');
      return parsed;
    } catch (e) {
      console.error('[TagEngine] LLM 自动标签失败:', e.message);
      return null;
    }
  }
}

module.exports = { TagEngine };