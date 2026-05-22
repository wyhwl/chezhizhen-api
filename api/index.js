// 车智诊 API - Vercel Serverless 版本
// 数据存储在 GitHub Issues 中（免费）
// 环境变量需在 Vercel 项目设置中配置：
//   GITHUB_TOKEN - GitHub Personal Access Token
//   GITHUB_USER - GitHub 用户名
//   GITHUB_REPO - 数据仓库名（默认 chezhizhen-data）
//   MASTER_KEY - 管理员密钥

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_USER = process.env.GITHUB_USER || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'chezhizhen-data';
const MASTER_KEY = process.env.MASTER_KEY || 'yuehua888';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function error(msg, status = 400) {
  return json({ ok: false, msg }, status);
}

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
  try {
    return JSON.parse(issue.body);
  } catch {
    return null;
  }
}

async function setData(title, data) {
  const existing = await getIssueByTitle(title);
  const body = JSON.stringify(data, null, 2);
  if (existing) {
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/issues/${existing.number}`;
    await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
  } else {
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/issues`;
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, labels: DATA_LABELS }),
    });
  }
  return true;
}

async function appendToList(key, item) {
  let list = await getData(key);
  if (!list) list = [];
  if (!Array.isArray(list)) list = [];
  list.push(item);
  await setData(key, list);
  return list;
}

// ========== 激活码 API ==========

async function handleGenCode(body) {
  if (body.master_key !== MASTER_KEY) return error('授权失败', 403);
  const type = body.type || 'month';
  const count = body.count || 1;
  const codes = await getData('activation_codes') || [];
  const newCodes = [];
  for (let i = 0; i < count; i++) {
    const raw = [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
    const code = raw.match(/.{4}/g).join('-');
    codes.push({ code, type, used: false, created: new Date().toISOString() });
    newCodes.push(code);
  }
  await setData('activation_codes', codes);
  return json({ ok: true, codes: newCodes, count: newCodes.length });
}

async function handleListCodes(body) {
  if (body.master_key !== MASTER_KEY) return error('授权失败', 403);
  const codes = await getData('activation_codes') || [];
  return json({ ok: true, codes: codes.reverse() });
}

async function handleDeleteCode(body) {
  if (body.master_key !== MASTER_KEY) return error('授权失败', 403);
  let codes = await getData('activation_codes') || [];
  codes = codes.filter(c => c.code !== body.code);
  await setData('activation_codes', codes);
  return json({ ok: true });
}

async function handleListLicenses(body) {
  if (body.master_key !== MASTER_KEY) return error('授权失败', 403);
  const licenses = await getData('licenses') || {};
  const result = Object.entries(licenses).map(([key, val]) => ({
    license_key: key, ...val,
  }));
  return json({ ok: true, licenses: result.sort((a, b) => new Date(b.activated_at) - new Date(a.activated_at)) });
}

async function handleActivate(body) {
  const code = (body.code || '').trim().toUpperCase();
  const deviceId = body.device_id || '';
  const codes = await getData('activation_codes') || [];
  const idx = codes.findIndex(c => c.code === code);
  if (idx === -1) return error('无效激活码', 400);
  if (codes[idx].used) return error('该激活码已被使用', 400);
  
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
  licenses[licenseKey] = {
    code, device_id: deviceId, type: codes[idx].type,
    activated_at: activatedAt, expires_at: expiresAt,
  };
  await setData('licenses', licenses);

  return json({ ok: true, msg: '激活成功！', license_key: licenseKey, type: codes[idx].type, expires_at: expiresAt });
}

async function handleVerify(body) {
  const deviceId = (body.device_id || '').trim();
  const licenses = await getData('licenses') || {};
  for (const lic of Object.values(licenses)) {
    if (lic.device_id === deviceId) {
      const expires = new Date(lic.expires_at);
      if (expires > new Date()) {
        return json({ ok: true, valid: true, expires_at: lic.expires_at, type: lic.type });
      }
    }
  }
  return json({ ok: true, valid: false });
}

async function handleAutoGenCode(body) {
  if (body.secret !== 'chezhizhen_pay_2026') return error('签名错误', 403);
  const type = body.type || 'month';
  const paymentId = body.payment_id || 'auto_' + Math.random().toString(36).slice(2, 10);
  const codes = await getData('activation_codes') || [];
  const raw = [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
  const code = raw.match(/.{4}/g).join('-');
  codes.push({ code, type, used: false, paid: true, payment_id: paymentId, created: new Date().toISOString() });
  await setData('activation_codes', codes);
  return json({ ok: true, code, type });
}

// ========== 诊断 API ==========

async function handleUploadScan(body) {
  const scanId = Math.random().toString(36).slice(2, 10);
  body.scan_id = scanId;
  body.timestamp = new Date().toISOString();
  const vin = body.vin || 'UNKNOWN';
  const key = `vehicle_${vin}`;
  await appendToList(key, body);
  return json({ ok: true, scan_id: scanId });
}

async function handleGetVehicle(vin) {
  const records = await getData(`vehicle_${vin}`) || [];
  return json({ ok: true, records: records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)) });
}

