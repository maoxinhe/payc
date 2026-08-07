/**
 * 支付 API 路由 — 订单创建和状态查询
 */
import { Hono } from 'hono';
import { getUserByApiKey, createOrder, getOrder } from '../storage';

const payment = new Hono();

// 创建订单 — 需要 API Key 鉴权
payment.post('/api/order/create', async (c) => {
  // 从 Header 或 Body 中获取 API Key
  let apiKey = c.req.header('X-API-Key');
  if (!apiKey) {
    try {
      const body = await c.req.json();
      apiKey = body.apiKey;
    } catch (e) {
      // body 可能还没被读取或格式不对
    }
  }
  if (!apiKey) {
    return c.json({ error: '缺少 API Key' }, 401);
  }

  // 验证 API Key
  const user = await getUserByApiKey(c.env.PAY_BUCKET, apiKey);
  if (!user) {
    return c.json({ error: '无效的 API Key' }, 401);
  }

  // 获取金额和商品名称参数
  let amount;
  let productName;
  try {
    const body = await c.req.json();
    amount = parseFloat(body.amount);
    productName = body.productName || body.product_name || '';
  } catch (e) {
    return c.json({ error: '请求体格式错误' }, 400);
  }

  if (!amount || amount <= 0) {
    return c.json({ error: '金额必须大于 0' }, 400);
  }

  // 创建订单
  const order = await createOrder(c.env.PAY_BUCKET, user.userId, amount, 'merchant', productName);

  // 构建付款页面 URL
  const url = new URL(c.req.url);
  const payUrl = `${url.protocol}//${url.host}/pay/${order.orderId}`;

  return c.json({
    orderId: order.orderId,
    amount: order.amount,
    payUrl,
    status: order.status,
    createdAt: order.createdAt,
  });
});

// 查询订单状态
payment.get('/api/order/:orderId/status', async (c) => {
  const { orderId } = c.req.param();
  const order = await getOrder(c.env.PAY_BUCKET, orderId);

  if (!order) {
    return c.json({ error: '订单不存在' }, 404);
  }

  return c.json({
    orderId: order.orderId,
    amount: order.amount,
    status: order.status,
    createdAt: order.createdAt,
    completedAt: order.completedAt,
    paidAt: order.paidAt,
  });
});

export default payment;