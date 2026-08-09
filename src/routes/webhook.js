/**
 * Webhook 路由 — 接收付款通知，按金额+时间窗口匹配订单
 *
 * 支持多种消息格式：
 *   1. JSON body 中查找 amount/price/money 字段
 *   2. 中文文本：收款XX元、付款XX元、转账XX元、￥XX
 *   3. Form 表单数据
 *   4. 纯文本中提取数字
 */
import { Hono } from 'hono';
import { findPendingOrderByAmount, updateOrderStatus, saveWebhookRaw, getFeePercent, updateUserBalance, getUserById, deleteWebhookRaw } from '../storage';

const webhook = new Hono();

/**
 * 从文本中提取金额（支持中文格式）
 * 支持格式：收款100.00元、付款￥50.00、收入100元、转账100.00 等
 * @param {string} text
 * @returns {number|null}
 */
function extractAmountFromText(text) {
  if (!text || typeof text !== 'string') return null;

  // 中文金额格式：收款/付款/收入/转账/到账 + 金额 + 元
  const patterns = [
    /(?:收款|付款|收入|转账|到账|收到|入账|汇入)[^\d]*?(\d+\.?\d{0,2})\s*元?/,
    /￥\s*(\d+\.?\d{0,2})/,
    /¥\s*(\d+\.?\d{0,2})/,
    /金额[：:]\s*(\d+\.?\d{0,2})/,
    /(?:收入|支出)[^\d]*?(\d+\.?\d{0,2})/,
    /(\d+\.?\d{0,2})\s*元\s*(?:已|到账|收款|付款|转入)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const num = parseFloat(match[1]);
      if (!isNaN(num) && num > 0) return num;
    }
  }

  // 兜底：找到所有数字，取看起来像金额的（两位小数或整数）
  const allNums = text.match(/\d+\.?\d{0,2}/g);
  if (allNums) {
    for (const n of allNums) {
      const num = parseFloat(n);
      // 过滤掉时间戳（太长）、纯日期等
      if (!isNaN(num) && num > 0.01 && num < 100000) {
        return num;
      }
    }
  }

  return null;
}

/**
 * 从文本中提取时间
 * @param {string} text
 * @returns {string|null}
 */
function extractTimeFromText(text) {
  if (!text || typeof text !== 'string') return null;

  // 匹配常见时间格式
  const patterns = [
    /(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}:\d{2})/,
    /(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2})/,
    /(\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2})/,
    /(\d{1,2}:\d{2}:\d{2})/,
    /(\d{1,2}:\d{2})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * 从任意格式的消息中提取金额
 * 尝试多种方式解析，返回提取到的金额（数字），失败返回 null
 */
function extractAmount(rawData) {
  // 方式 1: JSON 对象中的常见金额字段
  if (typeof rawData === 'object' && rawData !== null) {
    const candidates = [
      rawData.amount,
      rawData.price,
      rawData.money,
      rawData.total,
      rawData.total_amount,
      rawData.totalAmount,
      rawData.pay_amount,
      rawData.payAmount,
      rawData.trade_amount,
      rawData.tradeAmount,
      rawData.buyer_pay_amount,
      rawData.buyerPayAmount,
      rawData.receipt_amount,
      rawData.receiptAmount,
      rawData.invoice_amount,
      rawData.invoiceAmount,
    ];
    for (const val of candidates) {
      const num = parseFloat(val);
      if (!isNaN(num) && num > 0) return num;
    }

    // 对象中的字符串字段尝试中文格式提取
    for (const val of Object.values(rawData)) {
      if (typeof val === 'string') {
        const num = extractAmountFromText(val);
        if (num !== null) return num;
      }
      if (typeof val === 'object' && val !== null) {
        const nested = extractAmount(val);
        if (nested !== null) return nested;
      }
    }
  }

  // 方式 2: 字符串中提取金额
  if (typeof rawData === 'string') {
    return extractAmountFromText(rawData);
  }

  return null;
}

