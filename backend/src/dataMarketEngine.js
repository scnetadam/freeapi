/**
 * 龟钮印证 — 数据市场引擎
 * 脱敏 + 定价 + 分佣 (BC端 50%)
 */

class DataMarketEngine {
  constructor() {
    // 银行标准费率配置
    this.BANK_RATE = parseFloat(process.env.BANK_RATE) || 0.0038;  // 0.38%
    this.BANK_CAP = parseFloat(process.env.BANK_CAP) || 20;        // 单笔封顶 ¥20
    this.BC_SHARE_RATE = parseFloat(process.env.DATA_MARKET_FEE_RATE) || 0.50;  // BC 分佣 50%
  }

  /**
   * 计算 B 端资费
   * @param {number} amount - 交易金额
   * @returns {number} 应付资费
   */
  calculateBFee(amount) {
    if (amount <= 2000) return 0;

    // 按银行标准费率计算
    const rawFee = amount * this.BANK_RATE;
    // 封顶
    const cappedFee = Math.min(rawFee, this.BANK_CAP);
    // 保留两位小数
    return Math.round(cappedFee * 100) / 100;
  }

  /**
   * 数据脱敏 (PII 清洗)
   * @param {object} data - 原始数据
   * @returns {object} 脱敏后的数据
   */
  sanitize(data) {
    const sanitized = { ...data };

    // 姓名 → 保留姓氏 + *
    if (sanitized.name) {
      sanitized.name = sanitized.name.slice(0, 1) + '*'.repeat(sanitized.name.length - 1);
    }

    // 手机号 → 138****1234
    if (sanitized.phone) {
      sanitized.phone = sanitized.phone.slice(0, 3) + '****' + sanitized.phone.slice(-4);
    }

    // 身份证 → 110***********1234
    if (sanitized.idCard) {
      sanitized.idCard = sanitized.idCard.slice(0, 3) + '***********' + sanitized.idCard.slice(-4);
    }

    // 地址 → 只保留到市/区级
    if (sanitized.address) {
      // 简化：只取前6个字
      sanitized.address = sanitized.address.slice(0, 6) + '...';
    }

    // 精确金额 → 金额区间
    if (typeof sanitized.amount === 'number') {
      sanitized.amountRange = this._amountRange(sanitized.amount);
      delete sanitized.amount;
    }

    // 移除敏感字段
    delete sanitized.openId;
    delete sanitized.token;
    delete sanitized.password;
    delete sanitized.email;

    return sanitized;
  }

  /**
   * 金额区间化
   */
  _amountRange(amount) {
    if (amount <= 10) return '0-10';
    if (amount <= 50) return '10-50';
    if (amount <= 100) return '50-100';
    if (amount <= 500) return '100-500';
    if (amount <= 1000) return '500-1000';
    if (amount <= 5000) return '1000-5000';
    return '5000+';
  }

  /**
   * 计算数据分佣
   * @param {number} saleAmount - G端购买金额
   * @param {string[]} providerIds - 数据提供者ID列表
   * @returns {object} 分佣结果
   */
  calculateCommission(saleAmount, providerIds) {
    if (!providerIds || providerIds.length === 0) {
      return { totalCommission: 0, platform: saleAmount, providers: [] };
    }

    // BC端 50% 分佣
    const totalCommission = Math.round(saleAmount * this.BC_SHARE_RATE * 100) / 100;
    const platformShare = Math.round((saleAmount - totalCommission) * 100) / 100;

    // 按提供者数量均分 (后续可按数据量/价值加权)
    const perProvider = providerIds.length > 0
      ? Math.round((totalCommission / providerIds.length) * 100) / 100
      : 0;

    const providers = providerIds.map(userId => ({
      userId,
      shareAmount: perProvider,
    }));

    return {
      totalCommission,
      platformShare,
      providers,
      saleAmount,
    };
  }
}

module.exports = new DataMarketEngine();