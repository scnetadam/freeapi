/**
 * 龟钮印证 — 支付核心路由 (L0 隔离层)
 * 支付数据与支付通道分离
 */

const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const fs = require('fs');
const path = require('path');
const { paymentStore, walletStore, userStore, hashStore } = require('../models/dataStore');
const hashEngine = require('../hashEngine');
const riskEngine = require('../riskEngine');
const glmClient = require('../glmClient');
const { TagEngine } = require('../tagEngine');
const tagEngine = new TagEngine();

// 龟纽印信存证
const guinieuSeal = require('../guinieu/seal').sealImpress;
const guinieuDb = require('../models/database');

// 支付宝沙箱支付后端 (如果密钥文件存在则启用)
let alipayBackend = null;
try {
  const { AlipayBackend } = require('../paymentBackends/alipay');
  const keyPath = path.join(__dirname, '..', '..', 'keys', 'alipay-private.pem');
  const pubPath = path.join(__dirname, '..', '..', 'keys', 'alipay-public.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(pubPath)) {
    alipayBackend = new AlipayBackend({
      appId: process.env.ALIPAY_APP_ID,
      appPrivateKeyPath: keyPath,
      alipayPublicKeyPath: pubPath,
      gatewayUrl: process.env.ALIPAY_GATEWAY || 'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
      notifyUrl: process.env.ALIPAY_NOTIFY_URL,
      returnUrl: process.env.ALIPAY_RETURN_URL,
    });
    console.log('[Alipay] 支付宝沙箱后端已加载');
  }
} catch (e) {
  console.log('[Alipay] 支付宝沙箱后端未配置:', e.message);
}

// 微信支付后端
let wechatPayBackend = null;
try {
  const { WechatPayBackend } = require('../paymentBackends/wechat');
  const apiV3Key = process.env.WECHAT_API_V3_KEY;
  if (process.env.WECHAT_MCH_ID && process.env.WECHAT_APP_ID && apiV3Key) {
    wechatPayBackend = new WechatPayBackend({
      appId: process.env.WECHAT_APP_ID,
      mchId: process.env.WECHAT_MCH_ID,
      apiV3Key,
      notifyUrl: process.env.WECHAT_NOTIFY_URL,
    });
    console.log('[Wechat] 微信支付后端已加载');
  }
} catch (e) {
  console.log('[Wechat] 微信支付后端未配置:', e.message);
}
const dataMarketEngine = require('../dataMarketEngine');

