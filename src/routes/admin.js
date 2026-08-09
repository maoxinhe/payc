/**
 * Admin 路由 — 管理后台 API 和页面（带密码认证）
 */
import { Hono } from 'hono';
import { getConfig, setConfig, setQrcodeImage, getQrcodeImage, createUser, listUsers, deleteUser, getUserById, listWebhooks, createOrder, getOrder, getFeePercent, setFeePercent, listPendingOrders, deleteOrder, deleteWebhookRaw, listKeys, listWorkOrders, getWorkOrder, updateWorkOrder, adminAdjustBalance, writeJSON, deleteWorkOrder } from '../storage';

const admin = new Hono();

// 获取管理员密码（从 KV 读取）
async function getAdminPassword(c) {
  return await c.env.SECRETS_KV.get('ADMIN_PASSWORD');
}

// 检测是否为浏览器 GET 请求
function isPageRequest(c) {
  return c.req.method === 'GET' && (c.req.header('Accept') || '').includes('text/html');
}

// 验证管理员认证
async function checkAuth(c) {
  const token = c.req.query('token') || c.req.header('X-Admin-Token');
  const password = await getAdminPassword(c);
  return password && token === password;
}

// 管理员认证中间件
async function authMiddleware(c, next) {
  if (checkAuth(c)) {
    await next();
  } else {
    return c.json({ error: '未授权访问' }, 401);
  }
}

// ==================== 管理后台 API ====================

// 测试路由
admin.get('/api/admin/test', authMiddleware, async (c) => {
  return c.json({ message: 'test' });
});

// 获取未完成订单
admin.get('/api/admin/pending-orders', authMiddleware, async (c) => {
  const orders = await listPendingOrders(c.env.PAY_BUCKET);
  return c.json(orders);
});

// ==================== 收款码配置（管理后台） ====================

// 获取配置
admin.get('/api/admin/config', authMiddleware, async (c) => {
  const config = await getConfig(c.env.PAY_BUCKET);
  return c.json(config);
});

// 更新配置（URL 方式）
admin.post('/api/admin/config', authMiddleware, async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch (e) {
    return c.json({ error: '请求体格式错误' }, 400);
  }
  await setConfig(c.env.PAY_BUCKET, body.qrcodeUrl || '');
  return c.json({ success: true });
});

// 上传收款码图片
admin.post('/api/admin/qrcode/upload', authMiddleware, async (c) => {
  try {
    const contentType = c.req.header('Content-Type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return c.json({ error: '请上传图片文件，Content-Type: ' + contentType }, 400);
    }
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!file) {
      return c.json({ error: '未找到上传的文件' }, 400);
    }
    const arrayBuffer = await file.arrayBuffer();
    const imageType = file.type || 'image/png';
    console.log('[Upload] File size: ' + arrayBuffer.byteLength + ', type: ' + imageType);
    await setQrcodeImage(c.env.PAY_BUCKET, arrayBuffer, imageType);
    return c.json({ success: true, size: arrayBuffer.byteLength });
  } catch (e) {
    console.error('[Upload] Error: ' + e.message);
    return c.json({ error: '上传失败: ' + e.message }, 400);
  }
});

// ==================== 公开接口（付款页面使用） ====================

// 获取收款码配置（公开）
admin.get('/api/config', async (c) => {
  const config = await getConfig(c.env.PAY_BUCKET);
  return c.json(config);
});

