/**
 * 龟钮印证 — 支付宝沙箱支付后端 (L1 通道)
 * 对接支付宝开放平台沙箱环境
 */

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

class AlipayBackend {
  /**
   * @param {object} config
   * @param {string} config.appId - 支付宝应用 ID
   * @param {string} [config.appPrivateKey] - 商户私钥 PEM 字符串
   * @param {string} [config.appPrivateKeyPath] - 商户私钥 PEM 文件路径
   * @param {string} [config.alipayPublicKey] - 支付宝公钥 PEM 字符串
   * @param {string} [config.alipayPublicKeyPath] - 支付宝公钥 PEM 文件路径
   * @param {string} config.gatewayUrl - 网关地址 (沙箱/正式)
   * @param {string} [config.notifyUrl] - 异步通知 URL
   * @param {string} [config.returnUrl] - 同步跳转 URL
   */
  constructor(config) {
    this.appId = config.appId;
    this.gatewayUrl = config.gatewayUrl || 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
    this.notifyUrl = config.notifyUrl;
    this.returnUrl = config.returnUrl;

    // 加载私钥: 优先文件路径，其次 PEM 字符串
    let keyPem = config.appPrivateKey;
    if (config.appPrivateKeyPath) {
      keyPem = fs.readFileSync(path.resolve(config.appPrivateKeyPath), 'utf-8');
    }
    if (!keyPem || !keyPem.includes('-----BEGIN')) {
      throw new Error('支付宝私钥未配置或格式无效');
    }
    this.privateKey = crypto.createPrivateKey(keyPem);

    // 加载支付宝公钥
    let pubPem = config.alipayPublicKey;
    if (config.alipayPublicKeyPath) {
      pubPem = fs.readFileSync(path.resolve(config.alipayPublicKeyPath), 'utf-8');
    }
    if (!pubPem || !pubPem.includes('-----BEGIN')) {
      throw new Error('支付宝公钥未配置或格式无效');
    }
    this.alipayPublicKey = crypto.createPublicKey(pubPem);
  }

  /**
   * RSA2 签名
   */
  _sign(params) {
    const sorted = Object.keys(params)
      .filter(k => k !== 'sign' && params[k] !== undefined && params[k] !== null && params[k] !== '')
      .sort()
      .map(k => `${k}=${params[k]}`)
      .join('&');

    return crypto.sign('sha256', Buffer.from(sorted, 'utf-8'), {
      key: this.privateKey,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    }).toString('base64');
  }

