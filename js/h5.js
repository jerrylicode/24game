/* =========================================================
   h5.js —— 移动端 / H5 适配层
   解决这些移动端专有问题：
     1. 地址栏伸缩导致 100vh 错位（iOS Safari / 微信 / 各家 WebView）
     2. 低版本 WebView 没有 PointerEvent，拖拽完全失效
     3. 双指缩放、长按菜单、双击放大、拖动时页面跟着滚
     4. 视口变化（转屏/软键盘）后弹窗需要重新定位
     5. CSS :has() 在旧内核不支持（这里只负责探测并打标记）
   对外暴露：G24.H5
   ========================================================= */
(function (global) {
  'use strict';
  const G24 = global.G24 || (global.G24 = {});
  const doc = global.document;

  const listeners = new Set();   // 视口变化回调

  const H5 = {
    /** 是否是触摸设备 */
    isTouch: false,
    /** 本机是否原生支持 Pointer Events */
    hasPointerEvent: typeof global.PointerEvent === 'function',
    /** 是否以“独立应用”方式打开（添加到主屏） */
    isStandalone: false,
    /** 是否支持 CSS :has() */
    hasHas: true,
    /** 是否使用了动画兜底（老内核） */
    animationShimmed: false,
    /** 是否在微信内打开 */
    isWeChat: false,
    /** 是否在 QQ / QQ 浏览器内打开 */
    isQQ: false,
    /** 是否可安装（beforeinstallprompt 事件已触发） */
    canInstall: false,
    /** Service Worker 是否注册成功 */
    swReady: false,
    /** Service Worker 注册失败原因 */
    swError: null,
    /** PWA 安装提示事件（供 UI 调用 prompt()） */
    _installEvent: null,
    /** 微信 JS 桥是否就绪 */
    weixinReady: false,
    _weixinCallbacks: [],

    /* ---------- 视口 ---------- */

    /** 用真实可视高度写 --app-h，避开移动端 vh/dvh 的坑 */
    syncHeight() {
      const vv = global.visualViewport;
      const h = Math.round((vv && vv.height) || global.innerHeight || 0);
      if (h > 0) doc.documentElement.style.setProperty('--app-h', h + 'px');
      return h;
    },

    /** 注册视口变化回调（转屏、地址栏伸缩、软键盘弹出） */
    onViewportChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    _emitViewport() {
      H5.syncHeight();
      for (const fn of listeners) { try { fn(); } catch (e) { /* 回调自身出错不影响其他人 */ } }
    },

    /* ---------- 微信 ---------- */

    /**
     * 微信（尤其 iOS）的音频策略：Web Audio 必须等到 WeixinJSBridge 就绪、
     * 并且在一手势里 resume 才能出声。这里两件事都做：
     *   1) 监听 WeixinJSBridgeReady → 解锁音频
     *   2) 用经典的 getNetworkType 空调用“预热”音频通道（不这么做有时首音会被吞掉）
     */
    setupWeChatAudio() {
      if (!H5.isWeChat) return;
      const unlock = () => {
        H5.weixinReady = true;
        const Sfx = G24.Sfx;
        try {
          if (global.WeixinJSBridge && global.WeixinJSBridge.invoke) {
            global.WeixinJSBridge.invoke('getNetworkType', {}, () => {});
          }
        } catch (e) { /* 某些版本不支持，忽略 */ }
        if (Sfx && Sfx.unlock) Sfx.unlock();
        H5._weixinCallbacks.splice(0).forEach((fn) => { try { fn(); } catch (e) { /* 忽略 */ } });
      };
      if (global.WeixinJSBridge) unlock();
      else doc.addEventListener('WeixinJSBridgeReady', unlock, false);
    },

    /** 微信桥就绪后执行（已就绪则立刻执行） */
    onWeixinReady(fn) {
      if (H5.weixinReady) { fn(); return () => {}; }
      H5._weixinCallbacks.push(fn);
      return () => {
        const i = H5._weixinCallbacks.indexOf(fn);
        if (i >= 0) H5._weixinCallbacks.splice(i, 1);
      };
    },

    /* ---------- PWA ---------- */

    /** 注册 Service Worker（离线缓存）。file:// 打开或非安全上下文会自动跳过 */
    registerServiceWorker(opts = {}) {
      if (!('serviceWorker' in global.navigator)) {
        H5.swError = '当前浏览器不支持 Service Worker';
        return Promise.resolve(false);
      }
      const proto = global.location.protocol;
      if (proto !== 'https:' && proto !== 'http:') {
        H5.swError = '需要 http(s) 环境才能离线缓存（当前 ' + proto + '）';
        return Promise.resolve(false);
      }
      if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(global.location.hostname) === false && proto === 'http:') {
        // http 下只有 localhost 算安全上下文，其它域名会注册失败，先提示清楚
        H5.swError = '非 localhost 的 http 页面无法注册 Service Worker';
        return Promise.resolve(false);
      }
      const url = opts.url || './sw.js';
      return global.navigator.serviceWorker.register(url, { scope: opts.scope || './' })
        .then((reg) => {
          H5.swReady = true;
          H5.swError = null;
          H5._swReg = reg;
          // 有更新就悄悄装上，等下次进入生效
          reg.addEventListener && reg.addEventListener('updatefound', () => {
            const sw = reg.installing;
            if (!sw) return;
            sw.addEventListener('statechange', () => {
              if (sw.state === 'installed' && global.navigator.serviceWorker.controller) {
                if (opts.onUpdate) opts.onUpdate();
              }
            });
          });
          return true;
        })
        .catch((err) => {
          H5.swReady = false;
          H5.swError = (err && err.message) || String(err);
          return false;
        });
    },

    /** 体检离线缓存内容（?debug=1 面板与自动化自检用） */
    async inspectCache() {
      if (!global.caches || !global.caches.keys) {
        H5.cacheInfo = { supported: false };
        return H5.cacheInfo;
      }
      try {
        const names = await global.caches.keys();
        const active = names.find((k) => k.startsWith('game24-')) || null;
        let count = 0; let hasIndex = false;
        if (active) {
          const cache = await global.caches.open(active);
          const reqs = await cache.keys();
          count = reqs.length;
          hasIndex = reqs.some((r) => /(\/index\.html|\/)$/.test(new URL(r.url).pathname));
        }
        H5.cacheInfo = { supported: true, names, active, count, hasIndex };
      } catch (e) {
        H5.cacheInfo = { supported: true, error: e.message };
      }
      return H5.cacheInfo;
    },

    /** 监听 Chrome/安卓的“安装到桌面”事件 */
    setupInstallPrompt() {
      global.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        H5._installEvent = e;
        H5.canInstall = true;
        H5._emitInstall();
      });
      global.addEventListener('appinstalled', () => {
        H5._installEvent = null;
        H5.canInstall = false;
        H5._emitInstall();
      });
    },

    _installListeners: new Set(),
    onInstallChange(fn) { H5._installListeners.add(fn); return () => H5._installListeners.delete(fn); },
    _emitInstall() { for (const fn of H5._installListeners) { try { fn(H5.canInstall); } catch (e) { /* 忽略 */ } } },

    /** 触发安装弹窗，返回用户是否接受 */
    promptInstall() {
      const ev = H5._installEvent;
      if (!ev) return Promise.resolve(false);
      ev.prompt();
      H5._installEvent = null;
      H5.canInstall = false;
      H5._emitInstall();
      return ev.userChoice.then((res) => (res && res.outcome) === 'accepted').catch(() => false);
    },

    /* ---------- 横屏 / 姿态 ---------- */

    /** 'portrait' | 'landscape' */
    orientation() {
      if (global.matchMedia && global.matchMedia('(orientation: landscape)').matches) return 'landscape';
      return (global.innerWidth || 0) > (global.innerHeight || 0) ? 'landscape' : 'portrait';
    },

    /** 横屏且视口很矮 —— 这种时候布局再紧凑也憋屈，值得提示用户转回竖屏 */
    isCrampedLandscape() {
      const h = (global.visualViewport && global.visualViewport.height) || global.innerHeight || 0;
      return H5.isTouch && H5.orientation() === 'landscape' && h <= 500;
    },

    /* ---------- 分享 ---------- */

    /** 微信内只能用右上角菜单分享；其它环境优先系统分享面板 */
    async share(payload) {
      const data = payload || {};
      if (H5.isWeChat) return { via: 'guide' };
      if (global.navigator.share) {
        try {
          await global.navigator.share({ title: data.title, text: data.text, url: data.url || global.location.href });
          return { via: 'share' };
        } catch (e) {
          if (e && e.name === 'AbortError') return { via: 'cancel' };
        }
      }
      const url = data.url || global.location.href;
      try {
        if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
          await global.navigator.clipboard.writeText(url);
          return { via: 'clipboard' };
        }
      } catch (e) { /* 走下面的兜底 */ }
      try {
        const ta = doc.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        doc.body.appendChild(ta);
        ta.select();
        const ok = doc.execCommand && doc.execCommand('copy');
        ta.remove();
        return { via: ok ? 'clipboard' : 'manual', url };
      } catch (e) {
        return { via: 'manual', url };
      }
    },

    /**
     * 给 ?debug=1 面板用的视口/布局体检数据：
     * 能直接看出有没有横向溢出、牌桌有没有被裁、按钮够不够大。
     */
    debugInfo(dom, state) {
      const de = doc.documentElement;
      const app = doc.getElementById('app');
      const box = (el) => (el ? el.getBoundingClientRect() : null);
      const table = box(dom.table);
      const board = box(dom.board);
      const first = dom.board.querySelector('.card');
      const ringBtn = dom.popup ? dom.popup.querySelector('.op-ring__item') : null;
      const r = (n) => Math.round(n);
      return {
        vw: global.innerWidth,
        vh: global.innerHeight,
        vvH: global.visualViewport ? r(global.visualViewport.height) : null,
        appH: app ? r(app.getBoundingClientRect().height) : 0,
        overflowX: de.scrollWidth - global.innerWidth,
        overflowY: de.scrollHeight - global.innerHeight,
        boardFits: !!(table && board) && board.top >= table.top - 1 && board.bottom <= table.bottom + 1,
        tableW: table ? r(table.width) : 0,
        tableH: table ? r(table.height) : 0,
        tableTop: table ? r(table.top) : 0,
        tableBottom: table ? r(table.bottom) : 0,
        boardW: board ? r(board.width) : 0,
        boardH: board ? r(board.height) : 0,
        boardTop: board ? r(board.top) : 0,
        boardLift: dom.board && dom.board.style.getPropertyValue
          ? dom.board.style.getPropertyValue('--lift') || '0px'
          : '0px',
        boardBottom: board ? r(board.bottom) : 0,
        cardCount: dom.board.children.length,
        cardW: first ? first.offsetWidth : 0,
        cardH: first ? first.offsetHeight : 0,
        ringBtnH: ringBtn ? ringBtn.offsetHeight : 0,
        isTouch: H5.isTouch,
        hasPointerEvent: typeof global.PointerEvent === 'function',
        hasHas: H5.hasHas,
        standalone: H5.isStandalone,
        orientation: H5.orientation(),
        rotateHint: dom.rotateHint
          ? { hidden: !!dom.rotateHint.hidden, everShown: dom.rotateHint.dataset.everShown === '1' }
          : null,
        crampedLandscape: H5.isCrampedLandscape(),
        wechat: H5.isWeChat,
        weixinReady: H5.weixinReady,
        swReady: H5.swReady,
        swError: H5.swError,
        canInstall: H5.canInstall,
        cacheInfo: H5.cacheInfo || null,
        cards: state ? state.cards.length : null,
      };
    },

    /**
     * 极老内核（Chromium < 36 / 部分定制 WebView）没有 Web Animations API，
     * el.animate() 会直接抛错。这里补一个“没有动画的动画”：
     * 直接落到最后一帧的样子并立即 resolve，游戏流程完全不受影响。
     * 现代浏览器有原生实现时不会走到这里。
     */
    installAnimationShim() {
      const proto = global.Element && global.Element.prototype;
      if (!proto || typeof proto.animate === 'function') return false;
      proto.animate = function (keyframes, options) {
        const frames = Array.isArray(keyframes) ? keyframes : [keyframes];
        const last = frames[frames.length - 1] || {};
        for (const k in last) {
          if (k === 'offset' || k === 'easing') continue;
          try { this.style[k] = last[k]; } catch (e) { /* 个别属性只读，忽略 */ }
        }
        const anim = {
          finished: Promise.resolve(),
          play() {}, pause() {}, cancel() {}, finish() {}, reverse() {},
          addEventListener() {}, removeEventListener() {},
        };
        return anim;
      };
      H5.animationShimmed = true;
      return true;
    },

    /* ---------- 初始化 ---------- */

    setup() {
      const html = doc.documentElement;
      const mm = (q) => !!(global.matchMedia && global.matchMedia(q).matches);

      H5.isTouch = ('ontouchstart' in global)
        || (global.navigator && global.navigator.maxTouchPoints > 0)
        || mm('(pointer: coarse)');
      // ?touch=1 / ?touch=0 可强制覆盖（桌面调试移动端观感、或自动化测试用）
      const force = new URLSearchParams(global.location.search).get('touch');
      if (force === '1') H5.isTouch = true;
      else if (force === '0') H5.isTouch = false;
      H5.isStandalone = mm('(display-mode: standalone)')
        || mm('(display-mode: fullscreen)')
        || global.navigator.standalone === true;
      H5.hasHas = !!(global.CSS && global.CSS.supports && global.CSS.supports('selector(:has(*))'));

      html.classList.toggle('is-touch', H5.isTouch);
      html.classList.toggle('is-standalone', H5.isStandalone);
      html.classList.toggle('no-pointer-event', !H5.hasPointerEvent);
      html.classList.toggle('no-has', !H5.hasHas);

      H5.syncHeight();
      global.addEventListener('resize', H5._emitViewport, { passive: true });
      global.addEventListener('orientationchange', () => setTimeout(H5._emitViewport, 260));
      if (global.visualViewport) {
        global.visualViewport.addEventListener('resize', H5._emitViewport, { passive: true });
        global.visualViewport.addEventListener('scroll', H5._emitViewport, { passive: true });
      }
      // 页面重新可见时（从后台切回来）：重新量一次视口，并补一次音频解锁
      // —— iOS / 微信把页面切到后台会挂起 AudioContext，回来不 resume 就没声音了
      doc.addEventListener('visibilitychange', () => {
        if (doc.hidden) return;
        H5._emitViewport();
        const Sfx = G24.Sfx;
        if (Sfx && Sfx.unlock) { try { Sfx.unlock(); } catch (e) { /* 忽略 */ } }
      });

      const ua = (global.navigator && global.navigator.userAgent) || '';
      const q = new URLSearchParams(global.location.search);
      H5.isWeChat = q.get('wx') === '1' ? true : q.get('wx') === '0' ? false : /micromessenger/i.test(ua);
      H5.isQQ = /\sQQ\//i.test(ua) || /QQBrowser/i.test(ua);
      html.classList.toggle('is-wechat', H5.isWeChat);
      html.classList.toggle('is-qq', H5.isQQ);
      html.classList.toggle('is-ios', /iPad|iPhone|iPod/.test(ua) || (global.navigator && global.navigator.platform === 'MacIntel' && global.navigator.maxTouchPoints > 1));

      H5.blockNativeGestures();
      if (!H5.hasPointerEvent) H5.installPointerShim();
      H5.installAnimationShim();
      H5.setupWeChatAudio();
      H5.setupInstallPrompt();
      return H5;
    },

    /** 挡掉双指缩放、长按菜单、拖动时的页面滚动 */
    blockNativeGestures() {
      // iOS 的捏合手势
      ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => {
        doc.addEventListener(t, (e) => e.preventDefault(), { passive: false });
      });
      // 长按弹出菜单/图片拖拽（只在游戏区域内拦）
      doc.addEventListener('contextmenu', (e) => {
        if (e.target && e.target.closest && e.target.closest('.app')) e.preventDefault();
      });
      // 拖牌时跟着滚动：整页本身不滚动，这里彻底关掉 touchmove 的默认行为
      doc.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches.length > 1) { e.preventDefault(); return; }
        if (e.target && e.target.closest && e.target.closest('.app')) e.preventDefault();
      }, { passive: false });
    },

    /**
     * 给没有 Pointer Events 的旧内核（Android 4.4/5 WebView、部分 X5 内核）
     * 补一层：把 touch 事件翻译成 pointer* 事件，游戏逻辑一行都不用改。
     */
    installPointerShim() {
      const shimType = global.PointerEvent ? global.PointerEvent : class PointerEventShim extends global.MouseEvent {
        constructor(type, params = {}) {
          super(type, params);
          this.pointerId = params.pointerId == null ? 1 : params.pointerId;
          this.pointerType = params.pointerType || 'touch';
          this.isPrimary = params.isPrimary !== false;
          this.buttons = params.buttons == null ? 1 : params.buttons;
        }
      };
      global.PointerEvent = shimType;

      const fire = (type, touch, srcEvent, target, buttons) => {
        const ev = new shimType(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: touch.clientX,
          clientY: touch.clientY,
          screenX: touch.screenX,
          screenY: touch.screenY,
          pointerId: touch.identifier == null ? 1 : touch.identifier,
          pointerType: 'touch',
          isPrimary: true,
          buttons,
        });
        (target || global).dispatchEvent(ev);
      };
      const opts = { passive: false };
      doc.addEventListener('touchstart', (e) => {
        const t = e.changedTouches[0];
        fire('pointerdown', t, e, e.target, 1);
      }, opts);
      doc.addEventListener('touchmove', (e) => {
        const t = e.changedTouches[0];
        fire('pointermove', t, e, global, 1);
      }, opts);
      const end = (type) => (e) => {
        const t = e.changedTouches[0];
        fire(type === 'touchend' ? 'pointerup' : 'pointercancel', t, e, global, 0);
      };
      doc.addEventListener('touchend', end('touchend'), opts);
      doc.addEventListener('touchcancel', end('touchcancel'), opts);
    },
  };

  G24.H5 = H5;
})(typeof window !== 'undefined' ? window : globalThis);
