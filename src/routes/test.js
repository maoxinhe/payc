/**
 * 测试页面 — 使用 SDK 测试支付回调流程
 */
import { Hono } from 'hono';
import { getConfig } from '../storage';

const test = new Hono();

// 测试商城首页
test.get('/test', (c) => {
  return c.html(TEST_HTML);
});

const TEST_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>支付测试中心</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#333}
.container{max-width:700px;margin:0 auto;padding:20px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
.header h1{font-size:22px}
.section{background:#fff;border-radius:8px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
.section h2{font-size:16px;margin-bottom:12px}
.products{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-top:12px}
.product{border:1px solid #eee;border-radius:8px;padding:16px;text-align:center;transition:box-shadow .2s}
.product:hover{box-shadow:0 2px 8px rgba(0,0,0,.1)}
.product-icon{font-size:32px;margin-bottom:8px}
.product-name{font-size:14px;font-weight:600;margin-bottom:4px}
.product-desc{font-size:12px;color:#999;margin-bottom:8px}
.product-price{font-size:18px;color:#1677ff;font-weight:700;margin-bottom:8px}
.product-price span{font-size:14px}
.btn-buy{width:100%;padding:8px;background:#1677ff;color:#fff;border:none;border-radius:4px;font-size:13px;cursor:pointer}
.btn-buy:hover{background:#4096ff}
.btn-buy:disabled{background:#ccc;cursor:not-allowed}
.result{margin-top:12px}
.result-inner{padding:12px;background:#f6ffed;border-radius:4px;font-size:13px}
.result-inner.error{background:#fff7e6}
.result-inner.loading{background:#fafafa}
.reward{font-family:monospace;font-size:24px;color:#52c41a;font-weight:700;letter-spacing:2px;padding:8px;background:#f0f0f0;border-radius:4px;margin:8px 0;text-align:center}
.loading-spinner{display:inline-block;width:16px;height:16px;border:2px solid #1677ff;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;margin-right:8px;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}
.api-key-section{margin-bottom:12px}
.api-key-section label{display:block;font-size:13px;color:#666;margin-bottom:4px}
.api-key-section input{width:100%;padding:8px 12px;border:1px solid #ddd;border-radius:4px;font-size:14px;font-family:monospace}
.btn{padding:8px 16px;border:none;border-radius:4px;font-size:14px;cursor:pointer}
.btn-primary{background:#1677ff;color:#fff}
.btn-primary:hover{background:#4096ff}
.btn-secondary{background:#fff;color:#1677ff;border:1px solid #1677ff}
.btn-secondary:hover{background:#e6f0ff}
.btn-danger{color:#ff4d4f;border:1px solid #ff4d4f;background:#fff}
.btn-danger:hover{background:#fff1f0}
.poll-status{font-size:12px;color:#999;margin-top:8px}
.poll-status.error{color:#ff4d4f}
.poll-status.success{color:#52c41a}
.btn-row{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>支付测试中心</h1>
<a href="/shop" style="font-size:14px;color:#1677ff;text-decoration:none">→ 返回商城</a>
</div>

<div class="section">
<h2>配置 API Key</h2>
<div class="api-key-section">
<label>您的 API Key（从商城账户中心获取）</label>
<input type="text" id="apiKey" placeholder="输入 pk_ 开头的 API Key">
</div>
<button class="btn btn-primary" onclick="saveKey()" style="width:auto;padding:8px 20px">保存</button>
</div>

<div class="section">
<h2>商品列表</h2>
<div class="products">
<div class="product">
<div class="product-icon">🎮</div>
<div class="product-name">游戏激活码</div>
<div class="product-desc">随机生成12位数字激活码</div>
<div class="product-price"><span>￥</span>1.00</div>
<button class="btn-buy" onclick="buy(1.00, '游戏激活码', this)">立即购买</button>
</div>
<div class="product">
<div class="product-icon">📦</div>
<div class="product-name">虚拟宝箱</div>
<div class="product-desc">随机道具礼包</div>
<div class="product-price"><span>￥</span>5.00</div>
<button class="btn-buy" onclick="buy(5.00, '虚拟宝箱', this)">立即购买</button>
</div>
<div class="product">
<div class="product-icon">💎</div>
<div class="product-name">钻石礼包</div>
<div class="product-desc">100颗游戏钻石</div>
<div class="product-price"><span>￥</span>10.00</div>
<button class="btn-buy" onclick="buy(10.00, '钻石礼包', this)">立即购买</button>
</div>
<div class="product">
<div class="product-icon">🎁</div>
<div class="product-name">神秘礼盒</div>
<div class="product-desc">随机神秘奖品</div>
<div class="product-price"><span>￥</span>18.88</div>
<button class="btn-buy" onclick="buy(18.88, '神秘礼盒', this)">立即购买</button>
</div>
<div class="product">
<div class="product-icon">👑</div>
<div class="product-name">VIP会员</div>
<div class="product-desc">7天VIP体验卡</div>
<div class="product-price"><span>￥</span>30.00</div>
<button class="btn-buy" onclick="buy(30.00, 'VIP会员', this)">立即购买</button>
</div>
<div class="product">
<div class="product-icon">🏆</div>
<div class="product-name">超值大礼包</div>
<div class="product-desc">全品类超值组合</div>
<div class="product-price"><span>￥</span>66.66</div>
<button class="btn-buy" onclick="buy(66.66, '超值大礼包', this)">立即购买</button>
</div>
</div>
</div>

<div class="section">
<h2>订单结果</h2>
<div class="btn-row">
<button class="btn btn-primary" onclick="manualCheck()">手动查询状态</button>
<button class="btn btn-secondary" onclick="restartPolling()">重新开始轮询</button>
<button class="btn btn-danger" onclick="stopPolling()">停止轮询</button>
</div>
<div class="result" id="result"></div>
</div>
</div>

<script>
var currentOrder = null;
var pollTimer = null;
var pollCount = 0;
var apiKey = '';

// 加载保存的 API Key
var savedKey = localStorage.getItem('test_api_key');
if (savedKey) {
  apiKey = savedKey;
  document.getElementById('apiKey').value = savedKey;
}

function saveKey() {
  var key = document.getElementById('apiKey').value.trim();
  if (!key) { showResult('请输入 API Key', 'error'); return; }
  if (!key.startsWith('pk_')) { showResult('API Key 格式不正确', 'error'); return; }
  apiKey = key;
  localStorage.setItem('test_api_key', key);
  showResult('API Key 已保存', 'success');
}

function showResult(msg, type) {
  var r = document.getElementById('result');
  var cls = type || '';
  r.innerHTML = '<div class="result-inner ' + cls + '">' + msg + '</div>';
}

function generateCode() {
  var chars = '0123456789';
  var code = '';
  for (var i = 0; i < 12; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// 创建订单
function createOrder(amount, productName) {
  var body = { amount: amount };
  if (productName) body.productName = productName;
  return fetch('/api/order/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify(body)
  }).then(function(r) {
    return r.json().then(function(data) {
      if (!r.ok) throw new Error(data.error || '创建失败');
      return data;
    });
  });
}

// 查询订单状态
function checkOrderStatus(orderId) {
  return fetch('/api/order/' + orderId + '/status', {
    headers: { 'X-API-Key': apiKey }
  }).then(function(r) {
    return r.json().then(function(data) {
      if (!r.ok) throw new Error(data.error || '查询失败');
      return data;
    });
  });
}

function buy(amount, productName, btn) {
  if (!apiKey) { showResult('请先输入并保存 API Key', 'error'); return; }

  showResult('<div class="loading-spinner"></div>正在创建订单...', 'loading');
  if (btn) { btn.disabled = true; btn.textContent = '处理中...'; }

  createOrder(amount, productName).then(function(order) {
    currentOrder = order;
    showResult(
      '<div style="margin-bottom:8px">订单已创建' + (productName ? '：' + productName : '') + '</div>' +
      '<div style="margin-bottom:4px"><strong>订单号：</strong>' + order.orderId + '</div>' +
      '<div style="margin-bottom:4px"><strong>支付金额：</strong>￥' + order.amount.toFixed(2) + '</div>' +
      '<div style="margin-bottom:8px"><a href="' + order.payUrl + '" target="_blank" style="color:#1677ff">点击打开付款页面</a></div>' +
      '<div class="poll-status" id="pollStatus">正在等待支付...</div>'
    );

    // 自动打开付款页面
    window.open(order.payUrl, '_blank');

    // 开始轮询
    startPolling(order.orderId);

  }).catch(function(err) {
    showResult('创建订单失败: ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '立即购买'; }
  });
}

function startPolling(orderId) {
  stopPolling();
  pollCount = 0;
  pollTimer = setInterval(function() {
    pollCount++;
    updatePollStatus('正在查询订单状态... (' + pollCount + '次)', '');
    checkOrderStatus(orderId).then(function(order) {
      if (order.status === 'completed') {
        stopPolling();
        showReward(order);
      } else if (order.status === 'expired') {
        stopPolling();
        showResult('订单已过期', 'error');
      }
    }).catch(function(err) {
      updatePollStatus('查询出错: ' + err.message, 'error');
    });
  }, 2000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function restartPolling() {
  if (!currentOrder) { showResult('请先创建订单', 'error'); return; }
  startPolling(currentOrder.orderId);
}

function manualCheck() {
  if (!currentOrder) { showResult('请先创建订单', 'error'); return; }
  checkOrderStatus(currentOrder.orderId).then(function(order) {
    if (order.status === 'completed') {
      stopPolling();
      showReward(order);
    } else {
      showResult(
        '<div>订单状态：<strong>' + order.status + '</strong></div>' +
        '<div style="margin-top:4px">订单号：' + order.orderId + '</div>' +
        '<div style="margin-top:4px">金额：￥' + order.amount.toFixed(2) + '</div>',
        ''
      );
    }
  }).catch(function(err) {
    showResult('查询失败: ' + err.message, 'error');
  });
}

function updatePollStatus(msg, type) {
  var el = document.getElementById('pollStatus');
  if (el) {
    el.textContent = msg;
    el.className = 'poll-status ' + type;
  }
}

function showReward(order) {
  var amount = order.amount || order.payAmount || order.pay_amount;
  var code = generateCode();
  var now = new Date().toLocaleString('zh-CN');
  showResult(
    '<div style="text-align:center;margin-bottom:12px">' +
    '<div style="font-size:28px;margin-bottom:4px">🎉</div>' +
    '<div style="font-size:18px;font-weight:700;color:#52c41a;margin-bottom:4px">支付成功</div>' +
    '<div style="margin-bottom:12px">￥' + (amount ? amount.toFixed(2) : '0.00') + '</div>' +
    '</div>' +
    '<div style="background:#f0f0f0;border-radius:4px;padding:12px;margin-bottom:8px">' +
    '<div style="font-size:12px;color:#999;margin-bottom:4px">您的激活码</div>' +
    '<div class="reward">' + code + '</div>' +
    '</div>' +
    '<div style="font-size:13px;color:#666;margin-bottom:4px"><strong>订单号：</strong>' + order.orderId + '</div>' +
    '<div style="font-size:13px;color:#666;margin-bottom:4px"><strong>支付时间：</strong>' + now + '</div>' +
    '<div style="font-size:13px;color:#666"><strong>流水号：</strong>' + generateCode() + '</div>',
    'success'
  );
  restoreAllButtons();
}

// 恢复所有购买按钮状态
function restoreAllButtons() {
  document.querySelectorAll('.btn-buy').forEach(function(btn) {
    btn.disabled = false;
    btn.textContent = '立即购买';
  });
}
</script>
</body>
</html>`;

export default test;