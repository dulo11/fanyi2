(() => {
  if (window.top === window) return;

  // 子 iframe 默认不再运行整套翻译扫描器。广告、嵌入播放器、第三方组件
  // 往往会创建大量 DOM；在手机 Chromium 上每个 frame 各跑一套会明显拖慢主页面。
  window.__FLOATING_TRANSLATOR_LOADED__ = true;
  window.__FLOATING_TRANSLATOR_ATTRIBUTES__ = true;
  window.__FLOATING_TRANSLATOR_V07__ = true;
  window.__FLOATING_TRANSLATOR_MIXED_GUARD__ = true;
})();