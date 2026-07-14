const express = require('express');
const router = express.Router();
const { userStore } = require('../models/dataStore');

// POST /api/auth/login — 登录/注册
router.post('/login', (req, res) => {
  try {
    const { code, nickName, avatarUrl, platform, role } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, error: 'code required' });
    }

    const openId = code.startsWith('demo_') ? code : `open_${code.slice(0, 12)}`;

    let user = userStore.getByOpenId(openId);
    if (!user) {
      user = userStore.create({
        openId,
        nickName: nickName || '用户',
        avatarUrl: avatarUrl || '',
        platform: platform || 'alipay',
        role: role || 'C',
      });
    }

    const token = `gn_${user.id}_${Date.now()}`;

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          nickName: user.nickName,
          avatarUrl: user.avatarUrl,
          role: user.role,
        },
      },
    });
  } catch (e) {
    console.error('[Login Error]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/auth/profile — 获取用户信息
router.get('/profile', (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId required' });
    }
    const user = userStore.getById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: '用户不存在' });
    }
    res.json({ success: true, data: user });
  } catch (e) {
    console.error('[Profile Error]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/auth/g-login — G 端快速登录（开发环境）
router.get('/g-login', (req, res) => {
  try {
    const openId = 'demo_g_001';
    let user = userStore.getByOpenId(openId);
    if (!user) {
      user = userStore.create({
        openId,
        nickName: '数据局-张',
        avatarUrl: '',
        platform: 'alipay',
        role: 'G',
      });
    }

    const token = `gn_${user.id}_${Date.now()}`;

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          nickName: user.nickName,
          avatarUrl: user.avatarUrl,
          role: user.role,
        },
      },
    });
  } catch (e) {
    console.error('[G-Login Error]', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;