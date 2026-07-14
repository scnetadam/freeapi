/**
 * 龟钮印证 — 推广路由
 * 邀请码生成、绑定关系、推广金分成、统计
 */

const express = require('express');
const router = express.Router();
const { v4: uuid } = require('uuid');
const { userStore, walletStore, paymentStore } = require('../models/dataStore');

// ==================== 内存存储：邀请关系 ====================
const inviteCodes = new Map();   // inviteCode -> inviteInfo
const userInviteCode = new Map(); // userId -> inviteCode
const referralMap = new Map();   // userId -> inviterId (被邀请人 -> 邀请人)

// 返佣配置
const COMMISSION = {
  inviteReward: 1.00,         // 邀请注册奖励 ¥1
  txCommissionRate: 0.005,    // 消费返佣 0.5%
  maxCommissionPerTx: 50,     // 单笔返佣封顶 ¥50
  maxCommissionDaily: 500,    // 每日返佣封顶 ¥500
};

// 生成邀请码（8位大写字母数字）
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 8; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (inviteCodes.has(code));
  return code;
}

/**
 * POST /api/promo/code — 生成/获取邀请码
 * body: { userId }
 */
router.post('/code', (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: '缺少 userId' });
    }

    const user = userStore.getById(userId);
    if (!user) {
      return res.status(400).json({ success: false, error: '用户不存在' });
    }

    // 已有邀请码
    let code = userInviteCode.get(userId);
    if (code && inviteCodes.has(code)) {
      const info = inviteCodes.get(code);
      return res.json({
        success: true,
        data: {
          inviteCode: code,
          totalInvited: info.usedBy.length,
          totalRewards: info.totalRewards || 0,
          createdAt: info.createdAt,
        },
      });
    }

    // 生成新邀请码
    code = generateInviteCode();
    const inviteInfo = {
      inviterId: userId,
      createdAt: new Date().toISOString(),
      usedBy: [],
      totalRewards: 0,
    };
    inviteCodes.set(code, inviteInfo);
    userInviteCode.set(userId, code);

    res.json({
      success: true,
      data: {
        inviteCode: code,
        totalInvited: 0,
        totalRewards: 0,
        createdAt: inviteInfo.createdAt,
      },
    });
  } catch (err) {
    console.error('[Promo Code Error]', err);
    res.status(500).json({ success: false, error: '邀请码生成失败' });
  }
});

/**
 * POST /api/promo/bind — 绑定邀请关系（新用户注册时调用）
 * body: { userId, inviteCode }
 */
router.post('/bind', (req, res) => {
  try {
    const { userId, inviteCode } = req.body;
    if (!userId || !inviteCode) {
      return res.status(400).json({ success: false, error: '参数不完整' });
    }

    // 验证邀请码
    const info = inviteCodes.get(inviteCode);
    if (!info) {
      return res.status(400).json({ success: false, error: '邀请码无效' });
    }

    // 不能自己邀请自己
    if (info.inviterId === userId) {
      return res.status(400).json({ success: false, error: '不能使用自己的邀请码' });
    }

    // 已被邀请过
    if (referralMap.has(userId)) {
      return res.status(400).json({ success: false, error: '已被邀请过' });
    }

    // 记录邀请关系
    referralMap.set(userId, info.inviterId);
    info.usedBy.push(userId);

    // 邀请人获得推广金
    const reward = COMMISSION.inviteReward;
    const wallet = walletStore.get(info.inviterId);
    wallet.promotionBalance = (wallet.promotionBalance || 0) + reward;
    wallet.balance += reward;
    info.totalRewards = (info.totalRewards || 0) + reward;

    // 记录推广金流水
    walletStore._logTx(info.inviterId, 'promo_reward', reward,
      `推广奖励 · 邀请新用户`, `promo_${userId}`, wallet.balance);

    res.json({
      success: true,
      data: {
        inviterId: info.inviterId,
        reward,
        message: '绑定成功，获得推广奖励',
      },
    });
  } catch (err) {
    console.error('[Promo Bind Error]', err);
    res.status(500).json({ success: false, error: '邀请绑定失败' });
  }
});

/**
 * GET /api/promo/stats — 推广统计
 * query: { userId }
 */
