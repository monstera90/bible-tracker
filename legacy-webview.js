/* ===========================================================================
   legacy-webview.js
   Версия: 1.0 (11.10) — новый файл. Совместимость со старым WebView (Android 5-7, где «Android System WebView»
   застревает на Chrome ~95): то, что в современном браузере делает CSS, но старый движок не понимает.
   Подключается в index.html сразу после opfs-shim.js, раньше остальных скриптов. В современных браузерах пункт 1
   сам себя отключает (проверка CSS.supports), пункт 2 безвреден везде.

   1. Замена селектора :has() (Chrome 105+). В modals.css на нём два правила; без него на старом WebView у окна
      настроек оставались боковые поля/рамка на вкладках «Мой блокнот» и ридера книги, а кнопка-язычок
      не пряталась в режиме чтения. Здесь те же условия считаются из JS и записываются классами
      (.settings-modal-box.lt-flush-sides, body.lt-reading-open) — CSS для них лежит рядом с исходными правилами.
   2. Блокировка прокрутки страницы под открытым окном. Пока открыто окно настроек (или диалог), корневой
      скролл страницы отключается (html.lt-scroll-lock { overflow:hidden }): когда в окне прокручивать нечего,
      жест больше не «протекает» в график чтения под ним. overscroll-behavior:contain у #settingsTabContent
      этого не делает, если содержимое помещается целиком, — на новых WebView жест всё же гасится, на старых нет.
   =========================================================================== */
(function () {
  "use strict";

  var hasSupported = false;
  try { hasSupported = !!(window.CSS && CSS.supports && CSS.supports("selector(:has(*))")); } catch (e) { hasSupported = false; }

  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function observe(target, options, cb) {
    if (!target || typeof MutationObserver !== "function") return;
    try { new MutationObserver(cb).observe(target, options); } catch (e) {}
  }

  // 1. :has()
  function installHasFallback() {
    var content = document.getElementById("settingsTabContent");
    var box = content ? content.parentElement : null;
    if (box && box.classList.contains("settings-modal-box")) {
      var updateFlush = function () {
        var flush = false;
        for (var i = 0; i < content.children.length; i++) {
          var c = content.children[i];
          if (c.classList.contains("mdeditor-tab") || c.classList.contains("book-reader-tab")) { flush = true; break; }
        }
        box.classList.toggle("lt-flush-sides", flush);
      };
      updateFlush();
      observe(content, { childList: true }, updateFlush);
    }
    var overlay = document.querySelector(".settings-modal-overlay");
    if (overlay) {
      var updateReading = function () {
        var on = overlay.classList.contains("open") && overlay.classList.contains("reading-mode-active");
        if (document.body) document.body.classList.toggle("lt-reading-open", on);
      };
      updateReading();
      observe(overlay, { attributes: true, attributeFilter: ["class"] }, updateReading);
    }
  }

  // 2. Блокировка прокрутки страницы под окном
  function installScrollLock() {
    var style = document.createElement("style");
    style.textContent = "html.lt-scroll-lock, html.lt-scroll-lock body { overflow: hidden !important; }";
    (document.head || document.documentElement).appendChild(style);

    var scheduled = false;
    function apply() {
      scheduled = false;
      var open = !!document.querySelector(".settings-modal-overlay.open, .modal-overlay.open");
      document.documentElement.classList.toggle("lt-scroll-lock", open);
    }
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      if (window.requestAnimationFrame) window.requestAnimationFrame(apply);
      else setTimeout(apply, 16);
    }
    apply();
    observe(document.documentElement, { attributes: true, attributeFilter: ["class"], subtree: true, childList: false }, schedule);
    observe(document.body, { childList: true }, schedule);
  }

  onReady(function () {
    if (!hasSupported) installHasFallback();
    installScrollLock();
  });

  window.LegacyWebview = { hasSelector: hasSupported };
})();