/**
 * 提取收款时间
 */
function extractTime(rawData) {
  if (typeof rawData === 'object' && rawData !== null) {
    // 先检查对象中的时间字段
    const timeFields = ['time', 'payTime', 'pay_time', 'tradeTime', 'trade_time', 'timestamp', 'date'];
    for (const field of timeFields) {
      if (rawData[field]) return rawData[field];
    }
    // 递归检查字符串字段
    for (const val of Object.values(rawData)) {
      if (typeof val === 'string') {
        const t = extractTimeFromText(val);
        if (t) return t;
      }
    }
  }
  if (typeof rawData === 'string') {
    return extractTimeFromText(rawData);
  }
  return null;
}

// 接收付款通知
webhook.post('/api/webhook/payment', async (c) => {
  // 验证 Webhook Secret Header（从环境变量读取）
  const webhookKey = c.req.header('NirithyAPI');
  const expectedKey = c.env.WEBHOOK_SECRET;
  if (!expectedKey || webhookKey !== expectedKey) {
    return c.json({ error: '未授权' }, 401);
  }

  let rawData;
  const contentType = c.req.header('Content-Type') || '';

  try {
    if (contentType.includes('application/json')) {
      rawData = await c.req.json();
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      rawData = Object.fromEntries(await c.req.formData());
    } else {
      const text = await c.req.text();
      try {
        rawData = JSON.parse(text);
      } catch {
        rawData = text;
      }
    }
  } catch (e) {
    try {
      rawData = await c.req.text();
    } catch {
      rawData = '(无法读取请求体)';
    }
  }

  // 同时保留 URL query 参数
  const queryParams = Object.fromEntries(new URL(c.req.url).searchParams);
  if (Object.keys(queryParams).length > 0) {
    rawData = { ...(typeof rawData === 'object' ? rawData : { _raw: rawData }), _query: queryParams };
  }

  // 提取金额和时间
  const amount = extractAmount(rawData);
  const payTime = extractTime(rawData);

  let matchResult = 'unmatched';
  let matchedOrderId = null;

  if (amount !== null) {
    const order = await findPendingOrderByAmount(c.env.PAY_BUCKET, amount);

    if (order) {
      if (order.status === 'completed') {
        matchResult = 'already_completed';
      } else {
        await updateOrderStatus(c.env.PAY_BUCKET, order.orderId, 'completed', {
          completedAt: Date.now(),
          paidAt: Date.now(),
          payAmount: amount,
          payTime: payTime,
        });
        matchResult = 'matched';
        matchedOrderId = order.orderId;

        // 支付成功：给用户余额充值
        // recharge 订单：全额充值，无手续费
        // merchant 订单：扣除手续费后充值
        try {
          const user = await getUserById(c.env.PAY_BUCKET, order.userId);
          if (user && user.userId !== 'admin-test') {
            let credit = amount;
            if (order.orderType === 'merchant') {
              const feePercent = await getFeePercent(c.env.PAY_BUCKET);
              credit = Math.round(amount * (100 - feePercent)) / 100;
            }
            await updateUserBalance(c.env.PAY_BUCKET, user.userId, credit);
          }
        } catch (e) {
          console.error('[Webhook] 充值失败:', e.message);
        }
      }
    }
  }

  // 存储原始消息到 R2
  const savedRecord = await saveWebhookRaw(c.env.PAY_BUCKET, rawData, matchResult, matchedOrderId);

  // 支付成功后立即删除 webhook 原始消息，防止干扰后续匹配
  if (matchResult === 'matched' && savedRecord && savedRecord.key) {
    try {
      await deleteWebhookRaw(c.env.PAY_BUCKET, savedRecord.key);
    } catch (e) {
      // 删除失败不影响主流程
      console.error('[Webhook] 删除原始消息失败:', e.message);
    }
  }

  return c.json({
    success: true,
    matchResult,
    matchedOrderId,
    extractedAmount: amount,
    extractedTime: payTime,
  });
});

export default webhook;