/**
 * 龟钮印证 — HASH 存证引擎
 * 为每笔交易生成不可篡改的 SHA256 摘要
 */

const crypto = require('crypto');

class HashEngine {
  /**
   * 生成交易存证 HASH
   * @param {object} txData - 交易原始数据
   * @param {string} nonce - 防重放随机数
   * @returns {{ hash: string, digest: string }}
   */
  digest(txData, nonce = '') {
    const raw = JSON.stringify(txData) + nonce;
    const hash = crypto.createHash('sha256').update(raw).digest('hex');

    // 数据摘要：只存摘要不存原文（隐私保护）
    const digest = crypto.createHash('sha256')
      .update(JSON.stringify(txData))
      .digest('hex')
      .slice(0, 16);

    return { hash, digest };
  }

  /**
   * 验证存证数据是否被篡改
   * @param {object} txData - 待验证数据
   * @param {string} originalHash - 存证时生成的 HASH
   * @param {string} nonce - 原始 nonce
   * @returns {boolean}
   */
  verify(txData, originalHash, nonce = '') {
    const { hash } = this.digest(txData, nonce);
    return hash === originalHash;
  }
}

module.exports = new HashEngine();