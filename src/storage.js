/**
 * R2 数据访问层 — 封装所有 R2 Bucket 读写操作
 * 存储结构：
 *   config/qrcode.json      — 总收款码配置
 *   users/{userId}.json     — 用户数据（含 API Key、密码哈希、余额）
 *   orders/{orderId}.json   — 订单数据
 *   webhooks/{ts}_{id}.json — Webhook 原始消息
 */

// 生成 UUID v4（兼容 Workers 环境，不依赖 crypto.randomUUID）
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// 生成订单 ID（短 ID，便于 URL 使用）
function generateOrderId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

/**
 * 从 R2 读取 JSON 对象
 * @param {R2Bucket} bucket - R2 Bucket 绑定
 * @param {string} key - 对象 key
 * @returns {Promise<object|null>} 解析后的 JSON 对象，不存在时返回 null
 */
async function readJSON(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return null;
  const text = await obj.text();
  return JSON.parse(text);
}

/**
 * 写入 JSON 对象到 R2
 * @param {R2Bucket} bucket
 * @param {string} key
 * @param {object} data
 */
export async function writeJSON(bucket, key, data) {
  await bucket.put(key, JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/**
 * 列出指定前缀下的所有 key
 * @param {R2Bucket} bucket
 * @param {string} prefix
 * @returns {Promise<string[]>} key 列表
 */
export async function listKeys(bucket, prefix) {
  const result = await bucket.list({ prefix });
  const keys = [];
  for (const obj of result.objects) {
    keys.push(obj.key);
  }
  // 处理分页
  let cursor = result.truncated ? result.cursor : undefined;
  while (cursor) {
    const page = await bucket.list({ prefix, cursor });
    for (const obj of page.objects) {
      keys.push(obj.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  }
  return keys;
}

// ==================== 配置 ====================

/**
 * 获取系统配置（收款码链接或图片）
 */
export async function getConfig(bucket) {
  return await readJSON(bucket, 'config/qrcode.json');
}

/**
 * 更新收款码配置（URL 方式）
 * @param {R2Bucket} bucket
 * @param {string} qrcodeUrl - 收款码图片链接
 */
export async function setConfig(bucket, qrcodeUrl) {
  const config = { qrcodeUrl, qrcodeImageKey: null, updatedAt: Date.now() };
  await writeJSON(bucket, 'config/qrcode.json', config);
  return config;
}

/**
 * 上传收款码图片到 R2
 * @param {R2Bucket} bucket
 * @param {ArrayBuffer} imageData - 图片二进制数据
 * @param {string} contentType - 图片 MIME 类型
 * @returns {Promise<object>} 配置对象
 */
export async function setQrcodeImage(bucket, imageData, contentType) {
  const imageKey = 'config/qrcode-image';
  await bucket.put(imageKey, imageData, {
    httpMetadata: { contentType },
  });
  const config = { qrcodeUrl: null, qrcodeImageKey: imageKey, updatedAt: Date.now() };
  await writeJSON(bucket, 'config/qrcode.json', config);
  return config;
}

/**
 * 获取收款码图片（从 R2 读取）
 * @param {R2Bucket} bucket
 * @returns {Promise<{data: ArrayBuffer, contentType: string}|null>}
 */
export async function getQrcodeImage(bucket) {
  const config = await getConfig(bucket);
  if (!config || !config.qrcodeImageKey) return null;
  const obj = await bucket.get(config.qrcodeImageKey);
  if (!obj) return null;
  const data = await obj.arrayBuffer();
  const contentType = obj.httpMetadata?.contentType || 'image/png';
  return { data, contentType };
}

// ==================== 系统设置 ====================

/**
 * 获取手续费百分比（默认 0，即不收手续费）
 */
export async function getFeePercent(bucket) {
  const config = await readJSON(bucket, 'config/settings.json');
  return config && typeof config.feePercent === 'number' ? config.feePercent : 0;
}

/**
 * 设置手续费百分比
 * @param {number} feePercent - 手续费百分比，如 1 表示 1%
 */
export async function setFeePercent(bucket, feePercent) {
  const settings = (await readJSON(bucket, 'config/settings.json')) || {};
  settings.feePercent = Math.max(0, Math.min(50, feePercent)); // 0-50% 范围
  settings.updatedAt = Date.now();
  await writeJSON(bucket, 'config/settings.json', settings);
  return settings;
}

// ==================== 用户管理 ====================

/**
 * 简单密码哈希（SHA-256 的简化版，Workers 环境可用）
 */
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'pay_salt_2026');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 创建用户（注册），自动生成 API Key
 * @param {R2Bucket} bucket
 * @param {string} username - 用户名
 * @param {string} password - 明文密码（内部哈希存储）
 * @returns {Promise<object>} 用户对象（含 apiKey）
 */
export async function createUser(bucket, username, password) {
  // 检查用户名是否已存在
  const existing = await getUserByUsername(bucket, username);
  if (existing) {
    throw new Error('用户名已存在');
  }
  const userId = generateUUID();
  const apiKey = 'pk_' + generateUUID().replace(/-/g, '');
  const passwordHash = await hashPassword(password);
  const user = {
    userId,
    username,
    passwordHash,
    apiKey,
    balance: 0,       // 余额（元），初始为 0
    createdAt: Date.now(),
  };
  await writeJSON(bucket, `users/${userId}.json`, user);
  return { userId: user.userId, username: user.username, apiKey: user.apiKey, balance: user.balance, createdAt: user.createdAt };
}

/**
 * 用户名+密码登录
 * @returns {Promise<object|null>} 登录成功返回用户对象，失败返回 null
 */
export async function loginUser(bucket, username, password) {
  const user = await getUserByUsername(bucket, username);
  if (!user) return null;
  const h = await hashPassword(password);
  if (h !== user.passwordHash) return null;
  return { userId: user.userId, username: user.username, apiKey: user.apiKey, balance: user.balance, createdAt: user.createdAt };
}

/**
 * 通过用户名查找用户（含密码哈希等内部字段）
 */
async function getUserByUsername(bucket, username) {
  const keys = await listKeys(bucket, 'users/');
  for (const key of keys) {
    const user = await readJSON(bucket, key);
    if (user && user.username === username) {
      return user;
    }
  }
  return null;
}

/**
 * 通过用户 ID 获取用户
 */
export async function getUserById(bucket, userId) {
  return await readJSON(bucket, `users/${userId}.json`);
}

/**
 * 更新用户余额
 * @param {number} delta - 变化量（正数加钱，负数扣钱）
 */
export async function updateUserBalance(bucket, userId, delta) {
  const user = await getUserById(bucket, userId);
  if (!user) throw new Error('用户不存在');
  user.balance = Math.round((user.balance + delta) * 100) / 100; // 保留两位小数
  if (user.balance < 0) user.balance = 0;
  await writeJSON(bucket, `users/${userId}.json`, user);
  return user;
}

/**
 * 通过 API Key 查找用户
 * @param {R2Bucket} bucket
 * @param {string} apiKey
 * @returns {Promise<object|null>}
 */
export async function getUserByApiKey(bucket, apiKey) {
  const keys = await listKeys(bucket, 'users/');
  for (const key of keys) {
    const user = await readJSON(bucket, key);
    if (user && user.apiKey === apiKey) {
      return user;
    }
  }
  return null;
}

/**
 * 获取所有用户列表
 * @param {R2Bucket} bucket
 * @returns {Promise<object[]>}
 */
export async function listUsers(bucket) {
  const keys = await listKeys(bucket, 'users/');
  const users = [];
  for (const key of keys) {
    const user = await readJSON(bucket, key);
    if (user) users.push({ userId: user.userId, username: user.username, apiKey: user.apiKey, balance: user.balance, createdAt: user.createdAt });
  }
  return users.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 删除用户
 * @param {R2Bucket} bucket
 * @param {string} userId
 */
export async function deleteUser(bucket, userId) {
  await bucket.delete(`users/${userId}.json`);
}

// ==================== 订单管理 ====================

/**
 * 获取当前所有 pending 订单的金额集合（用于相同金额 +0.01 检测）
 * @returns {Promise<Set<number>>}
 */
export async function getPendingAmounts(bucket) {
  const keys = await listKeys(bucket, 'orders/');
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const amounts = new Set();
  for (const key of keys) {
    const order = await readJSON(bucket, key);
    if (order && order.status === 'pending' && (now - order.createdAt) <= windowMs) {
      amounts.add(order.amount);
    }
  }
  return amounts;
}

/**
 * 创建订单（自动处理相同金额 +0.01 避免匹配冲突）
 * @param {R2Bucket} bucket
 * @param {string} userId - 创建订单的用户 ID
 * @param {number} amount - 请求金额（元）
 * @param {string} [orderType] - 订单类型: 'recharge'(用户充值) | 'merchant'(商户订单，通过API Key创建)
 * @param {string} [productName] - 商品名称（用于在付款页面显示）
 * @returns {Promise<object>} 订单对象
 */
export async function createOrder(bucket, userId, amount, orderType, productName) {
  const pendingAmounts = await getPendingAmounts(bucket);
  let actualAmount = amount;
  while (pendingAmounts.has(actualAmount)) {
    actualAmount = Math.round((actualAmount + 0.01) * 100) / 100;
  }

  const orderId = generateOrderId();
  const order = {
    orderId,
    userId,
    amount: actualAmount,
    requestedAmount: amount,
    orderType: orderType || 'merchant',
    productName: productName || '',
    status: 'pending',
    createdAt: Date.now(),
    completedAt: null,
    paidAt: null,
  };
  await writeJSON(bucket, `orders/${orderId}.json`, order);
  return order;
}

/**
 * 获取订单
 * @param {R2Bucket} bucket
 * @param {string} orderId
 * @returns {Promise<object|null>}
 */
export async function getOrder(bucket, orderId) {
  return await readJSON(bucket, `orders/${orderId}.json`);
}

/**
 * 更新订单状态
 * @param {R2Bucket} bucket
 * @param {string} orderId
 * @param {string} status - 新状态
 * @param {object} extra - 额外字段（如 paidAt）
 */
export async function updateOrderStatus(bucket, orderId, status, extra = {}) {
  const order = await getOrder(bucket, orderId);
  if (!order) return null;
  order.status = status;
  Object.assign(order, extra);
  await writeJSON(bucket, `orders/${orderId}.json`, order);
  return order;
}

/**
 * 删除订单
 * @param {R2Bucket} bucket
 * @param {string} orderId
 */
export async function deleteOrder(bucket, orderId) {
  await bucket.delete(`orders/${orderId}.json`);
}

/**
 * 查找指定金额的最近 pending 订单（5 分钟窗口内）
 * 匹配规则：金额相同 + 状态为 pending + 创建时间在 5 分钟内
 * 多个匹配时返回创建时间最近的那个
 * @param {R2Bucket} bucket
 * @param {number} amount - 金额
 * @returns {Promise<object|null>} 匹配的订单，无匹配返回 null
 */
export async function findPendingOrderByAmount(bucket, amount) {
  const keys = await listKeys(bucket, 'orders/');
  const now = Date.now();
  const windowMs = 5 * 60 * 1000; // 5 分钟窗口
  let bestMatch = null;

  for (const key of keys) {
    const order = await readJSON(bucket, key);
    if (!order) continue;
    // 只匹配 pending 状态、金额相同、在时间窗口内的订单
    if (order.status !== 'pending') continue;
    if (order.amount !== amount) continue;
    if (now - order.createdAt > windowMs) continue;
    // 选创建时间最近的
    if (!bestMatch || order.createdAt > bestMatch.createdAt) {
      bestMatch = order;
    }
  }
  return bestMatch;
}

/**
 * 列出所有过期的 pending 订单（创建超过 30 分钟）
 * @param {R2Bucket} bucket
 * @returns {Promise<object[]>}
 */
export async function listExpiredOrders(bucket) {
  const keys = await listKeys(bucket, 'orders/');
  const now = Date.now();
  const expireMs = 30 * 60 * 1000; // 30 分钟
  const expired = [];

  for (const key of keys) {
    const order = await readJSON(bucket, key);
    if (!order) continue;
    if (order.status === 'pending' && now - order.createdAt > expireMs) {
      expired.push(order);
    }
  }
  return expired;
}

// ==================== Webhook 原始消息 ====================

/**
 * 存储 Webhook 原始消息
 * @param {R2Bucket} bucket
 * @param {object} rawData - 原始消息数据
 * @param {string} matchResult - 匹配结果：'matched' | 'unmatched' | 'already_completed'
 * @param {string|null} matchedOrderId - 匹配到的订单 ID（可选）
 * @returns {Promise<object>}
 */
export async function saveWebhookRaw(bucket, rawData, matchResult, matchedOrderId = null) {
  const id = generateUUID().substring(0, 8);
  const timestamp = Date.now();
  const key = `webhooks/${timestamp}_${id}.json`;
  const record = {
    id,
    timestamp,
    key,
    rawData,
    matchResult,
    matchedOrderId,
  };
  await writeJSON(bucket, key, record);
  return record;
}

/**
 * 获取 Webhook 原始消息列表（最近 50 条）
 * @param {R2Bucket} bucket
 * @returns {Promise<object[]>}
 */
export async function listWebhooks(bucket) {
  const keys = await listKeys(bucket, 'webhooks/');
  // 按 key 排序（时间戳前缀），取最近 50 条
  keys.sort().reverse();
  const recent = keys.slice(0, 50);
  const records = [];
  for (const key of recent) {
    const record = await readJSON(bucket, key);
    if (record) {
      record.key = key; // 添加 key 字段，用于删除操作
      records.push(record);
    }
  }
  return records;
}

/**
 * 列出所有 pending 状态的订单
 * @param {R2Bucket} bucket
 * @returns {Promise<object[]>}
 */
export async function listPendingOrders(bucket) {
  const keys = await listKeys(bucket, 'orders/');
  const orders = [];
  for (const key of keys) {
    const order = await readJSON(bucket, key);
    if (order && order.status === 'pending') {
      orders.push(order);
    }
  }
  return orders.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 删除 Webhook 原始消息
 * @param {R2Bucket} bucket
 * @param {string} key - 消息键名，如 webhooks/1234567890_abcdef.json
 */
export async function deleteWebhookRaw(bucket, key) {
  await bucket.delete(key);
}

// ==================== 工单系统 ====================

/**
 * 创建工单
 * @param {R2Bucket} bucket
 * @param {string} userId - 提交工单的用户 ID
 * @param {string} title - 工单标题
 * @param {string} content - 工单内容
 * @param {string} [type] - 工单类型: 'bug' | 'feature' | 'support' | 'other'
 * @returns {Promise<object>}
 */
export async function createWorkOrder(bucket, userId, title, content, type) {
  const id = generateUUID().substring(0, 8);
  const order = {
    id,
    userId,
    title,
    content,
    type: type || 'support',
    status: 'open',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    adminReply: null,
    repliedAt: null,
  };
  await writeJSON(bucket, `workorders/${id}.json`, order);
  return order;
}

/**
 * 列出工单
 * @param {R2Bucket} bucket
 * @param {string} [userId] - 可选，筛选指定用户的工单
 * @param {string} [status] - 可选，筛选指定状态的工单
 * @returns {Promise<object[]>}
 */
export async function listWorkOrders(bucket, userId, status) {
  const keys = await listKeys(bucket, 'workorders/');
  const orders = [];
  for (const key of keys) {
    const order = await readJSON(bucket, key);
    if (order) {
      if (userId && order.userId !== userId) continue;
      if (status && order.status !== status) continue;
      order.key = key;
      orders.push(order);
    }
  }
  return orders.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 获取单个工单
 * @param {R2Bucket} bucket
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getWorkOrder(bucket, id) {
  return readJSON(bucket, `workorders/${id}.json`);
}

/**
 * 更新工单状态/回复
 * @param {R2Bucket} bucket
 * @param {string} id
 * @param {object} updates - { status, adminReply, repliedAt }
 */
export async function updateWorkOrder(bucket, id, updates) {
  const order = await readJSON(bucket, `workorders/${id}.json`);
  if (!order) return null;
  if (updates.status) order.status = updates.status;
  if (updates.adminReply !== undefined) order.adminReply = updates.adminReply;
  if (updates.repliedAt) order.repliedAt = updates.repliedAt;
  order.updatedAt = Date.now();
  await writeJSON(bucket, `workorders/${id}.json`, order);
  return order;
}

/**
 * 删除工单
 * @param {R2Bucket} bucket
 * @param {string} id
 */
export async function deleteWorkOrder(bucket, id) {
  await bucket.delete(`workorders/${id}.json`);
}

// ==================== 管理员余额操作 ====================

/**
 * 管理员调整用户余额（增加或减少）
 * @param {R2Bucket} bucket
 * @param {string} userId
 * @param {number} amount - 正数为增加，负数为减少
 * @param {string} reason - 调整原因
 * @returns {Promise<object>} 更新后的用户信息
 */
export async function adminAdjustBalance(bucket, userId, amount, reason) {
  const user = await getUserById(bucket, userId);
  if (!user) throw new Error('用户不存在');
  const newBalance = Math.round(((user.balance || 0) + amount) * 100) / 100;
  if (newBalance < 0) throw new Error('余额不能为负数');
  user.balance = newBalance;
  user.updatedAt = Date.now();
  await writeJSON(bucket, `users/${userId}.json`, user);
  
  // 记录操作日志
  const logId = generateUUID().substring(0, 8);
  const log = {
    id: logId,
    userId,
    type: 'balance_adjust',
    amount,
    reason: reason || '',
    balanceBefore: user.balance - amount,
    balanceAfter: newBalance,
    createdAt: Date.now(),
  };
  await writeJSON(bucket, `logs/balance/${logId}.json`, log);
  
  return user;
}