// 获取收款码图片（公开）
admin.get('/api/qrcode-image', async (c) => {
  const img = await getQrcodeImage(c.env.PAY_BUCKET);
  if (!img) return c.body(null, 404);
  return new Response(img.data, {
    headers: {
      'Content-Type': img.contentType || 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

// 获取手续费比例
admin.get('/api/admin/fee', authMiddleware, async (c) => {
  const percent = await getFeePercent(c.env.PAY_BUCKET);
  return c.json({ percent });
});

// 设置手续费比例
admin.post('/api/admin/fee', authMiddleware, async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch (e) {
    return c.json({ error: '请求体格式错误' }, 400);
  }
  const percent = parseFloat(body.percent);
  if (isNaN(percent) || percent < 0 || percent > 100) {
    return c.json({ error: '手续费比例必须在 0-100 之间' }, 400);
  }
  await setFeePercent(c.env.PAY_BUCKET, percent);
  return c.json({ success: true, percent });
});

// 获取用户列表
admin.get('/api/admin/users', authMiddleware, async (c) => {
  const users = await listUsers(c.env.PAY_BUCKET);
  return c.json(users);
});

// 创建用户
admin.post('/api/admin/users', authMiddleware, async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch (e) {
    return c.json({ error: '请求体格式错误' }, 400);
  }
  const user = await createUser(c.env.PAY_BUCKET, body.username, body.password);
  return c.json(user);
});

// 删除用户
admin.delete('/api/admin/users/:userId', authMiddleware, async (c) => {
  const { userId } = c.req.param();
  await deleteUser(c.env.PAY_BUCKET, userId);
  return c.json({ success: true });
});

// 获取 Webhook 记录
admin.get('/api/admin/webhooks', authMiddleware, async (c) => {
  const records = await listWebhooks(c.env.PAY_BUCKET);
  return c.json(records);
});

// ==================== 订单管理 ====================

// 标记订单完成（必须在 /:orderId 之前定义）
admin.post('/api/admin/orders/:orderId/complete', authMiddleware, async (c) => {
  const { orderId } = c.req.param();
  const order = await getOrder(c.env.PAY_BUCKET, orderId);
  if (!order) return c.json({ error: '订单不存在' }, 404);
  order.status = 'completed';
  order.completedAt = Date.now();
  await writeJSON(c.env.PAY_BUCKET, `orders/${orderId}.json`, order);
  return c.json({ success: true });
});

// 获取订单信息
admin.get('/api/admin/orders/:orderId', authMiddleware, async (c) => {
  const { orderId } = c.req.param();
  const order = await getOrder(c.env.PAY_BUCKET, orderId);
  if (!order) return c.json({ error: '订单不存在' }, 404);
  return c.json(order);
});

// 删除订单
admin.delete('/api/admin/orders/:orderId', authMiddleware, async (c) => {
  const { orderId } = c.req.param();
  const order = await getOrder(c.env.PAY_BUCKET, orderId);
  if (!order) return c.json({ error: '订单不存在' }, 404);
  await deleteOrder(c.env.PAY_BUCKET, orderId);
  return c.json({ success: true });
});

// 删除所有 webhook 消息
admin.delete('/api/admin/webhooks', authMiddleware, async (c) => {
  const keys = await listKeys(c.env.PAY_BUCKET, 'webhooks/');
  for (const key of keys) {
    await c.env.PAY_BUCKET.delete(key);
  }
  return c.json({ success: true, deleted: keys.length });
});

// 删除单条 webhook 原始消息
admin.delete('/api/admin/webhooks/:key', authMiddleware, async (c) => {
  const key = decodeURIComponent(c.req.param('key'));
  await deleteWebhookRaw(c.env.PAY_BUCKET, key);
  return c.json({ success: true });
});

// ==================== 工单管理 ====================

// 获取所有工单
admin.get('/api/admin/workorders', authMiddleware, async (c) => {
  const status = c.req.query('status');
  const orders = await listWorkOrders(c.env.PAY_BUCKET, null, status);
  for (const o of orders) {
    const user = await getUserById(c.env.PAY_BUCKET, o.userId);
    o.username = user ? user.username : '未知用户';
  }
  return c.json(orders);
});

// 回复/更新工单
admin.post('/api/admin/workorders/:id/reply', authMiddleware, async (c) => {
  const { id } = c.req.param();
  let body;
  try {
    body = await c.req.json();
  } catch (e) {
    return c.json({ error: '请求体格式错误' }, 400);
  }
  const adminReply = body.adminReply;
  const status = body.status;
  const updates = {};
  if (adminReply) updates.adminReply = adminReply;
  if (status) updates.status = status;
  updates.repliedAt = Date.now();
  const order = await updateWorkOrder(c.env.PAY_BUCKET, id, updates);
  if (!order) return c.json({ error: '工单不存在' }, 404);
  return c.json({ success: true, workOrder: order });
});

// 删除工单
admin.delete('/api/admin/workorders/:id', authMiddleware, async (c) => {
  const { id } = c.req.param();
  await deleteWorkOrder(c.env.PAY_BUCKET, id);
  return c.json({ success: true });
});

// ==================== 余额管理 ====================

// 调整用户余额
admin.post('/api/admin/users/:userId/balance', authMiddleware, async (c) => {
  const { userId } = c.req.param();
  let body;
  try {
    body = await c.req.json();
  } catch (e) {
    return c.json({ error: '请求体格式错误' }, 400);
  }
  const amount = parseFloat(body.amount);
  const reason = body.reason || '';
  if (isNaN(amount)) {
    return c.json({ error: '请输入有效金额' }, 400);
  }
  try {
    const user = await adminAdjustBalance(c.env.PAY_BUCKET, userId, amount, reason);
    return c.json({ success: true, balance: user.balance });
  } catch (e) {
    return c.json({ error: e.message }, 400);
  }
});

// ==================== 登录页面 ====================

admin.get('/admin', (c) => {
  if (checkAuth(c)) {
    return c.html(ADMIN_HTML);
  }
  return c.html(LOGIN_HTML);
});

// 登录接口
admin.post('/api/admin/login', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch (e) {
    return c.json({ error: '请求体格式错误' }, 400);
  }
  const password = await getAdminPassword(c);
  const username = await c.env.SECRETS_KV.get('ADMIN_USERNAME');
  if (username && password && body.username === username && body.password === password) {
    return c.json({ success: true, token: password });
  }
  return c.json({ error: '用户名或密码错误' }, 401);
});

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>管理后台登录</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh}
.login-box{background:#fff;padding:40px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);width:320px}
h2{text-align:center;margin-bottom:24px}
input{width:100%;padding:10px;border:1px solid #ddd;border-radius:4px;margin-bottom:16px;font-size:14px;box-sizing:border-box}
button{width:100%;padding:10px;background:#1677ff;color:#fff;border:none;border-radius:4px;font-size:14px;cursor:pointer}
button:hover{background:#4096ff}
</style>
</head>
<body>
<div class="login-box">
<h2>管理后台登录</h2>
<input type="text" id="username" placeholder="请输入用户名" onkeypress="if(event.key==='Enter')document.getElementById('pwd').focus()">
<input type="password" id="pwd" placeholder="请输入密码" onkeypress="if(event.key==='Enter')login()">
<button onclick="login()">登录</button>
</div>
<script>
function login(){
  var username=document.getElementById('username').value;
  var pwd=document.getElementById('pwd').value;
  if(!username||!pwd){alert('请输入用户名和密码');return}
  fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username,password:pwd})})
    .then(function(r){return r.json()})
    .then(function(d){
      if(d.token){
        localStorage.setItem('admin_token',d.token);
        var url=new URL(location.href);
        url.searchParams.set('token',d.token);
        location.href=url.toString();
      }else{
        alert(d.error||'登录失败');
      }
    });
}
document.getElementById('username').focus();
</script>
</body>
</html>`;

// ==================== 管理后台页面 ====================

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>管理后台</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#333}
.container{max-width:900px;margin:0 auto;padding:20px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
h1{font-size:22px}
.section{background:#fff;border-radius:8px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.section h2{font-size:16px;margin-bottom:12px}
.btn{padding:8px 16px;border:none;border-radius:4px;font-size:14px;cursor:pointer}
.btn-primary{background:#1677ff;color:#fff}
.btn-primary:hover{background:#4096ff}
.btn-secondary{background:#fff;color:#1677ff;border:1px solid #1677ff}
.btn-secondary:hover{background:#e6f0ff}
.btn-danger{color:#ff4d4f;border:1px solid #ff4d4f;background:#fff}
.btn-danger:hover{background:#fff1f0}
.btn-buy{padding:6px 12px;font-size:13px}
input,select,textarea{padding:8px 12px;border:1px solid #ddd;border-radius:4px;font-size:14px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:10px;text-align:left;border-bottom:1px solid #eee}
th{background:#fafafa;font-weight:600}
.api-key{font-family:monospace;font-size:12px;color:#666}
.status{padding:2px 8px;border-radius:10px;font-size:12px}
.status-matched{background:#f6ffed;color:#52c41a}
.status-unmatched{background:#fff7e6;color:#fa8c16}
.status-completed{background:#e6f7ff;color:#1677ff}
.toast{position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:4px;color:#fff;font-size:14px;z-index:1000}
.toast-success{background:#52c41a}
.toast-error{background:#ff4d4f}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>管理后台</h1>
</div>

<div class="section">
<h2>用户管理</h2>
<div style="margin-bottom:12px">
<input type="text" id="newUsername" placeholder="用户名" style="width:150px;margin-right:8px">
<input type="text" id="newPassword" placeholder="密码" style="width:150px;margin-right:8px">
<button class="btn btn-primary" onclick="createUser()">创建用户</button>
</div>
<table id="userTable">
<thead><tr><th>用户名</th><th>API Key</th><th>余额</th><th>创建时间</th><th>操作</th></tr></thead>
<tbody></tbody>
</table>
</div>

<div class="section">
<h2>手续费设置</h2>
<div style="display:flex;align-items:center;gap:12px">
<input type="number" id="feePercent" placeholder="手续费比例" min="0" max="100" style="width:120px">
<span>%</span>
<button class="btn btn-primary" onclick="saveFee()">保存</button>
</div>
<div id="feeStatus" style="font-size:13px;color:#52c41a;display:none;margin-top:8px"></div>
</div>

<div class="section">
<h2>收款码设置</h2>
<p style="font-size:13px;color:#999;margin-bottom:12px">设置付款页面显示的收款二维码</p>
<div style="margin-bottom:12px">
<input type="text" id="qrcodeUrl" placeholder="输入收款码图片链接" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:4px;font-size:14px;margin-bottom:8px;box-sizing:border-box">
<button class="btn btn-primary" onclick="saveQrcodeUrl()">保存链接</button>
</div>
<div style="margin-bottom:12px;text-align:center;color:#999;font-size:13px">— 或 —</div>
<div style="margin-bottom:12px">
<input type="file" id="qrcodeFile" accept="image/*" style="display:none" onchange="uploadQrcode(this)">
<button class="btn btn-secondary" onclick="document.getElementById('qrcodeFile').click()">上传收款码图片</button>
<span id="qrcodeFileName" style="font-size:13px;color:#666;margin-left:8px"></span>
</div>
<div id="qrcodePreview" style="text-align:center;margin-top:12px">
<img id="qrcodeImgPreview" src="" alt="当前收款码" style="max-width:200px;max-height:200px;border:1px solid #ddd;border-radius:8px;display:none">
<p id="qrcodeEmpty" style="font-size:13px;color:#999">未设置收款码</p>
</div>
</div>

<div class="section">
<h2>未完成订单管理</h2>
<p style="font-size:13px;color:#999;margin-bottom:12px">管理当前所有待支付的订单，可手动标记完成或删除</p>
<button class="btn btn-primary" onclick="loadPendingOrders()" style="margin-bottom:12px">刷新订单列表</button>
<div id="orderList"></div>
</div>

<div class="section">
<h2>工单管理</h2>
<div style="margin-bottom:12px">
<button class="btn btn-primary" onclick="loadWorkOrders()">刷新</button>
<select id="workorderFilter" onchange="loadWorkOrders()" style="margin-left:8px;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px">
<option value="">全部状态</option>
<option value="open">待处理</option>
<option value="processing">处理中</option>
<option value="closed">已关闭</option>
</select>
</div>
<div id="workorderList" style="font-size:13px">加载中...</div>
</div>

<div class="section">
<h2>Webhook 消息记录</h2>
<button class="btn btn-primary" onclick="loadWebhooks()" style="margin-bottom:12px">刷新</button>
<button class="btn btn-danger" onclick="clearAllWebhooks()" style="margin-bottom:12px;margin-left:8px">清空全部</button>
<div id="webhookList"></div>
</div>
</div>

<script>
var usersData = [];

function api(path, opts) {
  opts = opts || {};
  var headers = opts.headers || {};
  headers['X-Admin-Token'] = localStorage.getItem('admin_token') || '';
  return fetch(path, Object.assign({}, opts, { headers: headers }));
}

function showToast(msg, type) {
  var t = document.createElement('div');
  t.className = 'toast toast-' + (type || 'success');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function() { t.remove(); }, 3000);
}

// ===== 配置管理 =====

async function loadConfig() {
  try {
    var r = await api('/api/admin/config');
    var config = await r.json();
    // 配置加载成功（目前没有需要显示的配置项）
  } catch(e) {
    console.error('loadConfig error:', e);
  }
}

// ===== 用户管理 =====

async function loadUsers() {
  try {
    var r = await api('/api/admin/users');
    usersData = await r.json();
    renderUserTable();
  } catch(e) {
    console.error('loadUsers error:', e);
  }
}

function renderUserTable() {
  var tbody = document.querySelector('#userTable tbody');
  tbody.innerHTML = usersData.map(function(u) {
    var delBtn = '<button class="btn btn-danger btn-delete-user" data-user-id="' + u.userId + '" style="padding:4px 8px;font-size:12px">删除</button>';
    var adjBtn = '<button class="btn btn-secondary btn-adjust-balance" data-user-id="' + u.userId + '" data-username="' + u.username + '" style="padding:4px 8px;font-size:12px;margin-right:4px">调余额</button>';
    return '<tr><td>' + u.username + '</td><td><span class="api-key">' + u.apiKey + '</span></td><td>￥' + (u.balance || 0).toFixed(2) + '</td><td>' + new Date(u.createdAt).toLocaleString('zh-CN') + '</td><td>' + adjBtn + delBtn + '</td></tr>';
  }).join('');

  tbody.querySelectorAll('.btn-delete-user').forEach(function(btn) {
    btn.addEventListener('click', function() { doDeleteUser(this.getAttribute('data-user-id')); });
  });

  tbody.querySelectorAll('.btn-adjust-balance').forEach(function(btn) {
    btn.addEventListener('click', function() { showBalanceModal(this.getAttribute('data-user-id'), this.getAttribute('data-username')); });
  });
}

async function doDeleteUser(userId) {
  if (!confirm('确定要删除该用户吗？此操作不可恢复。')) return;
  try {
    var r = await api('/api/admin/users/' + userId, { method: 'DELETE' });
    if (r.ok) {
      showToast('用户已删除', 'success');
      loadUsers();
    } else {
      var d = await r.json();
      showToast(d.error || '删除失败', 'error');
    }
  } catch(e) {
    showToast('网络错误', 'error');
  }
}

function showBalanceModal(userId, username) {
  var newline = '\\n';
  var msg = '【' + username + '】调整余额' + newline + newline + '正数为增加，负数为减少' + newline + '请输入金额（元）：';
  var amount = prompt(msg);
  if (amount === null || amount.trim() === '') return;
  var num = parseFloat(amount);
  if (isNaN(num) || num === 0) {
    showToast('请输入有效金额', 'error');
    return;
  }
  var reason = prompt('请输入调整原因（可选）：') || '';
  adjustUserBalance(userId, num, reason);
}

async function adjustUserBalance(userId, amount, reason) {
  try {
    var body = { amount: amount, reason: reason };
    var r = await api('/api/admin/users/' + userId + '/balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var d = await r.json();
    if (r.ok) {
      showToast('余额调整成功，当前余额：￥' + d.balance.toFixed(2), 'success');
      loadUsers();
    } else {
      showToast(d.error || '调整失败', 'error');
    }
  } catch(e) {
    showToast('网络错误', 'error');
  }
}

async function createUser() {
  var username = document.getElementById('newUsername').value.trim();
  var password = document.getElementById('newPassword').value.trim();
  if (!username || !password) {
    showToast('请填写用户名和密码', 'error');
    return;
  }
  try {
    var r = await api('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { username: username, password: password }
    });
    var d = await r.json();
    if (r.ok) {
      showToast('用户创建成功，API Key: ' + d.apiKey, 'success');
      document.getElementById('newUsername').value = '';
      document.getElementById('newPassword').value = '';
      loadUsers();
    } else {
      showToast(d.error || '创建失败', 'error');
    }
  } catch(e) {
    showToast('网络错误', 'error');
  }
}

// ===== 手续费管理 =====

async function loadFee() {
  try {
    var r = await api('/api/admin/fee');
    var d = await r.json();
    document.getElementById('feePercent').value = d.percent;
  } catch(e) {
    console.error('loadFee error:', e);
  }
}

async function saveFee() {
  var percent = document.getElementById('feePercent').value;
  try {
    var r = await api('/api/admin/fee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ percent: parseFloat(percent) })
    });
    if (r.ok) {
      showToast('手续费已设置为 ' + percent + '%', 'success');
    } else {
      var d = await r.json();
      showToast(d.error || '设置失败', 'error');
    }
  } catch(e) {
    showToast('网络错误', 'error');
  }
}

// ===== 收款码管理 =====

async function loadQrcode() {
  try {
    var r = await api('/api/admin/config');
    var config = await r.json();
    if (config.qrcodeUrl) {
      document.getElementById('qrcodeUrl').value = config.qrcodeUrl;
      document.getElementById('qrcodeImgPreview').src = config.qrcodeUrl;
      document.getElementById('qrcodeImgPreview').style.display = 'inline';
      document.getElementById('qrcodeEmpty').style.display = 'none';
    } else if (config.qrcodeImageKey) {
      document.getElementById('qrcodeImgPreview').src = '/api/qrcode-image';
      document.getElementById('qrcodeImgPreview').style.display = 'inline';
      document.getElementById('qrcodeEmpty').style.display = 'none';
    }
  } catch(e) {
    console.error('loadQrcode error:', e);
  }
}

async function saveQrcodeUrl() {
  var url = document.getElementById('qrcodeUrl').value.trim();
  if (!url) {
    showToast('请输入收款码链接', 'error');
    return;
  }
  try {
    var r = await api('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qrcodeUrl: url })
    });
    if (r.ok) {
      showToast('收款码链接已保存', 'success');
      document.getElementById('qrcodeImgPreview').src = url;
      document.getElementById('qrcodeImgPreview').style.display = 'inline';
      document.getElementById('qrcodeEmpty').style.display = 'none';
    } else {
      var d = await r.json();
      showToast(d.error || '保存失败', 'error');
    }
  } catch(e) {
    showToast('网络错误', 'error');
  }
}

async function uploadQrcode(input) {
  var file = input.files[0];
  if (!file) return;
  document.getElementById('qrcodeFileName').textContent = file.name;
  
  var formData = new FormData();
  formData.append('file', file);
  
  try {
    var r = await fetch('/api/admin/qrcode/upload', {
      method: 'POST',
      headers: { 'X-Admin-Token': localStorage.getItem('admin_token') || '' },
      body: formData
    });
    if (r.ok) {
      showToast('收款码图片已上传', 'success');
      document.getElementById('qrcodeImgPreview').src = '/api/qrcode-image?' + Date.now();
      document.getElementById('qrcodeImgPreview').style.display = 'inline';
      document.getElementById('qrcodeEmpty').style.display = 'none';
      document.getElementById('qrcodeUrl').value = '';
    } else {
      var d = await r.json();
      showToast(d.error || '上传失败', 'error');
    }
  } catch(e) {
    showToast('网络错误', 'error');
  }
  input.value = '';
}

// ===== 订单管理 =====

async function loadPendingOrders() {
  try {
    var r = await api('/api/admin/pending-orders');
    var orders = await r.json();
    var div = document.getElementById('orderList');
    if (!orders.length) {
      div.innerHTML = '<p style="color:#999;font-size:13px">暂无未完成订单</p>';
      return;
    }
    var html = '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#fafafa"><th style="padding:8px;text-align:left">订单号</th><th style="padding:8px;text-align:left">金额</th><th style="padding:8px;text-align:left">类型</th><th style="padding:8px;text-align:left">创建时间</th><th style="padding:8px;text-align:left">操作</th></tr></thead><tbody>';
    orders.forEach(function(o) {
      var typeLabel = o.orderType === 'recharge' ? '<span style="color:#52c41a">充值</span>' : '<span style="color:#1677ff">商户</span>';
      var completeBtn = '<button class="btn btn-primary btn-complete" data-order-id="' + o.orderId + '" style="padding:4px 10px;font-size:12px;margin-right:4px">标记完成</button>';
      var deleteBtn = '<button class="btn btn-danger btn-delete-order" data-order-id="' + o.orderId + '" style="padding:4px 10px;font-size:12px">删除</button>';
      html += '<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:8px;font-family:monospace">' + o.orderId + '</td><td style="padding:8px">￥' + o.amount.toFixed(2) + '</td><td style="padding:8px">' + typeLabel + '</td><td style="padding:8px">' + new Date(o.createdAt).toLocaleString('zh-CN') + '</td><td style="padding:8px">' + completeBtn + deleteBtn + '</td></tr>';
    });
    html += '</tbody></table>';
    div.innerHTML = html;

    div.querySelectorAll('.btn-complete').forEach(function(btn) {
      btn.addEventListener('click', function() { completeOrder(this.getAttribute('data-order-id')); });
    });
    div.querySelectorAll('.btn-delete-order').forEach(function(btn) {
      btn.addEventListener('click', function() { deleteOrder(this.getAttribute('data-order-id')); });
    });
  } catch(e) {
    console.error('loadPendingOrders error:', e);
  }
}

async function completeOrder(orderId) {
  if (!confirm('确定要将订单 ' + orderId + ' 标记为已完成吗？')) return;
  try {
    var r = await api('/api/admin/orders/' + orderId + '/complete', { method: 'POST' });
    if (r.ok) {
      showToast('订单已标记完成', 'success');
      loadPendingOrders();
    } else {
      var d = await r.json();
      showToast(d.error || '操作失败', 'error');
    }
  } catch(e) {
    showToast('网络错误', 'error');
  }
}

async function deleteOrder(orderId) {
  if (!confirm('确定要删除订单 ' + orderId + ' 吗？此操作不可恢复。')) return;
  try {
    var r = await api('/api/admin/orders/' + orderId, { method: 'DELETE' });
    if (r.ok) {
      showToast('订单已删除', 'success');
      loadPendingOrders();
    } else {
      var d = await r.json();
      showToast(d.error || '删除失败', 'error');
    }
  } catch(e) {
    showToast('网络错误', 'error');
  }
}

// ===== Webhook 管理 =====

async function loadWebhooks() {
  try {
    var r = await api('/api/admin/webhooks');
    var webhooks = await r.json();
    var list = document.getElementById('webhookList');
    if (!webhooks.length) {
      list.innerHTML = '<div style="color:#999">暂无记录</div>';
      return;
    }
    var html = '';
    webhooks.forEach(function(w) {
      var sc = w.matchResult === 'matched' ? 'status-matched' : (w.matchResult === 'already_completed' ? 'status-completed' : 'status-unmatched');
      var st = w.matchResult === 'matched' ? '已匹配' : (w.matchResult === 'already_completed' ? '已完成' : '未匹配');
      var extra = w.matchedOrderId ? ' 订单: ' + w.matchedOrderId : '';
      var key = w.key || '';
      var delBtn = key ? '<button class="btn btn-danger btn-delete-webhook" data-webhook-key="' + key + '" style="padding:2px 8px;font-size:11px;float:right">删除</button>' : '';
      html += '<div class="webhook-item" style="padding:8px 0;border-bottom:1px solid #f0f0f0"><div>' + delBtn + '<span class="status ' + sc + '">' + st + '</span>' + extra + ' <span style="color:#999;margin-left:12px">' + new Date(w.timestamp).toLocaleString('zh-CN') + '</span></div><pre style="margin-top:6px;padding:8px;background:#f5f5f5;border-radius:4px;font-size:12px;overflow-x:auto">' + JSON.stringify(w.rawData, null, 2) + '</pre></div>';
    });
    list.innerHTML = html;

    list.querySelectorAll('.btn-delete-webhook').forEach(function(btn) {
      btn.addEventListener('click', function() { deleteWebhook(this.getAttribute('data-webhook-key')); });
    });
  } catch(e) {
    console.error('loadWebhooks error:', e);
  }
}

async function deleteWebhook(key) {
  if (!confirm('确定要删除这条 Webhook 消息吗？')) return;
  try {
    var r = await api('/api/admin/webhooks/' + encodeURIComponent(key), { method: 'DELETE' });
    if (r.ok) {
      showToast('已删除', 'success');
      loadWebhooks();
    } else {
      showToast('删除失败', 'error');
    }
  } catch(e) {
    showToast('网络错误', 'error');
  }
}

async function clearAllWebhooks() {
  if (!confirm('确定要清空所有 Webhook 消息吗？此操作不可恢复。')) return;
  try {
    var r = await api('/api/admin/webhooks', { method: 'DELETE' });
    if (r.ok) {
      showToast('已清空', 'success');
      loadWebhooks();
    } else {
      showToast('清空失败', 'error');
    }
  } catch(e) {
    showToast('网络错误', 'error');
  }
}

// ===== 工单管理 =====

async function loadWorkOrders() {
  var status = document.getElementById('workorderFilter') ? document.getElementById('workorderFilter').value : '';
  try {
    var url = '/api/admin/workorders' + (status ? '?status=' + status : '');
    var r = await api(url);
    var orders = await r.json();
    var div = document.getElementById('workorderList');
    if (!orders.length) {
      div.innerHTML = '<div style="color:#999">暂无工单</div>';
      return;
    }
    var typeMap = { support: '技术支持', bug: 'Bug反馈', feature: '功能建议', other: '其他' };
    var statusMap = { open: '待处理', processing: '处理中', closed: '已关闭' };
    var statusColor = { open: '#fa8c16', processing: '#1677ff', closed: '#52c41a' };
    var html = '<div style="display:flex;flex-direction:column;gap:8px">';
    orders.forEach(function(o) {
      html += '<div style="padding:12px;background:#fafafa;border-radius:4px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><strong>' + o.title + '</strong><span style="font-size:12px;color:' + statusColor[o.status] + '">' + statusMap[o.status] + '</span></div>';
      html += '<div style="font-size:12px;color:#999;margin-bottom:4px">用户: ' + (o.username || '未知') + ' · ' + typeMap[o.type] + ' · ' + new Date(o.createdAt).toLocaleString('zh-CN') + '</div>';
      html += '<div style="font-size:13px;color:#666;margin-bottom:8px">' + o.content + '</div>';
      if (o.adminReply) {
        html += '<div style="padding:8px;background:#e6f7ff;border-radius:4px;font-size:13px;color:#1677ff;margin-bottom:8px"><strong>管理员回复：</strong>' + o.adminReply + '<div style="font-size:11px;color:#999;margin-top:4px">' + new Date(o.repliedAt).toLocaleString('zh-CN') + '</div></div>';
      }
      html += '<div style="display:flex;gap:8px;align-items:center">';
      html += '<input type="text" placeholder="回复内容..." class="reply-input" data-workorder-id="' + o.id + '" style="flex:1;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px">';
      html += '<button class="btn btn-primary btn-reply-workorder" data-workorder-id="' + o.id + '" style="padding:6px 12px;font-size:12px">回复</button>';
      html += '<select class="status-select" data-workorder-id="' + o.id + '" style="padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:12px">';
      html += '<option value="open"' + (o.status === 'open' ? ' selected' : '') + '>待处理</option>';
      html += '<option value="processing"' + (o.status === 'processing' ? ' selected' : '') + '>处理中</option>';
      html += '<option value="closed"' + (o.status === 'closed' ? ' selected' : '') + '>已关闭</option>';
      html += '</select>';
      html += '<button class="btn btn-danger btn-delete-workorder" data-workorder-id="' + o.id + '" style="padding:6px 12px;font-size:12px">删除</button>';
      html += '</div></div>';
    });
    html += '</div>';
    div.innerHTML = html;

    div.querySelectorAll('.btn-reply-workorder').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = this.getAttribute('data-workorder-id');
        var input = div.querySelector('.reply-input[data-workorder-id="' + id + '"]');
        var select = div.querySelector('.status-select[data-workorder-id="' + id + '"]');
        replyWorkOrder(id, input.value, select.value);
      });
    });

    div.querySelectorAll('.btn-delete-workorder').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = this.getAttribute('data-workorder-id');
        deleteWorkOrder(id);
      });
    });
  } catch(e) {
    console.error('loadWorkOrders error:', e);
  }
}

async function deleteWorkOrder(id) {
  if (!confirm('确定要删除这个工单吗？此操作不可恢复。')) return;
  try {
    var r = await api('/api/admin/workorders/' + id, { method: 'DELETE' });
    if (r.ok) {
      showToast('工单已删除', 'success');
      loadWorkOrders();
    } else {
      showToast('删除失败', 'error');
    }
  } catch(e) {
    showToast('网络错误', 'error');
  }
}

async function replyWorkOrder(id, reply, status) {
  if (!reply && !status) {
    showToast('请输入回复内容或更改状态', 'error');
    return;
  }
  try {
    var body = { adminReply: reply, status: status };
    var r = await api('/api/admin/workorders/' + id + '/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    var d = await r.json();
    if (r.ok) {
      showToast('回复成功', 'success');
      loadWorkOrders();
    } else {
      showToast(d.error || '回复失败', 'error');
    }
  } catch(e) {
    showToast('网络错误', 'error');
  }
}

// 初始化
loadConfig();
loadUsers();
loadWebhooks();
loadFee();
loadQrcode();
loadPendingOrders();
loadWorkOrders();
</script>
</body>
</html>`;

export default admin;