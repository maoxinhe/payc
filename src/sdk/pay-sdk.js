/**
 * PaySDK — 通用支付接入 SDK
 * 
 * 支持环境：浏览器 / Node.js / Electron / Android WebView / 任何 JS 运行环境
 * 
 * 使用方式：
 *   浏览器：<script src="https://your-worker.dev/sdk/pay-sdk.js"></script>
 *   Node.js：const PaySDK = require('./pay-sdk.js');
 * 
 * 接入流程：
 *   1. PaySDK.init({ apiKey: 'pk_xxx' })
 *   2. 一键支付（推荐）：PaySDK.pay(100, { onSuccess: fn, onExpire: fn })
 *   3. 分步调用：createOrder → openPay → waitForPayment
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PaySDK = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ==================== 配置 ====================

  var config = {
    apiKey: '',
    baseUrl: '',
    pollInterval: 1000,
    timeout: 30 * 60 * 1000,
  };

  // ==================== 内部工具 ====================

  function request(path, options) {
    options = options || {};
    var url = config.baseUrl + path;
    var headers = options.headers || {};
    headers['X-API-Key'] = config.apiKey;

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    return fetch(url, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body || undefined,
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) {
          var err = new Error(data.error || '请求失败 (' + r.status + ')');
          err.code = r.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // ==================== 公开 API ====================

  /**
   * 初始化 SDK
   * @param {Object} opts
   * @param {string} opts.apiKey   - API Key（必填）
   * @param {string} [opts.baseUrl] - 服务端地址，默认自动检测当前域名
   * @param {number} [opts.pollInterval] - 轮询间隔，默认 1000ms
   * @returns {Object} PaySDK 实例
   * 
   * @example
   * PaySDK.init({ apiKey: 'pk_abc123' });
   */
  function init(opts) {
    if (!opts || !opts.apiKey) {
      throw new Error('PaySDK.init: apiKey 为必填参数');
    }
    config.apiKey = opts.apiKey;
    if (opts.baseUrl) {
      config.baseUrl = opts.baseUrl.replace(/\/$/, '');
    } else if (typeof location !== 'undefined') {
      config.baseUrl = location.protocol + '//' + location.host;
    } else {
      throw new Error('PaySDK.init: 非浏览器环境请提供 baseUrl 参数');
    }
    if (opts.pollInterval) config.pollInterval = opts.pollInterval;
    return PaySDK;
  }

  /**
   * 创建订单
   * @param {number} amount - 金额（元），支持两位小数
   * @param {string} [productName] - 商品名称（可选，用于在付款页面显示）
   * @returns {Promise<{orderId: string, amount: number, requestedAmount: number, payUrl: string, status: string}>}
   * 
   * @example
   * var order = await PaySDK.createOrder(99.99, '游戏激活码');
   * window.open(order.payUrl);
   */
  function createOrder(amount, productName) {
    if (!config.apiKey) throw new Error('请先调用 PaySDK.init() 初始化');
    if (!amount || amount <= 0) throw new Error('金额必须大于 0');

    var body = { amount: amount };
    if (productName) body.productName = productName;

    return request('/api/order/create', {
      method: 'POST',
      body: body,
    });
  }

  /**
   * 一键拉起支付：创建订单并打开付款页面
   * @param {number} amount    - 金额（元）
   * @param {Object} [opts]
   * @param {string} [opts.productName] - 商品名称（可选，用于在付款页面显示）
   * @param {string} [opts.target] - 窗口打开方式：'_blank'(默认) | '_self'
   * @param {Function} [opts.onCreated] - 订单创建成功回调，参数为订单对象
   * @returns {Promise<{orderId: string, amount: number, payUrl: string, status: string}>}
   * 
   * @example
   * PaySDK.openPay(100, {
   *   productName: '钻石礼包',
   *   onCreated: function(order) { console.log('订单已创建', order.orderId); }
   * });
   */
  function openPay(amount, opts) {
    opts = opts || {};
    return createOrder(amount, opts.productName).then(function (order) {
      if (opts.onCreated) opts.onCreated(order);
      if (typeof window !== 'undefined' && window.open && order.payUrl) {
        window.open(order.payUrl, opts.target || '_blank');
      }
      return order;
    });
  }

  /**
   * 一键支付（创建订单 + 打开付款页面 + 轮询回调）
   * 推荐使用，最简单的方式完成支付流程
   * 
   * @param {number} amount    - 金额（元）
   * @param {Object} [opts]
   * @param {string} [opts.productName] - 商品名称（可选，用于在付款页面显示）
   * @param {string} [opts.target] - 窗口打开方式：'_blank'(默认) | '_self'
   * @param {Function} [opts.onCreated] - 订单创建成功回调
   * @param {Function} [opts.onSuccess] - 支付成功回调，参数为订单对象
   * @param {Function} [opts.onExpire] - 订单过期回调
   * @param {Function} [opts.onError] - 错误回调
   * @returns {{ stop: Function, orderId: string|null }} 返回 { stop } 可手动停止轮询
   * 
   * @example
   * // 最简单：带成功回调
   * PaySDK.pay(100, {
   *   onSuccess: function(order) {
   *     alert('支付成功！金额：￥' + order.payAmount);
   *   }
   * });
   * 
   * @example
   * // 完整回调
   * var result = PaySDK.pay(100, {
   *   onCreated: function(order) { console.log('订单创建', order.orderId); },
   *   onSuccess: function(order) {
   *     console.log('支付成功', order.payAmount, order.payTime);
   *     // 发货、激活、更新UI等
   *   },
   *   onExpire: function() { console.log('订单过期'); },
   *   onError: function(err) { console.error('支付失败', err); }
   * });
   * 
   * // 手动停止轮询
   * result.stop();
   */
  function pay(amount, opts) {
    opts = opts || {};
    var self = { stop: function () {}, orderId: null };

    createOrder(amount, opts.productName).then(function (order) {
      self.orderId = order.orderId;
      if (opts.onCreated) opts.onCreated(order);

      // 打开付款页面
      if (typeof window !== 'undefined' && window.open && order.payUrl) {
        window.open(order.payUrl, opts.target || '_blank');
      }

      // 开始轮询
      self.stop = startPoll(order.orderId, opts);
    }).catch(function (err) {
      if (opts.onError) opts.onError(err);
      else console.error('[PaySDK] pay error:', err.message);
    });

    return self;
  }

  // 开始轮询（内部函数）
  function startPoll(orderId, opts) {
    var timer = null;
    var stopped = false;

    function poll() {
      if (stopped) return;
      checkOrder(orderId).then(function (order) {
        if (stopped) return;
        if (order.status === 'completed') {
          clearInterval(timer);
          stopped = true;
          if (opts.onSuccess) opts.onSuccess(order);
        } else if (order.status === 'expired' || Date.now() - order.createdAt > config.timeout) {
          clearInterval(timer);
          stopped = true;
          if (opts.onExpire) opts.onExpire(order);
        }
      }).catch(function (err) {
        if (stopped) return;
        console.error('[PaySDK] 轮询错误:', err.message);
      });
    }

    poll();
    timer = setInterval(poll, config.pollInterval);

    return function () {
      stopped = true;
      clearInterval(timer);
    };
  }

  /**
   * 查询订单状态
   * @param {string} orderId - 订单 ID
   * @returns {Promise<object>}
   *   status 可能值：'pending'(待支付) | 'completed'(已支付) | 'expired'(已过期)
   * 
   * @example
   * var order = await PaySDK.checkOrder('msiq4zo7okp3tr');
   * if (order.status === 'completed') {
   *   console.log('支付成功，金额：￥' + order.payAmount);
   * }
   */
  function checkOrder(orderId) {
    if (!config.apiKey) throw new Error('请先调用 PaySDK.init() 初始化');
    if (!orderId) throw new Error('请提供订单 ID');
    return request('/api/order/' + orderId + '/status');
  }

  /**
   * 轮询等待支付完成
   * @param {string} orderId     - 订单 ID
   * @param {Function} onSuccess - 支付成功回调
   * @param {Function} [onExpire] - 订单过期回调
   * @returns {{ stop: Function }} 返回 { stop } 可手动停止轮询
   * 
   * @example
   * var waiter = PaySDK.waitForPayment('msiq4zo7okp3tr', function(order) {
   *   console.log('支付成功！金额：￥' + order.payAmount);
   * }, function() {
   *   console.log('订单已过期');
   * });
   * 
   * // 可手动停止轮询
   * waiter.stop();
   */
  function waitForPayment(orderId, onSuccess, onExpire) {
    if (!orderId) throw new Error('请提供订单 ID');
    if (!onSuccess) throw new Error('请提供 onSuccess 回调');

    var opts = { onSuccess: onSuccess };
    if (onExpire) opts.onExpire = onExpire;

    return { stop: startPoll(orderId, opts) };
  }

  /**
   * 获取当前配置（调试用）
   * @returns {Object}
   */
  function getConfig() {
    return {
      apiKey: config.apiKey ? config.apiKey.substring(0, 6) + '***' : '',
      baseUrl: config.baseUrl,
      pollInterval: config.pollInterval,
    };
  }

  // ==================== 导出 ====================

  var PaySDK = {
    init: init,
    createOrder: createOrder,
    openPay: openPay,
    pay: pay,
    checkOrder: checkOrder,
    waitForPayment: waitForPayment,
    getConfig: getConfig,
    version: '1.1.0',
  };

  return PaySDK;
}));