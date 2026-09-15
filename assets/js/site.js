/* ==========================================================================
   site.js · 主题切换 / 卷帘播放头 / 悬停读数 / 卷帘键盘导航
   站点在不加载本文件时依然完整可读：音符默认全亮，主题跟随系统。
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var toArray = function (list) { return Array.prototype.slice.call(list); };

  /* ------------------------------------------------------------ 主题 */
  var toggle = doc.querySelector('[data-theme-toggle]');

  /* 手机浏览器的地址栏颜色跟着主题走（首屏由 <head> 里的同一段逻辑先设一次） */
  function paintChrome() {
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    meta.setAttribute('content', root.getAttribute('data-theme') === 'dark' ? '#1a1c1e' : '#f5f8f8');
  }

  function paintToggle() {
    if (!toggle) return;
    var dark = root.getAttribute('data-theme') === 'dark';
    /* 窄屏上和音效按钮一起挤，标签收短 */
    var narrow = window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
    toggle.textContent = dark ? (narrow ? '日间' : '日间调声') : (narrow ? '夜间' : '夜间调声');
    toggle.setAttribute('aria-pressed', dark ? 'true' : 'false');
    toggle.setAttribute('aria-label', dark ? '切换到日间调声（浅色）' : '切换到夜间调声（深色）');
  }

  if (toggle) {
    toggle.hidden = false;
    toggle.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.classList.add('is-theming');
      root.setAttribute('data-theme', next);
      try { window.localStorage.setItem('cv01-theme', next); } catch (e) { /* 隐私模式：忽略 */ }
      window.setTimeout(function () { root.classList.remove('is-theming'); }, 220);
      paintChrome();
      paintToggle();
    });
    paintToggle();

    if (window.matchMedia) {
      var mqTheme = window.matchMedia('(max-width: 720px)');
      var onThemeMq = function () { paintToggle(); };
      if (mqTheme.addEventListener) mqTheme.addEventListener('change', onThemeMq);
      else if (mqTheme.addListener) mqTheme.addListener(onThemeMq);
    }
  }

  /* ------------------------------------------------------------ 卷帘 */
  toArray(doc.querySelectorAll('[data-roll]')).forEach(function (roll) {
    var notes = toArray(roll.querySelectorAll('.note'));
    if (!notes.length) return;

    var live = roll.querySelector('[data-live]');
    var idle = live ? (live.getAttribute('data-idle') || '') : '';

    /* 卷帘只在窄屏上横向溢出：量过之后再决定要不要说「可以左右滑动」
       （提示本身由 roll.css 用 .is-scrollable 打开） */
    var scroller = roll.querySelector('.roll__scroller');
    if (scroller) {
      var measure = function () {
        roll.classList.toggle('is-scrollable', scroller.scrollWidth > scroller.clientWidth + 1);
      };
      measure();
      if (window.addEventListener) window.addEventListener('resize', measure);
    }

    /* 触摸设备上既没有指针也没有方向键，待机文案得换一套说辞 */
    if (live && window.matchMedia && window.matchMedia('(hover: none)').matches) {
      idle = '点音符直接读这篇，点左边的轨道名进板块';
      live.textContent = idle;
      live.setAttribute('data-idle', idle);
    }

    /* 播放头扫过一次，经过的音符依次点亮；随后全站再无自动动画 */
    if (reduce || !root.classList.contains('js')) {
      notes.forEach(function (n) { n.classList.add('is-lit'); });
    } else {
      notes.forEach(function (n) {
        var x = parseFloat(n.getAttribute('data-x') || '0');
        var at = Math.min(2200, (x / 78) * 2200);
        window.setTimeout(function () { n.classList.add('is-lit'); }, at);
      });
    }

    function show(note) {
      if (!live) return;
      live.textContent = note.getAttribute('data-pitch') + ' · ' +
        note.getAttribute('data-title') + ' · ' +
        note.getAttribute('data-min') + ' 分钟';
      live.classList.add('is-live');
    }
    function clear() {
      if (!live) return;
      live.textContent = idle;
      live.classList.remove('is-live');
    }

    notes.forEach(function (note) {
      note.addEventListener('mouseenter', function () { show(note); });
      note.addEventListener('mouseleave', clear);
      note.addEventListener('focus', function () { show(note); });
      note.addEventListener('blur', clear);
    });

    /* 键盘：上下换轨，左右在同一轨内沿时间轴移动，Home/End 到首尾 */
    roll.addEventListener('keydown', function (event) {
      var key = event.key;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(key) === -1) return;

      var current = doc.activeElement;
      if (notes.indexOf(current) === -1) return;
      event.preventDefault();

      var target = null;
      if (key === 'Home') {
        target = notes[0];
      } else if (key === 'End') {
        target = notes[notes.length - 1];
      } else if (key === 'ArrowUp' || key === 'ArrowDown') {
        target = notes[notes.indexOf(current) + (key === 'ArrowDown' ? 1 : -1)];
      } else {
        var lane = toArray(current.parentNode.querySelectorAll('.note'));
        target = lane[lane.indexOf(current) + (key === 'ArrowRight' ? 1 : -1)];
      }
      if (target) target.focus();
    });
  });

  /* ------------------------------------------------------- 每日一句
     以本地日期为种子，从胡盐乱雨集的句子里挑一句。
     同一天、所有页面、所有刷新都是同一句；过了本地零点自动换。 */
  var slot = doc.querySelector('[data-excerpt]');
  var pool = window.CV01_EXCERPTS;
  if (slot && pool && pool.length) {
    var now = new Date();
    var day = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    /* 整数散列：相邻的日期必须跳到句库里互不相邻的位置 */
    var h = day;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h ^= h >>> 16;
    slot.textContent = pool[Math.abs(h) % pool.length];
    slot.setAttribute('title', '每日一句 · 本地日期 ' + day + ' · 每 24 小时换一次');
  }
})();