router.get('/stats', (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ success: false, error: '缺少 userId' });
    }

    const code = userInviteCode.get(userId);
    let inviteInfo = null;
    if (code) {
      inviteInfo = inviteCodes.get(code);
    }

    // 被谁邀请
    const inviterId = referralMap.get(userId);
    let inviterName = '';
    if (inviterId) {
      const inviter = userStore.getById(inviterId);
      inviterName = inviter ? inviter.nickName : '';
    }

    const wallet = walletStore.get(userId);

    res.json({
      success: true,
      data: {
        inviteCode: code || '',
        totalInvited: inviteInfo ? inviteInfo.usedBy.length : 0,
        totalRewards: inviteInfo ? (inviteInfo.totalRewards || 0) : 0,
        promotionBalance: wallet.promotionBalance || 0,
        inviterId: inviterId || '',
        inviterName,
        invitedUsers: inviteInfo ? inviteInfo.usedBy.map(uid => {
          const u = userStore.getById(uid);
          return { id: uid, nickName: u ? u.nickName : '' };
        }) : [],
      },
    });
  } catch (err) {
    console.error('[Promo Stats Error]', err);
    res.status(500).json({ success: false, error: '查询失败' });
  }
});

/**
 * GET /api/promo/rewards — 推广金流水
 * query: { userId }
 */
router.get('/rewards', (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ success: false, error: '缺少 userId' });
    }

    const result = walletStore.getTransactions(userId);
    const promoLogs = result.list.filter(tx => tx.type === 'promo_reward');

    res.json({ success: true, data: { list: promoLogs, total: promoLogs.length } });
  } catch (err) {
    console.error('[Promo Rewards Error]', err);
    res.status(500).json({ success: false, error: '查询失败' });
  }
});

module.exports = router;

// ==================== 推广广场 ====================
// 用户可以将自己的推广信息发布到广场，其他用户可以浏览并绑定
const promoPosts = []; // { id, userId, nickName, inviteCode, message, createdAt, likes }

/**
 * POST /api/promo/publish — 发布到推广广场
 * body: { userId, message }
 */
router.post('/publish', (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: '缺少 userId' });
    }

    const code = userInviteCode.get(userId);
    if (!code) {
      return res.status(400).json({ success: false, error: '请先生成邀请码' });
    }

    const user = userStore.getById(userId);
    if (!user) {
      return res.status(400).json({ success: false, error: '用户不存在' });
    }

    // 检查是否已发布（每人最多1条）
    const existing = promoPosts.find(p => p.userId === userId);
    if (existing) {
      existing.message = message || existing.message;
      existing.updatedAt = new Date().toISOString();
      return res.json({ success: true, data: existing });
    }

    const post = {
      id: uuid(),
      userId,
      nickName: user.nickName || '用户',
      inviteCode: code,
      message: message || '来龟钮印证，一起赚推广金！',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      likes: 0,
    };
    promoPosts.unshift(post);

    res.json({ success: true, data: post });
  } catch (err) {
    console.error('[Promo Publish Error]', err);
    res.status(500).json({ success: false, error: '发布失败' });
  }
});

/**
 * GET /api/promo/plaza — 推广广场列表
 * query: { page, pageSize, search }
 */
router.get('/plaza', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 50);
    const search = (req.query.search || '').trim().toUpperCase();

    let list = [...promoPosts];

    // 搜索：按昵称或邀请码
    if (search) {
      list = list.filter(p =>
        p.nickName.includes(search) || p.inviteCode.includes(search) || p.inviteCode === search
      );
    }

    // 分页
    const total = list.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize);

    // 带上邀请人数
    const enriched = items.map(p => {
      const info = inviteCodes.get(p.inviteCode);
      return {
        ...p,
        totalInvited: info ? info.usedBy.length : 0,
        totalRewards: info ? (info.totalRewards || 0) : 0,
      };
    });

    res.json({
      success: true,
      data: {
        list: enriched,
        total,
        page,
        pageSize,
        totalPages,
      },
    });
  } catch (err) {
    console.error('[Promo Plaza Error]', err);
    res.status(500).json({ success: false, error: '查询失败' });
  }
});

/**
 * POST /api/promo/plaza/like — 点赞推广广场内容
 * body: { postId }
 */
router.post('/plaza/like', (req, res) => {
  try {
    const { postId } = req.body;
    if (!postId) return res.status(400).json({ success: false, error: '缺少 postId' });

    const post = promoPosts.find(p => p.id === postId);
    if (!post) return res.status(404).json({ success: false, error: '内容不存在' });

    post.likes = (post.likes || 0) + 1;
    res.json({ success: true, data: { likes: post.likes } });
  } catch (err) {
    console.error('[Promo Plaza Like Error]', err);
    res.status(500).json({ success: false, error: '点赞失败' });
  }
});

