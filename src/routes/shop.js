/**
 * 商城路由 — 用户充值中心（余额、API Key、充值、工单）
 */
import { Hono } from 'hono';
import { getUserById, createOrder, getFeePercent, createWorkOrder, listWorkOrders } from '../storage';

const shop = new Hono();

// 商城主页
shop.get('/shop', async (c) => {
  return c.html(SHOP_HTML);
});

// 获取当前用户信息（含 API Key 和余额）
shop.get('/api/shop/me', async (c) => {
  const token = c.req.header('X-User-Token') || c.req.query('token');
  if (!token) return c.json({ error: '未登录' }, 401);
  const user = await getUserById(c.env.PAY_BUCKET, token);
  if (!user) return c.json({ error: '未登录' }, 401);
  return c.json({
    userId: user.userId,
    username: user.username,
    apiKey: user.apiKey,
    balance: user.balance,
    createdAt: user.createdAt,
  });
});

// 创建充值订单
shop.post('/api/shop/recharge', async (c) => {
  const token = c.req.header('X-User-Token') || c.req.query('token');
  if (!token) return c.json({ error: '未登录' }, 401);
  const user = await getUserById(c.env.PAY_BUCKET, token);
  if (!user) return c.json({ error: '未登录' }, 401);

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '请求格式错误' }, 400);
  }
  const amount = parseFloat(body.amount);
  if (!amount || amount <= 0) {
    return c.json({ error: '金额必须大于 0' }, 400);
  }
  if (amount < 0.01) {
    return c.json({ error: '最低充值 0.01 元' }, 400);
  }

  // 充值订单：标记为 recharge，不计手续费
  const order = await createOrder(c.env.PAY_BUCKET, user.userId, amount, 'recharge', '余额充值');
  const url = new URL(c.req.url);
  const payUrl = `${url.protocol}//${url.host}/pay/${order.orderId}`;

  return c.json({
    orderId: order.orderId,
    amount: order.amount,
    requestedAmount: order.requestedAmount || order.amount,
    payUrl,
    status: order.status,
    createdAt: order.createdAt,
  });
});

// ==================== 工单系统 ====================

// 提交工单
shop.post('/api/shop/workorder', async (c) => {
  const token = c.req.header('X-User-Token') || c.req.query('token');
  if (!token) return c.json({ error: '未登录' }, 401);
  const user = await getUserById(c.env.PAY_BUCKET, token);
  if (!user) return c.json({ error: '未登录' }, 401);

  let body;
  try {
    body = await c.req.json();
  } catch (e) {
    return c.json({ error: '请求体格式错误' }, 400);
  }

  const title = body.title;
  const content = body.content;
  const type = body.type || 'support';
  if (!title || !content) return c.json({ error: '标题和内容不能为空' }, 400);

  const order = await createWorkOrder(c.env.PAY_BUCKET, user.userId, title, content, type);
  return c.json({ success: true, id: order.id });
});

// 获取我的工单列表
shop.get('/api/shop/workorders', async (c) => {
  const token = c.req.header('X-User-Token') || c.req.query('token');
  if (!token) return c.json({ error: '未登录' }, 401);
  const user = await getUserById(c.env.PAY_BUCKET, token);
  if (!user) return c.json({ error: '未登录' }, 401);

  const orders = await listWorkOrders(c.env.PAY_BUCKET, user.userId);
  return c.json(orders);
});

