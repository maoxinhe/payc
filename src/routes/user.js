/**
 * 用户路由 — 注册、登录、个人中心、API Key 管理
 */
import { Hono } from 'hono';
import { createUser, loginUser, getUserById, listUsers, deleteUser } from '../storage';

const user = new Hono();

// ==================== 注册 ====================

user.get('/user/register', (c) => {
  return c.html(REGISTER_HTML);
});

user.post('/api/user/register', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '请求格式错误' }, 400);
  }
  const { username, password } = body;
  if (!username || username.length < 3) {
    return c.json({ error: '用户名至少 3 个字符' }, 400);
  }
  if (!password || password.length < 6) {
    return c.json({ error: '密码至少 6 个字符' }, 400);
  }
  try {
    const result = await createUser(c.env.PAY_BUCKET, username, password);
    return c.json({ success: true, user: result });
  } catch (e) {
    return c.json({ error: e.message || '注册失败' }, 400);
  }
});

// ==================== 登录 ====================

user.get('/user/login', (c) => {
  return c.html(LOGIN_HTML);
});

user.post('/api/user/login', async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: '请求格式错误' }, 400);
  }
  const { username, password } = body;
  if (!username || !password) {
    return c.json({ error: '请输入用户名和密码' }, 400);
  }
  const result = await loginUser(c.env.PAY_BUCKET, username, password);
  if (!result) {
    return c.json({ error: '用户名或密码错误' }, 401);
  }
  return c.json({ success: true, user: result });
});

// ==================== 个人中心（需要 token） ====================

// 获取当前用户信息
user.get('/api/user/me', async (c) => {
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

// ==================== 页面 ====================

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>用户登录 - 商城</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;min-height:100vh;display:flex;justify-content:center;align-items:center}
.card{background:#fff;border-radius:8px;padding:32px;width:360px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
h1{font-size:20px;margin-bottom:8px;color:#333;text-align:center}
.sub{font-size:14px;color:#999;margin-bottom:20px;text-align:center}
input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:4px;font-size:14px;margin-bottom:12px}
button{width:100%;padding:10px;background:#1677ff;color:#fff;border:none;border-radius:4px;font-size:14px;cursor:pointer}
button:hover{background:#4096ff}
.error{color:#ff4d4f;font-size:13px;margin-top:8px;display:none;text-align:center}
.link{text-align:center;margin-top:12px;font-size:13px}
.link a{color:#1677ff;text-decoration:none}
</style>
</head>
<body>
<div class="card">
<h1>用户登录</h1>
<p class="sub">登录您的商城账户</p>
<input type="text" id="username" placeholder="用户名" onkeydown="if(event.key==='Enter')login()">
<input type="password" id="password" placeholder="密码" onkeydown="if(event.key==='Enter')login()">
<button onclick="login()">登录</button>
<p class="error" id="err"></p>
<p class="link">还没有账户？<a href="/user/register">立即注册</a></p>
</div>
<script>
async function login() {
  var u = document.getElementById('username').value.trim();
  var p = document.getElementById('password').value;
  if (!u || !p) return showErr('请输入用户名和密码');
  try {
    var r = await fetch('/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });
    var d = await r.json();
    if (d.success) {
      localStorage.setItem('user_token', d.user.userId);
      location.href = '/shop';
    } else {
      showErr(d.error || '登录失败');
    }
  } catch(e) {
    showErr('网络错误');
  }
}
function showErr(msg) {
  var e = document.getElementById('err');
  e.textContent = msg;
  e.style.display = 'block';
}
</script>
</body>
</html>`;

const REGISTER_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>用户注册 - 商城</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;min-height:100vh;display:flex;justify-content:center;align-items:center}
.card{background:#fff;border-radius:8px;padding:32px;width:360px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
h1{font-size:20px;margin-bottom:8px;color:#333;text-align:center}
.sub{font-size:14px;color:#999;margin-bottom:20px;text-align:center}
input{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:4px;font-size:14px;margin-bottom:12px}
button{width:100%;padding:10px;background:#1677ff;color:#fff;border:none;border-radius:4px;font-size:14px;cursor:pointer}
button:hover{background:#4096ff}
.error{color:#ff4d4f;font-size:13px;margin-top:8px;display:none;text-align:center}
.success{color:#52c41a;font-size:13px;margin-top:8px;display:none;text-align:center}
.link{text-align:center;margin-top:12px;font-size:13px}
.link a{color:#1677ff;text-decoration:none}
</style>
</head>
<body>
<div class="card">
<h1>用户注册</h1>
<p class="sub">创建您的商城账户</p>
<input type="text" id="username" placeholder="用户名（至少3个字符）" onkeydown="if(event.key==='Enter')register()">
<input type="password" id="password" placeholder="密码（至少6个字符）" onkeydown="if(event.key==='Enter')register()">
<button onclick="register()">注册</button>
<p class="error" id="err"></p>
<p class="success" id="ok">注册成功！正在跳转...</p>
<p class="link">已有账户？<a href="/user/login">立即登录</a></p>
</div>
<script>
async function register() {
  var u = document.getElementById('username').value.trim();
  var p = document.getElementById('password').value;
  if (!u || u.length < 3) return showErr('用户名至少3个字符');
  if (!p || p.length < 6) return showErr('密码至少6个字符');
  try {
    var r = await fetch('/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });
    var d = await r.json();
    if (d.success) {
      localStorage.setItem('user_token', d.user.userId);
      document.getElementById('ok').style.display = 'block';
      document.getElementById('err').style.display = 'none';
      setTimeout(function() { location.href = '/shop'; }, 1500);
    } else {
      showErr(d.error || '注册失败');
    }
  } catch(e) {
    showErr('网络错误');
  }
}
function showErr(msg) {
  var e = document.getElementById('err');
  e.textContent = msg;
  e.style.display = 'block';
}
</script>
</body>
</html>`;

export default user;