// ==================== 分享记录 ====================
const shareLogs = []; // { id, userId, platform, inviteCode, createdAt }

/**
 * POST /api/promo/share — 记录分享行为
 * body: { userId, platform }  platform: alipay_friend|alipay_timeline|wechat_friend|wechat_moment|clipboard|link|poster
 */
router.post('/share', (req, res) => {
  try {
    const { userId, platform } = req.body;
    if (!userId || !platform) {
      return res.status(400).json({ success: false, error: '参数不完整' });
    }

    const code = userInviteCode.get(userId);

    const log = {
      id: uuid(),
      userId,
      platform,
      inviteCode: code || '',
      createdAt: new Date().toISOString(),
    };
    shareLogs.push(log);

    // 最多保留最近1000条
    if (shareLogs.length > 1000) {
      shareLogs.splice(0, shareLogs.length - 1000);
    }

    res.json({ success: true, data: log });
  } catch (err) {
    console.error('[Promo Share Error]', err);
    res.status(500).json({ success: false, error: '记录失败' });
  }
});

/**
 * GET /api/promo/share-stats — 分享统计
 * query: { userId }
 */
router.get('/share-stats', (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ success: false, error: '缺少 userId' });

    const userLogs = shareLogs.filter(l => l.userId === userId);

    // 按平台统计
    const byPlatform = {};
    for (const l of userLogs) {
      byPlatform[l.platform] = (byPlatform[l.platform] || 0) + 1;
    }

    res.json({
      success: true,
      data: {
        total: userLogs.length,
        byPlatform,
        recent: userLogs.slice(-10).reverse(),
      },
    });
  } catch (err) {
    console.error('[Promo ShareStats Error]', err);
    res.status(500).json({ success: false, error: '查询失败' });
  }
});

/**
 * processTxCommission — 支付确认成功后调用，处理消费返佣
 * @param {string} userId - 付款用户ID（被邀请人）
 * @param {number} amount - 交易金额
 * @param {string} txId - 交易ID
 * @returns {{ commission: number, inviterId: string|null }}
 */
function processTxCommission(userId, amount, txId) {
  const inviterId = referralMap.get(userId);
  if (!inviterId) return { commission: 0, inviterId: null };

  const commission = Math.min(
    Math.round(amount * COMMISSION.txCommissionRate * 100) / 100,
    COMMISSION.maxCommissionPerTx
  );

  if (commission <= 0) return { commission: 0, inviterId };

  // 每日返佣封顶检查
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTxs = walletStore.getTransactions(inviterId);
  const todayCommissions = todayTxs.list.filter(tx =>
    tx.type === 'promo_commission' &&
    tx.createdAt && new Date(tx.createdAt).getTime() >= todayStart.getTime()
  );
  const todayTotal = todayCommissions.reduce((s, t) => s + (t.amount || 0), 0);
  if (todayTotal + commission > COMMISSION.maxCommissionDaily) {
    return { commission: 0, inviterId };
  }

  // 发放返佣
  const wallet = walletStore.get(inviterId);
  wallet.promotionBalance = (wallet.promotionBalance || 0) + commission;
  wallet.balance += commission;

  walletStore._logTx(inviterId, 'promo_commission', commission,
    `消费返佣 ¥${amount.toFixed(2)} × ${(COMMISSION.txCommissionRate * 100).toFixed(1)}%`, txId, wallet.balance);

  // 更新邀请信息统计
  const code = userInviteCode.get(inviterId);
  if (code && inviteCodes.has(code)) {
    inviteCodes.get(code).totalRewards = (inviteCodes.get(code).totalRewards || 0) + commission;
  }

  return { commission, inviterId };
}

// 导出
router._referralMap = referralMap;
router._commission = COMMISSION;
router.processTxCommission = processTxCommission;

/**
 * GET /api/promo/rules — 推广规则
 */
router.get('/rules', (req, res) => {
  res.json({
    success: true,
    data: {
      inviteReward: COMMISSION.inviteReward,
      txCommissionRate: COMMISSION.txCommissionRate,
      txCommissionRateDisplay: `${(COMMISSION.txCommissionRate * 100).toFixed(1)}%`,
      maxCommissionPerTx: COMMISSION.maxCommissionPerTx,
      maxCommissionDaily: COMMISSION.maxCommissionDaily,
    },
  });
});

module.exports = router;