const SHOP_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>商城 - 账户中心</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#333}
.container{max-width:600px;margin:0 auto;padding:20px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
.header h1{font-size:22px}
.btn-logout{padding:6px 16px;background:#fff;border:1px solid #ddd;border-radius:4px;font-size:13px;cursor:pointer;color:#666;text-decoration:none}
.section{background:#fff;border-radius:8px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.section h2{font-size:16px;margin-bottom:12px;color:#333}
.balance{font-size:36px;color:#52c41a;font-weight:700;margin:8px 0}
.balance span{font-size:18px}
.balance-label{font-size:14px;color:#999}
.api-key{font-family:monospace;font-size:13px;background:#f0f0f0;padding:8px 12px;border-radius:4px;word-break:break-all;margin:8px 0;display:block}
.form-row{display:flex;gap:8px;margin-top:8px}
.form-row input{flex:1;padding:8px 12px;border:1px solid #ddd;border-radius:4px;font-size:14px}
.form-row input[type="number"]{max-width:150px}
.btn{padding:8px 16px;border:none;border-radius:4px;font-size:14px;cursor:pointer}
.btn-primary{background:#1677ff;color:#fff}
.btn-primary:hover{background:#4096ff}
.btn-secondary{background:#fff;color:#1677ff;border:1px solid #1677ff}
.btn-secondary:hover{background:#e6f0ff}
.toast{position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:4px;color:#fff;font-size:14px;z-index:1000;display:none}
.toast.success{background:#52c41a}
.toast.error{background:#ff4d4f}
.recharge-hint{font-size:13px;color:#999;margin-top:8px}
.recharge-result{display:none;margin-top:12px;padding:12px;background:#fafafa;border-radius:4px;font-size:13px}
.recharge-result a{color:#1677ff}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>账户中心</h1>
<a class="btn-logout" href="javascript:void(0)" onclick="logout()">退出登录</a>
</div>
<div id="toast" class="toast"></div>

<div class="section">
<h2>账户余额</h2>
<div class="balance-label">当前余额</div>
<div class="balance"><span>￥</span><span id="balanceAmount">0.00</span></div>
</div>

<div class="section">
<h2>API Key</h2>
<p style="font-size:13px;color:#999;margin-bottom:8px">使用 API Key 可通过接口创建订单</p>
<span class="api-key" id="apiKeyDisplay">加载中...</span>
<button class="btn btn-secondary" onclick="copyApiKey()" style="margin-top:8px">复制</button>
</div>

<div class="section">
<h2>余额充值</h2>
<p style="font-size:13px;color:#999;margin-bottom:8px">通过支付宝扫码充值，支付成功后自动到账（扣除手续费后计入余额）</p>
<div class="form-row">
<input type="number" id="rechargeAmount" placeholder="充值金额（元）" step="0.01" min="0.01">
<button class="btn btn-primary" id="rechargeBtn" onclick="doRecharge()">充值</button>
</div>
<div class="recharge-hint" id="feeHint"></div>
<div class="recharge-result" id="rechargeResult"></div>
</div>

<div class="section">
<h2>提交工单</h2>
<p style="font-size:13px;color:#999;margin-bottom:8px">遇到问题？向管理员提交工单</p>
<div style="margin-bottom:8px">
<select id="workorderType" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:4px;font-size:14px;margin-bottom:8px">
<option value="support">技术支持</option>
<option value="bug">Bug 反馈</option>
<option value="feature">功能建议</option>
<option value="other">其他</option>
</select>
<input type="text" id="workorderTitle" placeholder="工单标题" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:4px;font-size:14px;margin-bottom:8px;box-sizing:border-box">
<textarea id="workorderContent" placeholder="请详细描述您的问题..." rows="4" style="width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:4px;font-size:14px;resize:vertical;box-sizing:border-box"></textarea>
</div>
<button class="btn btn-primary" onclick="submitWorkOrder()">提交工单</button>
</div>

<div class="section">
<h2>我的工单</h2>
<div id="workorderList" style="font-size:13px;color:#999">加载中...</div>
</div>
</div>

<script>
var currentUser = null;
var rechargeTimer = null;

// 检查登录
var token = localStorage.getItem('user_token');
if (!token) { location.href = '/user/login'; }

function showToast(msg, type) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.style.display = 'block';
  t.style.opacity = '1';
  setTimeout(function() { t.style.display = 'none'; }, 3000);
}

function logout() {
  localStorage.removeItem('user_token');
  location.href = '/user/login';
}

function copyApiKey() {
  var key = currentUser ? currentUser.apiKey : '';
  if (!key) return;
  navigator.clipboard.writeText(key).then(function() {
    showToast('API Key 已复制', 'success');
  }).catch(function() {
    showToast('复制失败，请手动复制', 'error');
  });
}

// 加载用户信息
async function loadUserInfo() {
  try {
    var r = await fetch('/api/shop/me', {
      headers: { 'X-User-Token': token }
    });
    if (!r.ok) {
      localStorage.removeItem('user_token');
      location.href = '/user/login';
      return;
    }
    currentUser = await r.json();
    document.getElementById('balanceAmount').textContent = currentUser.balance.toFixed(2);
    document.getElementById('apiKeyDisplay').textContent = currentUser.apiKey;
  } catch(e) {
    console.error('loadUserInfo error:', e);
  }
}

// 充值
async function doRecharge() {
  var amount = document.getElementById('rechargeAmount').value.trim();
  if (!amount || parseFloat(amount) < 0.01) {
    showToast('请输入有效金额（最低 0.01 元）', 'error');
    return;
  }
  var btn = document.getElementById('rechargeBtn');
  btn.disabled = true;
  btn.textContent = '创建中...';

  try {
    var r = await fetch('/api/shop/recharge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Token': token },
      body: JSON.stringify({ amount: parseFloat(amount) })
    });
    var d = await r.json();
    if (!r.ok) {
      showToast(d.error || '创建订单失败', 'error');
      btn.disabled = false;
      btn.textContent = '充值';
      return;
    }

    var resultDiv = document.getElementById('rechargeResult');
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<div style="margin-bottom:4px">订单已创建</div>' +
      '<div style="margin-bottom:4px"><strong>实际支付金额：</strong>￥' + d.amount.toFixed(2) + '</div>' +
      '<div style="margin-bottom:8px"><a href="' + d.payUrl + '" target="_blank" style="color:#1677ff">点击打开付款页面</a></div>' +
      '<div style="color:#999;font-size:12px">支付成功后余额将自动到账</div>';

    showToast('订单创建成功，请打开付款页面扫码', 'success');
    document.getElementById('rechargeAmount').value = '';
  } catch(e) {
    showToast('网络错误', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '充值';
  }
}

loadUserInfo();
loadWorkOrders();

// 提交工单
async function submitWorkOrder() {
  var type = document.getElementById('workorderType').value;
  var title = document.getElementById('workorderTitle').value.trim();
  var content = document.getElementById('workorderContent').value.trim();
  if (!title || !content) {
    showToast('请填写标题和内容', 'error');
    return;
  }
  try {
    var r = await fetch('/api/shop/workorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Token': token },
      body: JSON.stringify({ type: type, title: title, content: content })
    });
    var d = await r.json();
    if (!r.ok) {
      showToast(d.error || '提交失败', 'error');
      return;
    }
    showToast('工单提交成功', 'success');
    document.getElementById('workorderTitle').value = '';
    document.getElementById('workorderContent').value = '';
    loadWorkOrders();
  } catch(e) {
    showToast('网络错误', 'error');
  }
}

// 加载工单列表
async function loadWorkOrders() {
  try {
    var r = await fetch('/api/shop/workorders', {
      headers: { 'X-User-Token': token }
    });
    if (!r.ok) return;
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
      html += '<div style="padding:12px;background:#fafafa;border-radius:4px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
        '<strong>' + o.title + '</strong>' +
        '<span style="font-size:12px;color:' + statusColor[o.status] + '">' + statusMap[o.status] + '</span>' +
        '</div>' +
        '<div style="font-size:12px;color:#999;margin-bottom:4px">' + typeMap[o.type] + ' · ' + new Date(o.createdAt).toLocaleString('zh-CN') + '</div>' +
        '<div style="font-size:13px;color:#666;margin-bottom:4px">' + o.content + '</div>';
      if (o.adminReply) {
        html += '<div style="padding:8px;background:#e6f7ff;border-radius:4px;font-size:13px;color:#1677ff">' +
          '<strong>管理员回复：</strong>' + o.adminReply +
          '<div style="font-size:11px;color:#999;margin-top:4px">' + new Date(o.repliedAt).toLocaleString('zh-CN') + '</div>' +
          '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    div.innerHTML = html;
  } catch(e) {
    console.error('loadWorkOrders error:', e);
  }
}
</script>
</body>
</html>`;

export default shop;