  /**
   * 验签
   */
  _verifySign(params, signature) {
    const sorted = Object.keys(params)
      .filter(k => k !== 'sign' && k !== 'sign_type' && params[k] !== undefined && params[k] !== null && params[k] !== '')
      .sort()
      .map(k => `${k}=${params[k]}`)
      .join('&');

    try {
      return crypto.verify('sha256', Buffer.from(sorted, 'utf-8'), {
        key: this.alipayPublicKey,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      }, Buffer.from(signature, 'base64'));
    } catch {
      return false;
    }
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
    return `x402_${ts}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * 发送 HTTP POST 请求到支付宝网关
   */
  _post(url, params) {
    return new Promise((resolve, reject) => {
      const body = new URLSearchParams(params).toString();
      const u = new URL(url);

      const req = https.request({
        hostname: u.hostname,
        port: 443,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ error_response: { msg: 'parse error', sub_msg: data.slice(0, 200) } }); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * 创建电脑网站支付订单 (page 模式)
   * 返回支付链接，浏览器打开即可扫码支付
   */
  async createTradePagePay(amount, subject = '龟钮印证支付') {
    return this._createTrade('alipay.trade.page.pay', {
      product_code: 'FAST_INSTANT_TRADE_PAY',
    }, amount, subject);
  }

  /**
   * 创建扫码支付订单 (qrcode 模式)
   * 返回二维码字符串
   */
  async createTradePrecreate(amount, subject = '龟钮印证支付') {
    const result = await this._createTrade('alipay.trade.precreate', {}, amount, subject);
    return result;
  }

  /**
   * 创建 App 支付订单 (app 模式)
   * 返回 order string，客户端调起支付宝
   */
  async createTradeAppPay(amount, subject = '龟钮印证支付') {
    const tradeNo = this._generateTradeNo();
    const bizContent = JSON.stringify({
      out_trade_no: tradeNo,
      total_amount: amount,
      subject,
      product_code: 'QUICK_MSECURITY_PAY',
    });

    const params = {
      app_id: this.appId,
      method: 'alipay.trade.app.pay',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, '').replace('T', ' '),
      version: '1.0',
      biz_content: bizContent,
    };

    if (this.notifyUrl) params.notify_url = this.notifyUrl;

    params.sign = this._sign(params);

    const orderString = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');

    return { tradeNo, orderString, amount };
  }

  /**
   * 通用创建支付
   */
  async _createTrade(method, extraBiz, amount, subject) {
    const tradeNo = this._generateTradeNo();
    const bizContent = JSON.stringify({ out_trade_no: tradeNo, total_amount: amount, subject, ...extraBiz });
    const params = {
      app_id: this.appId,
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, '').replace('T', ' '),
      version: '1.0',
      biz_content: bizContent,
    };
    if (this.notifyUrl) params.notify_url = this.notifyUrl;
    if (this.returnUrl && method === 'alipay.trade.page.pay') params.return_url = this.returnUrl;
    params.sign = this._sign(params);

    if (method === 'alipay.trade.precreate') {
      const result = await this._post(this.gatewayUrl, params);
      const resp = result['alipay_trade_precreate_response'];
      if (resp && resp.code === '10000') return { tradeNo, qrCode: resp.qr_code, amount };
      throw new Error(`预创建失败: ${resp?.sub_msg || JSON.stringify(result)}`);
    }

    const queryString = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    return { tradeNo, payUrl: `${this.gatewayUrl}?${queryString}`, amount };
  }

  /**
   * 查询交易状态
   */
  async queryTrade(tradeNo) {
    const bizContent = JSON.stringify({ out_trade_no: tradeNo });

    const params = {
      app_id: this.appId,
      method: 'alipay.trade.query',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, '').replace('T', ' '),
      version: '1.0',
      biz_content: bizContent,
    };
    params.sign = this._sign(params);

    const result = await this._post(this.gatewayUrl, params);
    const responseKey = 'alipay_trade_query_response';
    return result[responseKey] || null;
  }

  /**
   * 验证支付
   */
  async verifyPayment(proof, expectedAmount, expectedRecipient) {
    const result = await this.queryTrade(proof.txHash);
    if (!result) return false;

    if (result.trade_status !== 'TRADE_SUCCESS') return false;

    if (parseFloat(result.total_amount) !== parseFloat(expectedAmount)) return false;

    if (expectedRecipient && result.seller_id !== expectedRecipient) return false;

    return true;
  }

  /**
   * 处理异步通知
   */
  async handleNotify(params) {
    const sign = params.sign;
    if (!sign) return false;

    if (!this._verifySign(params, sign)) return false;

    const tradeStatus = params.trade_status;
    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') return false;

    if (params.app_id !== this.appId) return false;

    return true;
  }

  /**
   * 解析支付宝收款码
   * 沙箱环境：模拟返回商户信息
   * 生产环境：需要调支付宝开放平台接口解析
   */
  async parseQrCode(scanCode) {
    // 支付宝收款码格式示例:
    // https://qr.alipay.com/xxx 或 28xxxxxxxx
    console.log('[Alipay] 解析收款码:', scanCode);

    // 沙箱环境：模拟返回
    // 真实场景需调支付宝接口获取商户信息
    // 目前沙箱没有解析二维码的接口，返回模拟数据
    return {
      success: true,
      userId: 'alipay_merchant_sandbox',
      nickName: '沙箱商户',
      amount: '',
      tradeNo: '',
    };
  }

  /**
   * 返回支付指令给客户端
   */
  paymentInstructions(amount, recipient, nonce) {
    return {
      channel: 'alipay',
      totalAmount: amount,
      recipient,
      nonce,
      description: '请使用支付宝沙箱 App 扫码支付',
    };
  }
}

module.exports = { AlipayBackend };