async function handleListVehicles() {
  return json({ ok: true, vehicles: [] });
}

async function handleFeedback(body) {
  const fb = {
    scan_id: body.scan_id, vin: body.vin || '',
    actual_issue: body.actual_issue || '',
    actual_fix: body.actual_fix || '',
    diagnosis_accurate: body.diagnosis_accurate || false,
    notes: body.notes || '',
    timestamp: new Date().toISOString(),
  };
  await appendToList('feedbacks', fb);
  return json({ ok: true });
}

async function handleFeedbackStats() {
  const feedbacks = await getData('feedbacks') || [];
  const total = feedbacks.length;
  const accurate = feedbacks.filter(f => f.diagnosis_accurate).length;
  const rate = total > 0 ? Math.round(accurate / total * 100 * 10) / 10 : 0;
  return json({ ok: true, total, accurate, inaccurate: total - accurate, accuracy_rate: rate });
}

async function handlePricing() {
  return json({ ok: true, pricing: {
    month: { name: '月卡', days: 30, price: '联系管理员开通' },
    year: { name: '年卡', days: 365, price: '联系管理员开通' },
    lifetime: { name: '永久卡', days: 36500, price: '联系管理员开通' },
  }});
}

// ========== Vercel Serverless Handler ==========

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const method = req.method;
  let body = {};
  if (req.body) {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }

  try {
    if (!GITHUB_TOKEN || !GITHUB_USER) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, msg: '后端配置错误：请在 Vercel 环境变量中设置 GITHUB_TOKEN 和 GITHUB_USER' }));
      return;
    }

    let result;
    if (method === 'POST' && path === '/api/admin/gen_code') result = await handleGenCode(body);
    else if (method === 'POST' && path === '/api/admin/codes') result = await handleListCodes(body);
    else if (method === 'POST' && path === '/api/admin/delete_code') result = await handleDeleteCode(body);
    else if (method === 'POST' && path === '/api/admin/licenses') result = await handleListLicenses(body);
    else if (method === 'POST' && path === '/api/activate') result = await handleActivate(body);
    else if (method === 'POST' && path === '/api/verify') result = await handleVerify(body);
    else if (method === 'POST' && path === '/api/auto_gen_code') result = await handleAutoGenCode(body);
    else if (method === 'POST' && path === '/api/scan/upload') result = await handleUploadScan(body);
    else if (method === 'GET' && path.startsWith('/api/vehicle/')) {
      const vin = path.replace('/api/vehicle/', '');
      result = await handleGetVehicle(vin);
    }
    else if (method === 'GET' && path === '/api/vehicles') result = await handleListVehicles();
    else if (method === 'POST' && path === '/api/feedback') result = await handleFeedback(body);
    else if (method === 'GET' && path === '/api/feedback/stats') result = await handleFeedbackStats();
    else if (method === 'GET' && path === '/api/pricing') result = await handlePricing();
    else result = json({ ok: false, msg: '未知接口' }, 404);

    const data = await result.json();
    res.writeHead(result.status, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (e) {
    res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, msg: e.message }));
  }
}
