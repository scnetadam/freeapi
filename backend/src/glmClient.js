/**
 * GLM 大模型客户端 (智谱 API)
 * 用于 AI 风控分析
 */

const axios = require('axios');

const GLM_API_BASE = process.env.GLM_API_BASE || 'https://open.bigmodel.cn/api/paas/v4';
const GLM_API_KEY = process.env.GLM_API_KEY || '';
const GLM_DEFAULT_MODEL = process.env.GLM_DEFAULT_MODEL || 'glm-4';

const client = axios.create({
  baseURL: GLM_API_BASE,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
    ...(GLM_API_KEY && { Authorization: `Bearer ${GLM_API_KEY}` }),
  },
});

async function chat(messages, model) {
  const modelName = model || GLM_DEFAULT_MODEL;
  const response = await client.post('/chat/completions', {
    model: modelName,
    messages,
  });
  return response.data;
}

async function chatStream(messages, model) {
  const modelName = model || GLM_DEFAULT_MODEL;
  const response = await client.post('/chat/completions', {
    model: modelName,
    messages,
    stream: true,
  }, {
    responseType: 'stream',
  });
  return response.data;
}

async function getModels() {
  const response = await client.get('/models');
  return response.data;
}

module.exports = {
  chat,
  chatStream,
  getModels,
};