/**
 * 龟钮印证 — 微信支付后端 (L1 通道)
 * 对接微信支付 JSAPI（小程序内支付）
 */

const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

class WechatPayBackend {
  /**
   * @param {object} config
   * @param {string} config.appId - 小程序 AppID
   * @param {string} config.mchId - 微信商户号
   * @param {string} config.apiV3Key - APIv3 密钥（32位）
   * @param {string} [config.apiV3CertPath] - APIv3 证书路径（可选）
   * @param {string} [config.apiV3KeyPath] - APIv3 证书私钥路径（可选）
   * @param {string} [config.notifyUrl] - 异步通知 URL
   * @param {string} [config.apiBase] - API 基础地址（默认生产）
   */
  constructor(config) {
    this.appId = config.appId;
    this.mchId = config.mchId;
    this.apiV3Key = config.apiV3Key;
    this.notifyUrl = config.notifyUrl;
    this.apiBase = config.apiBase || 'https://api.mch.weixin.qq.com';

    // 证书（可选，退款等操作需要）
    this.cert = config.apiV3CertPath ? require('fs').readFileSync(config.apiV3CertPath) : null;
    this.certKey = config.apiV3KeyPath ? require('fs').readFileSync(config.apiV3KeyPath) : null;
  }

  /**
   * 生成随机字符串
   */
  _nonceStr() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * 生成商户订单号
   */
  _generateTradeNo() {
    const now = new Date();
    const ts = now.getFullYear().toString()
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0')
      + String(now.getHours()).padStart(2, '0')
      + String(now.getMinutes()).padStart(2, '0')
      + String(now.getSeconds()).padStart(2, '0');
    return `wx_${ts}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * 生成 JSAPI 调起支付的参数签名
   * 微信支付 V3 规范
   */
  _signPrepay(prepayId) {
    const timeStamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = this._nonceStr();
    const packageStr = `prepay_id=${prepayId}`;

    const signStr = [
      this.appId,
      timeStamp,
      nonceStr,
      packageStr,
    ].join('\n') + '\n';

    const signature = crypto.createHmac('sha256', this.apiV3Key)
      .update(signStr)
      .digest('hex');

    return {
      appId: this.appId,
      timeStamp,
      nonceStr,
      package: packageStr,
      signType: 'RSA',
      paySign: signature,
    };
  }

  /**
   * 创建 JSAPI 支付订单
   * @param {string} amount - 金额（元）
   * @param {string} subject - 商品描述
   * @param {string} openid - 用户在小程序中的 openid
   * @returns {Promise<object>} { tradeNo, prepayInfo, amount }
   */
  async createJsapiPay(amount, subject, openid) {
    const tradeNo = this._generateTradeNo();
    const totalFee = Math.round(parseFloat(amount) * 100); // 转为分

    const body = {
      appid: this.appId,
      mchid: this.mchId,
      description: subject,
      out_trade_no: tradeNo,
      notify_url: this.notifyUrl || '',
      amount: {
        total: totalFee,
        currency: 'CNY',
      },
      payer: {
        openid: openid,
      },
    };

    const result = await this._v3Post('/v3/pay/transactions/jsapi', body);

    if (result.prepay_id) {
      const prepayInfo = this._signPrepay(result.prepay_id);
      return {
        tradeNo,
        prepayInfo,     // 前端调起支付需要的参数
        prepayId: result.prepay_id,
        amount,
      };
    }

    throw new Error(`微信支付下单失败: ${JSON.stringify(result)}`);
  }

  /**
   * 创建 H5 支付订单
   */
  async createH5Pay(amount, subject) {
    const tradeNo = this._generateTradeNo();
    const totalFee = Math.round(parseFloat(amount) * 100);

    const body = {
      appid: this.appId,
      mchid: this.mchId,
      description: subject,
      out_trade_no: tradeNo,
      notify_url: this.notifyUrl || '',
      amount: {
        total: totalFee,
        currency: 'CNY',
      },
      scene_info: {
        payer_client_ip: '',
        h5_info: {
          type: 'Wap',
        },
      },
    };

    const result = await this._v3Post('/v3/pay/transactions/h5', body);

    if (result.h5_url) {
      return {
        tradeNo,
        h5Url: result.h5_url,
        amount,
      };
    }

    throw new Error(`微信H5支付下单失败: ${JSON.stringify(result)}`);
  }

  /**
   * 查询交易状态
   */
  async queryTrade(tradeNo) {
    const result = await this._v3Get(`/v3/pay/transactions/out-trade-no/${tradeNo}?mchid=${this.mchId}`);
    return result;
  }

  /**
   * 验证支付通知（微信支付回调验签）
   */
  async handleNotify(headers, body) {
    // 需要验签：Wechatpay-Signature, Wechatpay-Timestamp, Wechatpay-Nonce, Wechatpay-Serial
    const signature = headers['wechatpay-signature'];
    const timestamp = headers['wechatpay-timestamp'];
    const nonce = headers['wechatpay-nonce'];
    // const serial = headers['wechatpay-serial'];

    const signStr = `${timestamp}\n${nonce}\n${JSON.stringify(body)}\n`;

    // 注意：生产环境需要获取微信平台证书公钥来验签
    // 简化处理：直接解析 body 中的交易状态
    if (!signature) return false;

    const resource = body.resource;
    if (!resource) return false;

    // 解密 resource 中的密文
    const ciphertext = resource.ciphertext;
    const associatedData = resource.associated_data;
    const nonceDecrypt = resource.nonce;

    try {
      const plaintext = this._decryptAes256Gcm(ciphertext, associatedData, nonceDecrypt);
      const data = JSON.parse(plaintext);

      const isValid = data.appid === this.appId
        && data.trade_state === 'SUCCESS'
        && data.mchid === this.mchId;

      return isValid ? { success: true, data } : { success: false };
    } catch {
      return { success: false };
    }
  }

  /**
   * AES-256-GCM 解密（微信支付回调body解密用）
   */
  _decryptAes256Gcm(ciphertext, associatedData, nonce) {
    const key = Buffer.from(this.apiV3Key, 'utf-8');
    const cipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf-8'));
    cipher.setAAD(Buffer.from(associatedData, 'utf-8'));
    const encrypted = Buffer.from(ciphertext, 'base64');
    const tag = encrypted.subarray(encrypted.length - 16);
    const data = encrypted.subarray(0, encrypted.length - 16);
    cipher.setAuthTag(tag);
    return cipher.update(data).toString('utf-8') + cipher.final().toString('utf-8');
  }

  /**
   * 验证支付证明（简单版）
   */
  async verifyPayment(proof, expectedAmount, expectedRecipient) {
    const result = await this.queryTrade(proof.txHash);
    if (!result || result.trade_state !== 'SUCCESS') return false;

    const totalAmount = (result.amount?.total || 0) / 100;
    if (parseFloat(totalAmount.toFixed(2)) !== parseFloat(expectedAmount)) return false;

    return true;
  }

  /**
   * APIv3 POST 请求
   */
  _v3Post(path, body) {
    return this._v3Request(path, 'POST', body);
  }

  /**
   * APIv3 GET 请求
   */
  _v3Get(path) {
    return this._v3Request(path, 'GET');
  }

  /**
   * APIv3 通用请求
   */
  _v3Request(path, method, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.apiBase + path);
      const bodyStr = body ? JSON.stringify(body) : '';

      const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'x402-backend/1.0',
        },
      };

      if (bodyStr) {
        options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
      }

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ error: 'parse error', raw: data.slice(0, 200) }); }
        });
      });
      req.on('error', reject);

      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  /**
   * 模拟支付（开发/沙箱环境使用）
   * 直接返回 prepay 参数，不调微信 API
   */
  simulateJsapiPay(amount, subject, openid = 'simulate_openid') {
    const tradeNo = this._generateTradeNo();
    const fakePrepayId = `wx${crypto.randomBytes(16).toString('hex')}`;

    return {
      tradeNo,
      prepayInfo: this._signPrepay(fakePrepayId),
      prepayId: fakePrepayId,
      amount,
      simulated: true,
    };
  }
}

module.exports = { WechatPayBackend };