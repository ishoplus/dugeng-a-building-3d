// 首頁（index.html #home）：一般 script 不等 3D 模組，打開就能按；伺服器 CSP 擋行內腳本，所以獨立成檔
// 帶了指定參數（分享連結、截圖、測試）直接進 3D；首頁按鈕在 3D 程式載入前就能按，先記下來
(function () {
  var q = new URLSearchParams(location.search), home = document.getElementById('home');
  if (['mode', 'req', 'shot', 'selftest', 'scheme', 'venue', 'unit', 'floor'].some(function (k) { return q.has(k); })) home.classList.remove('open');
  home.addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]'); if (!b) return;
    home.classList.remove('open'); home.scrollTop = 0;
    if (window.homeGo) window.homeGo(b.dataset.go, b.dataset.unit); else window.homePending = [b.dataset.go, b.dataset.unit];
  });
})();
