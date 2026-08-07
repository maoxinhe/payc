/**
 * Worker 入口 — 整合所有路由、付款页面、SDK、Cron 清理
 */
import { Hono } from 'hono';
import adminRoutes from './routes/admin';
import paymentRoutes from './routes/payment';
import webhookRoutes from './routes/webhook';
import userRoutes from './routes/user';
import shopRoutes from './routes/shop';
import testRoutes from './routes/test';
import { getOrder, getConfig, listExpiredOrders, deleteOrder } from './storage';
// 以文本方式导入 SDK 源码（.txt 后缀避免被当作 JS 模块解析）
import paySdkJs from './sdk/pay-sdk.js.txt';

const app = new Hono();

// 根路径重定向到商城用户中心
app.get('/', (c) => {
  return c.redirect('/shop');
});

// 挂载各模块路由
app.route('/', adminRoutes);
app.route('/', paymentRoutes);
app.route('/', webhookRoutes);
app.route('/', userRoutes);
app.route('/', shopRoutes);
app.route('/', testRoutes);

// ==================== SDK 静态文件 ====================

// 提供 JS SDK 文件（可直接通过 <script> 标签引入）
app.get('/sdk/pay-sdk.js', (c) => {
  return new Response(paySdkJs, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

// ==================== 付款页面 ====================

// 付款页面 HTML（内联，避免 R2 依赖）
app.get('/pay/:orderId', async (c) => {
  const { orderId } = c.req.param();
  const order = await getOrder(c.env.PAY_BUCKET, orderId);

  if (!order) {
    return c.html(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>订单不存在</title><style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}.card{background:#fff;border-radius:12px;padding:32px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.08)}h2{color:#ff4d4f}</style></head><body><div class="card"><h2>订单不存在或已失效</h2><p style="color:#999">订单号: ${orderId}</p></div></body></html>`, 404);
  }

  return c.html(getPayPageHtml(order));
});

// HTML 转义函数（防止 XSS）
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 付款页面 HTML 生成函数
function getPayPageHtml(order) {
  var productName = order.productName || '';
  var titleHtml = productName ? '<div class="title">' + escapeHtml(productName) + '</div>' : '<div class="title">支付宝扫码支付</div>';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>` + (productName ? escapeHtml(productName) + ' - ' : '') + `支付宝付款</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;min-height:100vh;display:flex;justify-content:center;align-items:center}
.card{background:#fff;border-radius:12px;padding:32px;width:360px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.title{font-size:20px;color:#333;margin-bottom:8px}
.amount{font-size:36px;color:#1677ff;font-weight:700;margin:16px 0}
.amount span{font-size:18px}
.qrcode-img{width:200px;height:200px;margin:16px auto;border:1px solid #eee;border-radius:8px;object-fit:contain}
.hint{font-size:14px;color:#999;margin:12px 0}
.status-pending{color:#fa8c16;font-size:15px;margin:12px 0}
.status-completed{color:#52c41a;font-size:18px;font-weight:700;margin:20px 0}
.status-expired{color:#ff4d4f;font-size:18px;font-weight:700;margin:20px 0}
.spinner{display:inline-block;width:16px;height:16px;border:2px solid #fa8c16;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
.check-icon{font-size:48px;color:#52c41a;margin-bottom:8px}
.btn-verify{display:block;width:100%;padding:10px;margin-top:16px;background:#1677ff;color:#fff;border:none;border-radius:6px;font-size:15px;cursor:pointer}
.btn-verify:hover{background:#4096ff}
.btn-verify:disabled{background:#ccc;cursor:not-allowed}
</style>
</head>
<body>
<div class="card" id="card"></div>
<script>
(function(){
var orderId='` + order.orderId + `';
var amount=` + order.amount + `;
var createdAt=` + order.createdAt + `;
var status='` + order.status + `';
var titleHtml=` + JSON.stringify(titleHtml) + `;
var card=document.getElementById('card');
var timer=null;

function render(state){
  if(state==='completed'){
    card.innerHTML='<div class="check-icon">&#10004;</div><div class="status-completed">支付成功</div><div class="amount"><span>￥</span>'+amount.toFixed(2)+'</div><div class="hint">订单号: '+orderId+'</div><div class="hint" style="font-size:12px;color:#999;margin-top:16px">页面将在 <span id="closeCountdown">3</span> 秒后自动关闭</div>';
  }else if(state==='expired'){
    card.innerHTML='<div class="status-expired">订单已过期</div><div class="amount"><span>￥</span>'+amount.toFixed(2)+'</div><div class="hint">请重新创建订单</div>';
  }else{
    card.innerHTML=titleHtml+'<div class="amount"><span>￥</span>'+amount.toFixed(2)+'</div><img class="qrcode-img" id="qr" src="" alt="收款码"><div class="status-pending"><span class="spinner"></span>等待支付...</div><div class="hint">请使用支付宝扫描二维码完成付款</div><button class="btn-verify" id="btnVerify" onclick="checkPayment()">我已完成付款，验证</button><div class="hint" style="font-size:12px">订单号: '+orderId+'</div>';
  }
}

// 支付成功后倒计时关闭
function closeAfterSuccess(){
  clearInterval(timer);
  var count=3;
  var el=document.getElementById('closeCountdown');
  var t=setInterval(function(){
    count--;
    if(el) el.textContent=count;
    if(count<=0){
      clearInterval(t);
      window.close();
      // 如果 window.close() 无效（非弹窗模式），显示提示
      setTimeout(function(){
        card.innerHTML='<div class="check-icon">&#10004;</div><div class="status-completed">支付成功</div><div class="amount"><span>￥</span>'+amount.toFixed(2)+'</div><div class="hint">已完成，请关闭此页面</div>';
      },1000);
    }
  },1000);
}

// 手动验证付款
function checkPayment(){
  var btn=document.getElementById('btnVerify');
  if(btn){btn.disabled=true;btn.textContent='验证中...';}
  fetch('/api/order/'+orderId+'/status').then(function(r){return r.ok?r.json():null}).then(function(o){
    if(!o){clearInterval(timer);render('expired');return}
    if(o.status==='completed'){render('completed');closeAfterSuccess();return}
    if(o.status==='expired'||Date.now()-o.createdAt>30*60*1000){render('expired');clearInterval(timer);return}
    // 仍未支付，恢复按钮
    var b=document.getElementById('btnVerify');
    if(b){b.disabled=false;b.textContent='我已完成付款，验证';}
  }).catch(function(){
    var b=document.getElementById('btnVerify');
    if(b){b.disabled=false;b.textContent='我已完成付款，验证';}
  });
}

function loadQr(){
  fetch('/api/config').then(r=>r.json()).then(function(c){
    var img=document.getElementById('qr');
    if(img){
      if(c.qrcodeUrl){
        img.src=c.qrcodeUrl;
      }else if(c.qrcodeImageKey){
        img.src='/api/qrcode-image';
      }
    }
  }).catch(function(){});
}

function poll(){
  fetch('/api/order/'+orderId+'/status').then(function(r){return r.ok?r.json():null}).then(function(o){
    if(!o){clearInterval(timer);card.innerHTML='<div class="status-expired">订单不存在</div>';return}
    if(o.status==='completed'){render('completed');closeAfterSuccess();return}
    if(o.status==='expired'||Date.now()-o.createdAt>30*60*1000){render('expired');clearInterval(timer);return}
  }).catch(function(){});
}

if(status==='completed'){render('completed');closeAfterSuccess()}
else if(Date.now()-createdAt>30*60*1000){render('expired')}
else{render('pending');loadQr();timer=setInterval(poll,2000)}
})();
</script>
</body>
</html>`;
}

// ==================== Cron 定时清理 ====================

// 每小时清理过期订单（创建超过 30 分钟的 pending 订单）
async function scheduled(event, env, ctx) {
  const expired = await listExpiredOrders(env.PAY_BUCKET);
  for (const order of expired) {
    await deleteOrder(env.PAY_BUCKET, order.orderId);
  }
  console.log(`[Cron] 清理了 ${expired.length} 个过期订单`);
}

// ==================== 导出 ====================

export default {
  fetch: app.fetch,
  scheduled,
};