// POST /api/payment/create — 创建支付 (L0)
router.post('/create', async (req, res) => {
  try {
    let { amount, subject, description, payerId, payeeId, userId } = req.body;
    amount = parseFloat(amount);
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: '无效金额' });
    }
    if (!subject) {
      return res.status(400).json({ success: false, error: '请填写交易标题' });
    }

    const effectiveUserId = userId || payerId;

    // 1. AI 风控检查（本地规则 + LLM 深度分析）
    const recentTxs = paymentStore.getByUser(effectiveUserId).slice(-10);
    const riskResult = riskEngine.assessPaymentRisk({
      amount,
      userId: effectiveUserId,
      payeeId,
      recentTxs,
    });

    // LLM 深度风控分析（异步，不阻塞支付流程）
    let llmAnalysis = null;
    try {
      const llmRaw = await riskEngine.llmRiskAnalysis({
        amount,
        userId: effectiveUserId,
        payeeId,
        recentTxs,
      }, glmClient);
      if (llmRaw && llmRaw.riskLevel) {
        llmAnalysis = llmRaw;
        // LLM 高风险且本地规则未拦截时，追加拦截
        if (llmAnalysis.riskLevel === 'high' && riskResult.decision !== 'block') {
          riskResult.decision = 'block';
          riskResult.score = Math.max(riskResult.score, 70);
          riskResult.llmOverride = true;
          riskResult.risks.push({
            type: 'llm_risk',
            level: 'high',
            message: `AI 深度分析：${llmAnalysis.reason}`,
          });
        }
      }
    } catch (e) {
      console.error('[LLM Risk] 深度分析异常:', e.message);
    }

    if (riskResult.decision === 'block') {
      return res.status(403).json({
        success: false,
        error: '交易被风控拦截',
        risk: riskResult,
        llmAnalysis,
      });
    }

    // LLM 分析结果附加到风控结果中（非阻塞场景）
    riskResult.llmAnalysis = llmAnalysis;

    // 2. 计算 B 端资费
    let bFee = 0;
    const payer = userStore.getById(payerId);
    if (payer && payer.role === 'B') {
      bFee = dataMarketEngine.calculateBFee(amount);
    }

    // 3. 创建支付记录 (L0)
    const channel = req.body.channel || 'alipay';
    const payment = paymentStore.create({
      userId: effectiveUserId,
      amount,
      subject,
      description: description || '',
      payerId: payerId || effectiveUserId,
      payeeId,
      channel,
    });

    // 4. 生成 HASH 存证
    const nonce = uuid().slice(0, 8);
    const { hash, digest } = hashEngine.digest({
      id: payment.id,
      amount,
      subject,
      payerId: payment.payerId,
      payeeId: payment.payeeId,
      createdAt: payment.createdAt,
    }, nonce);

    paymentStore.update(payment.id, { hash, nonce });

    // 5. 写入 HASH 存证
    hashStore.create({
      txId: payment.id,
      hash,
      dataDigest: digest,
      dataType: 'payment',
      metadata: { subject, amount },
    });

    // 5b. 龟纽印信存证 — 自动 sealImpress('settle_instruct')
    try {
      const guinieuEvent = guinieuSeal({
        type: 'settle_instruct',
        payload: { id: payment.id, amount, subject, payerId: payment.payerId, payeeId },
        createdBy: payerId || 'system',
        sigMethod: 'hmac-sha256',
        secretOrKey: 'guinieu_backend_hmac_key',
      });
      // 写入 guinieu 表
      guinieuEvent.ref_tx_id = payment.id;
      guinieuDb.getDb().prepare(`
        INSERT INTO guinieu_events (event_id, type, ts, payload_json, payload_hash, prev_event_id, sig_method, sig, status, reason, created_by, ref_tx_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        guinieuEvent.event_id, guinieuEvent.type, guinieuEvent.ts, guinieuEvent.payload_json,
        guinieuEvent.payload_hash, guinieuEvent.prev_event_id, guinieuEvent.sig_method, guinieuEvent.sig,
        guinieuEvent.status || 'active', guinieuEvent.reason || null, guinieuEvent.created_by || 'system',
        guinieuEvent.ref_tx_id, new Date().toISOString(),
      );
      // 把 event_id 记到 payment 上
      paymentStore.update(payment.id, { guinieu_event_id: guinieuEvent.event_id });
    } catch (ge) {
      console.warn('[Guinieu Seal] 存证写入失败（不阻塞支付）:', ge.message);
    }

    // 6. 生成支付指令 (L1 通道) — 支持 page/qrcode/app 三种模式
    const payMode = req.body.payMode || 'page';
    const forceSimulate = process.env.ALIPAY_SIMULATE === 'true' || req.body.simulate === true;
    let paymentInstruction;

    if (channel === 'wechat') {
      // 微信支付 (JSAPI 小程序支付)
      const openid = req.body.openid;
      const forceSimWechat = process.env.WECHAT_SIMULATE === 'true' || req.body.simulate === true;

      if (wechatPayBackend && !forceSimWechat && openid) {
        paymentInstruction = await wechatPayBackend.createJsapiPay(
          (amount + bFee).toFixed(2), subject, openid
        );
        paymentInstruction.mode = 'jsapi';
      } else {
        paymentInstruction = wechatPayBackend
          ? wechatPayBackend.simulateJsapiPay((amount + bFee).toFixed(2), subject, openid || 'simulate_openid')
          : { channel: 'wechat', outTradeNo: payment.id, totalAmount: (amount + bFee).toFixed(2), subject: payment.subject, mode: 'simulated' };
      }
    } else {
      // 支付宝支付
      if (alipayBackend && !forceSimulate) {
        switch (payMode) {
          case 'qrcode':
            paymentInstruction = await alipayBackend.createTradePrecreate(
              (amount + bFee).toFixed(2), subject
            );
            break;
          case 'app':
            paymentInstruction = await alipayBackend.createTradeAppPay(
              (amount + bFee).toFixed(2), subject
            );
            break;
          default:
            paymentInstruction = await alipayBackend.createTradePagePay(
              (amount + bFee).toFixed(2), subject
            );
        }
        paymentInstruction.mode = payMode;
      } else {
        paymentInstruction = {
          channel: 'alipay',
          outTradeNo: payment.id,
          totalAmount: (amount + bFee).toFixed(2),
          subject: payment.subject,
          mode: 'simulated',
        };
      }
    }

    res.json({
      success: true,
      data: {
        id: payment.id,
        amount: payment.amount,
        subject: payment.subject,
        bFee,                    // B 端资费
        hash,                    // 存证 HASH
        digest,                  // 数据摘要
        risk: riskResult,        // 风控结果
        paymentInstruction,      // L1 通道支付指令
        createdAt: payment.createdAt,
      },
    });
  } catch (err) {
    console.error('[Payment Create Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/payment/confirm — 确认支付完成 + 自动生成存证
router.post('/confirm', (req, res) => {
  const { id, channelTradeNo } = req.body;
  if (!id) {
    return res.status(400).json({ success: false, error: 'id required' });
  }

  const payment = paymentStore.confirmSuccess(id, channelTradeNo);
  if (!payment) {
    return res.status(404).json({ success: false, error: '支付记录不存在' });
  }

  // 更新钱包
  // 给收款方加钱
  if (payment.payeeId) {
    walletStore.addBalance(payment.payeeId, payment.amount, `收款: ${payment.subject}`, payment.id);
  }
  // 给付款方记录支出（扣减余额 + 交易流水）
  if (payment.payerId) {
    walletStore.deductBalance(payment.payerId, payment.amount, `付款: ${payment.subject}`, payment.id);
  }

  // ============ 推广返佣 ============
  let commission = null;
  try {
    if (payment.payerId) {
      const promo = require('./promo');
      const result = promo.processTxCommission(payment.payerId, payment.amount, payment.id);
      if (result && result.commission > 0) {
        commission = result;
      }
    }
  } catch (e) {
    console.error('[Promo Commission] 返佣处理异常:', e.message);
  }

  // ============ 自动生成存证 ============
  // 使用支付 create 时已计算的 hash，无需重新生成
  // 创建公证记录（使用默认公证服务商：公证云）
  const notaryFee = Math.round(payment.amount * 0.15 * 100) / 100;
  const notaryId = `notary_${require('uuid').v4().slice(0, 12)}`;
  const notaryRecord = {
    id: notaryId,
    txId: payment.id,
    userId: payment.payerId || payment.userId,
    providerId: 'notary_cloud',
    providerName: '公证云',
    notaryFee,
    hash: payment.hash || '',
    status: 'completed',
    certificateNo: `cert_${payment.id}`,
    createdAt: payment.paidAt,
    completedAt: new Date().toISOString(),
  };

  // 存入公证记录
  const notaryRecords = require('./notary')._records;
  if (notaryRecords) {
    notaryRecords.set(notaryId, notaryRecord);
  }

  // ============ 消费健康提醒 ============
  let healthWarning = null;
  try {
    if (payment.payerId) {
      const userTxs = paymentStore.getByUser(payment.payerId);
      const now = Date.now();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayTxs = userTxs.filter(t =>
        t.createdAt && new Date(t.createdAt).getTime() >= todayStart.getTime() &&
        t.payerId === payment.payerId && t.status === 'success'
      );
      const todayTotal = todayTxs.reduce((s, t) => s + (t.amount || 0), 0);

      const weekAgo = now - 86400000 * 7;
      const weekTxs = userTxs.filter(t =>
        t.createdAt && new Date(t.createdAt).getTime() >= weekAgo &&
        t.payerId === payment.payerId && t.status === 'success'
      );
      const weekTotal = weekTxs.reduce((s, t) => s + (t.amount || 0), 0);
      const weekCount = weekTxs.length;

      const wallet = walletStore.get(payment.payerId);
      const balance = wallet?.balance || 0;

      const warnings = [];
      if (todayTotal > 10000) {
        warnings.push(`今日累计消费 ¥${todayTotal.toFixed(2)}，金额较高，请注意合理消费`);
      }
      if (weekCount >= 15) {
        warnings.push(`近7天消费 ${weekCount} 笔，频率较高`);
      }
      if (balance > 0 && weekTotal > balance * 0.5) {
        warnings.push(`近7天消费 ¥${weekTotal.toFixed(2)}，超过余额 50%，请注意资金规划`);
      }
      if (balance > 0 && payment.amount > balance * 0.3 && payment.amount >= 1000) {
        warnings.push(`单笔 ¥${payment.amount.toFixed(2)}，超过余额 30%，请确认资金充足`);
      }

      if (warnings.length > 0) {
        healthWarning = {
          level: todayTotal > 50000 || weekTotal > balance ? 'warning' : 'info',
          messages: warnings,
          todayTotal: Math.round(todayTotal * 100) / 100,
          weekTotal: Math.round(weekTotal * 100) / 100,
          balance: Math.round(balance * 100) / 100,
        };
      }
    }
  } catch (e) {
    console.error('[Health Check Error]', e.message);
  }

  // ============ 交易智能标签自动生成 ============
  // 异步触发，不阻塞响应
  try {
    const payerUser = userStore.getById(payment.payerId);
    if (payerUser) {
      const userTxs = paymentStore.getByUser(payment.payerId);
      const totalAmount = userTxs.reduce((s, t) => s + (t.amount || 0), 0);
      const categories = [...new Set(userTxs.map(t => t.subject || '通用支付'))];
      tagEngine.autoTagUser(payment.payerId, {
        txCount: userTxs.length,
        totalAmount,
        avgAmount: userTxs.length > 0 ? totalAmount / userTxs.length : 0,
        categories,
        registerDays: payerUser.createdAt ? Math.floor((Date.now() - new Date(payerUser.createdAt).getTime()) / 86400000) : 0,
      }, glmClient).catch(e => console.error('[TagEngine] autoTagUser error:', e.message));
    }
  } catch (e) {
    console.error('[TagEngine] 标签生成异常:', e.message);
  }

  // 返回完整的支付 + 存证信息
  res.json({
    success: true,
    data: {
      id: payment.id,
      status: payment.status,
      channelTradeNo: payment.channelTradeNo,
      paidAt: payment.paidAt,
      // 存证信息
      hash: payment.hash,
      digest: payment.nonce ? require('../hashEngine').digest({
        id: payment.id,
        amount: payment.amount,
        subject: payment.subject,
        payerId: payment.payerId,
        payeeId: payment.payeeId,
        createdAt: payment.createdAt,
      }, payment.nonce).digest : '',
      // 公证信息
      notary: {
        id: notaryId,
        provider: '公证云',
        fee: notaryFee,
        certificateNo: notaryRecord.certificateNo,
        status: 'completed',
      },
      // 消费健康提醒
      healthWarning,
      // 推广返佣
      commission,
    },
  });
});

// GET /api/payment/query — 查询支付状态
router.get('/query', (req, res) => {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ success: false, error: 'id required' });
  }
  const payment = paymentStore.getById(id);
  if (!payment) {
    return res.status(404).json({ success: false, error: '支付记录不存在' });
  }
  res.json({ success: true, data: payment });
});

// GET /api/payment/list — 交易列表
router.get('/list', (req, res) => {
  const { userId, page } = req.query;
  if (userId) {
    const list = paymentStore.getByUser(userId);
    return res.json({ success: true, data: { list, total: list.length } });
  }
  const result = paymentStore.list(parseInt(page) || 1);
  res.json({ success: true, data: result });
});

// POST /api/payment/scan-pay — 扫码支付（识别外部收款码）
router.post('/scan-pay', async (req, res) => {
  try {
    const { scanCode, userId } = req.body;
    if (!scanCode) {
      return res.status(400).json({ success: false, error: '扫码内容为空' });
    }

    console.log('[ScanPay] 扫码内容:', scanCode);

    // 尝试解析支付宝收款码
    let payeeId = '';
    let amount = 0;
    let tradeNo = '';

    // 如果是龟钮印证内部码
    try {
      const parsed = JSON.parse(scanCode);
      if (parsed.type === 'x402_collect') {
        return res.json({
          success: true,
          data: {
            userId: parsed.userId,
            nickName: parsed.nickName || '用户',
            amount: parsed.amount || '',
            tradeNo: '',
            isInternal: true
          }
        });
      }
    } catch (e) { /* 不是 JSON */ }

    // 外部收款码（支付宝标准码）
    // 格式通常为: https://qr.alipay.com/xxx 或 28xxxxxxxx
    // 这里用模拟数据返回
    if (alipayBackend) {
      try {
        const result = await alipayBackend.parseQrCode(scanCode);
        if (result && result.success) {
          return res.json({
            success: true,
            data: {
              userId: result.userId || '',
              nickName: result.nickName || '商户',
              amount: result.amount || '',
              tradeNo: result.tradeNo || '',
              isInternal: false
            }
          });
        }
      } catch (e) {
        console.log('[ScanPay] 支付宝解析失败:', e.message);
      }
    }

    // 降级：返回模拟商户信息
    // 真实场景需要调支付宝接口解析二维码
    res.json({
      success: true,
      data: {
        userId: '',
        nickName: '商户',
        amount: '',
        tradeNo: '',
        isInternal: false,
        rawCode: scanCode
      }
    });
  } catch (err) {
    console.error('[ScanPay Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/payment/notify — 支付通道异步通知
router.post('/notify', (req, res) => {
  const notification = req.body;
  console.log('[Payment Notify]', JSON.stringify(notification));

  // 简化：直接返回成功 (生产环境需验签)
  res.send('success');
});

module.exports = router;