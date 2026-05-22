// 车智诊 API - Vercel Serverless 版本（Express 方式）
// 数据存储在 GitHub Issues 中（免费）
// 环境变量需在 Vercel 项目设置中配置：
//   GITHUB_TOKEN - GitHub Personal Access Token
//   GITHUB_USER - GitHub 用户名
//   GITHUB_REPO - 数据仓库名（默认 chezhizhen-data）
//   MASTER_KEY - 管理员密钥

const express = require('express');
const app = express();
app.use(express.json());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_USER = process.env.GITHUB_USER || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'chezhizhen-data';
const MASTER_KEY = process.env.MASTER_KEY || 'yuehua888';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// ========== GitHub API 封装 ==========
const DATA_LABELS = ['chezhizhen-data'];

async function getIssueByTitle(title) {
  const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/issues?labels=${encodeURIComponent('chezhizhen-data')}&state=all&per_page=50`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
  });
  if (!res.ok) return null;
  const issues = await res.json();
  return issues.find(i => i.title === title);
}

async function getData(title) {
  const issue = await getIssueByTitle(title);
  if (!issue) return null;
  try { return JSON.parse(issue.body); } catch { return null; }
}

async function setData(title, data) {
  const existing = await getIssueByTitle(title);
  const body = JSON.stringify(data, null, 2);
  if (existing) {
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/issues/${existing.number}`;
    await fetch(url, { method: 'PATCH', headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
  } else {
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/issues`;
    await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body, labels: DATA_LABELS }) });
  }
}

async function appendToList(key, item) {
  let list = await getData(key) || [];
  if (!Array.isArray(list)) list = [];
  list.push(item);
  await setData(key, list);
}

// ========== 激活码 API ==========
app.post('/api/admin/gen_code', async (req, res) => {
  if (req.body.master_key !== MASTER_KEY) return res.status(403).json({ ok: false, msg: '授权失败' });
  const type = req.body.type || 'month';
  const count = req.body.count || 1;
  const codes = await getData('activation_codes') || [];
  const newCodes = [];
  for (let i = 0; i < count; i++) {
    const raw = [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
    const code = raw.match(/.{4}/g).join('-');
    codes.push({ code, type, used: false, created: new Date().toISOString() });
    newCodes.push(code);
  }
  await setData('activation_codes', codes);
  res.json({ ok: true, codes: newCodes, count: newCodes.length });
});

app.post('/api/admin/codes', async (req, res) => {
  if (req.body.master_key !== MASTER_KEY) return res.status(403).json({ ok: false, msg: '授权失败' });
  const codes = await getData('activation_codes') || [];
  res.json({ ok: true, codes: codes.reverse() });
});

app.post('/api/admin/delete_code', async (req, res) => {
  if (req.body.master_key !== MASTER_KEY) return res.status(403).json({ ok: false, msg: '授权失败' });
  let codes = await getData('activation_codes') || [];
  codes = codes.filter(c => c.code !== req.body.code);
  await setData('activation_codes', codes);
  res.json({ ok: true });
});

app.post('/api/admin/licenses', async (req, res) => {
  if (req.body.master_key !== MASTER_KEY) return res.status(403).json({ ok: false, msg: '授权失败' });
  const licenses = await getData('licenses') || {};
  const result = Object.entries(licenses).map(([key, val]) => ({ license_key: key, ...val }));
  res.json({ ok: true, licenses: result.sort((a, b) => new Date(b.activated_at) - new Date(a.activated_at)) });
});

app.post('/api/activate', async (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase();
  const deviceId = req.body.device_id || '';
  const codes = await getData('activation_codes') || [];
  const idx = codes.findIndex(c => c.code === code);
  if (idx === -1) return res.json({ ok: false, msg: '无效激活码' });
  if (codes[idx].used) return res.json({ ok: false, msg: '该激活码已被使用' });
  
  const durationMap = { month: 30, year: 365, lifetime: 36500 };
  const days = durationMap[codes[idx].type] || 30;
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const activatedAt = new Date().toISOString();
  codes[idx].used = true;
  codes[idx].device_id = deviceId;
  codes[idx].activated_at = activatedAt;
  await setData('activation_codes', codes);
  
  const licenses = await getData('licenses') || {};
  const licenseKey = Math.random().toString(36).slice(2, 10);
  licenses[licenseKey] = { code, device_id: deviceId, type: codes[idx].type, activated_at: activatedAt, expires_at: expiresAt };
  await setData('licenses', licenses);
  res.json({ ok: true, msg: '激活成功！', license_key: licenseKey, type: codes[idx].type, expires_at: expiresAt });
});

app.post('/api/verify', async (req, res) => {
  const deviceId = (req.body.device_id || '').trim();
  const licenses = await getData('licenses') || {};
  for (const lic of Object.values(licenses)) {
    if (lic.device_id === deviceId && new Date(lic.expires_at) > new Date()) {
      return res.json({ ok: true, valid: true, expires_at: lic.expires_at, type: lic.type });
    }
  }
  res.json({ ok: true, valid: false });
});

app.post('/api/auto_gen_code', async (req, res) => {
  if (req.body.secret !== 'chezhizhen_pay_2026') return res.status(403).json({ ok: false, msg: '签名错误' });
  const type = req.body.type || 'month';
  const paymentId = req.body.payment_id || 'auto_' + Math.random().toString(36).slice(2, 10);
  const codes = await getData('activation_codes') || [];
  const raw = [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
  const code = raw.match(/.{4}/g).join('-');
  codes.push({ code, type, used: false, paid: true, payment_id: paymentId, created: new Date().toISOString() });
  await setData('activation_codes', codes);
  res.json({ ok: true, code, type });
});

// ========== 诊断 API ==========
app.post('/api/scan/upload', async (req, res) => {
  const scanId = Math.random().toString(36).slice(2, 10);
  req.body.scan_id = scanId;
  req.body.timestamp = new Date().toISOString();
  const vin = req.body.vin || 'UNKNOWN';
  await appendToList(`vehicle_${vin}`, req.body);
  res.json({ ok: true, scan_id: scanId });
});

app.get('/api/vehicle/:vin', async (req, res) => {
  const records = await getData(`vehicle_${req.params.vin}`) || [];
  res.json({ ok: true, records: records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)) });
});

app.get('/api/vehicles', async (req, res) => {
  res.json({ ok: true, vehicles: [] });
});

app.post('/api/feedback', async (req, res) => {
  const fb = { ...req.body, timestamp: new Date().toISOString() };
  await appendToList('feedbacks', fb);
  res.json({ ok: true });
});

app.get('/api/feedback/stats', async (req, res) => {
  const feedbacks = await getData('feedbacks') || [];
  const total = feedbacks.length;
  const accurate = feedbacks.filter(f => f.diagnosis_accurate).length;
  const rate = total > 0 ? Math.round(accurate / total * 100 * 10) / 10 : 0;
  res.json({ ok: true, total, accurate, inaccurate: total - accurate, accuracy_rate: rate });
});

app.get('/api/pricing', (req, res) => {
  res.json({ ok: true, pricing: {
    month: { name: '月卡', days: 30, price: '联系管理员开通' },
    year: { name: '年卡', days: 365, price: '联系管理员开通' },
    lifetime: { name: '永久卡', days: 36500, price: '联系管理员开通' },
  }});
});

app.get('/', (req, res) => {
  res.json({ ok: true, msg: '车智诊 API v1.0 - Vercel' });
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, status: 'running', has_token: !!GITHUB_TOKEN, user: GITHUB_USER });
});

module.exports = app;
