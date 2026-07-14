class PaymentBackend {
  /**
   * 创建支付订单
   * @param {object} params
   * @param {string} params.outTradeNo - 商户订单号
   * @param {string} params.totalAmount - 总金额 (元)
   * @param {string} params.subject - 订单标题
   * @returns {Promise<object>} { tradeNo, payUrl, amount }
   */
  async createTrade(params) {
    throw new Error('Not implemented');
  }

  /**
   * 查询交易状态
   * @param {string} tradeNo - 订单号
   * @returns {Promise<object|null>}
   */
  async queryTrade(tradeNo) {
    throw new Error('Not implemented');
  }

  /**
   * 验证支付证明
   * @param {PaymentProof} proof
   * @param {string} expectedAmount
   * @param {string} expectedRecipient
   * @returns {Promise<boolean>}
   */
  async verifyPayment(proof, expectedAmount, expectedRecipient) {
    throw new Error('Not implemented');
  }

  /**
   * 处理异步通知
   * @param {object} params - 通知参数
   * @returns {Promise<boolean>} 是否验证通过
   */
  async handleNotify(params) {
    throw new Error('Not implemented');
  }
}

class PaymentProof {
  constructor(txHash, amount, sender, recipient, rawPayload = {}) {
    this.txHash = txHash;
    this.amount = amount;
    this.sender = sender;
    this.recipient = recipient;
    this.rawPayload = rawPayload;
  }
}

module.exports = { PaymentBackend, PaymentProof };