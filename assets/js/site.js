/* ==========================================================================
   site.js · 主题切换 / 时间轴播放头 / 悬停读数 / 时间轴键盘导航
   站点在不加载本文件时依然完整可读：音符按生成器烤好的位置排开，全亮，
   主题跟随系统。

   分两半：
     · 主题开关、resize 量尺 —— 整个会话只装一次
     · initPage() —— 跟着「当前这一页的正文」走（时间轴、每日一句）；
       nav.js 局部换完正文之后会再喊它一遍，所以每次切页播放头都会重扫。
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var cv01 = (window.cv01 = window.cv01 || {});
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var toArray = function (list) { return Array.prototype.slice.call(list); };

  /* ------------------------------------------------------------- 接龙比例尺
     首页那条大卷帘的横轴是接龙：文章按日期从旧到新排成一列，一篇紧挨一篇
     往右接——中间隔了三天还是十个月，都只是一个音符的宽度加一格休止，
     没发博的日子不留空白。同月的几篇天然挨在一起，各自是独立的音符，
     不归拢、不折叠。这份算式与生成器（server/lib/shell.mjs 的
     timelineChain / chainMonths）是同一套，两边要一起改：静态页烤着
     生成器算好的位置；运行时新写的文章进来后，layoutTimeline 按同一把尺
     把整条时间轴（音符、月份刻度）重排一遍。 */
  var HEAD_DAYS = 2;   /* 左端留白 */
  var REST_DAYS = 4;   /* 相邻两篇之间的休止 */
  var TAIL_DAYS = 14;  /* 右端留白：还没写的下一篇，只留一格 */
  function layoutTimeline(roll) {
    var ruler = roll.querySelector('.roll__ruler');
    var dated = toArray(roll.querySelectorAll('.note')).filter(function (n) {
      return /^(\d{4})\.(\d{2})\.(\d{2})$/.test(String(n.getAttribute('data-date') || ''));
    });
    if (!dated.length || !ruler) return;

    /* 接龙：按日期从旧到新排成一列（排序稳定，同一天按轨道自上而下的
       次序接——与生成器同一规则）；每个音符占 min×1.3 天（压在 5–11 之间） */
    dated.sort(function (a, b) {
      var da = a.getAttribute('data-date'), db = b.getAttribute('data-date');
      return da < db ? -1 : da > db ? 1 : 0;
    });
    var cursor = HEAD_DAYS;
    var months = [];
    var lastMonth = '';
    dated.forEach(function (n) {
      var w = Math.min(11, Math.max(5, (parseFloat(n.getAttribute('data-min')) || 5) * 1.3));
      var month = String(n.getAttribute('data-date')).slice(0, 7);
      if (month !== lastMonth) {
        months.push({ x: cursor, label: month, count: 1 });
        lastMonth = month;
      } else {
        months[months.length - 1].count += 1;
      }
      n.__cv01Day = { x: cursor, w: w };
      cursor += w + REST_DAYS;
    });
    var span = cursor - REST_DAYS + TAIL_DAYS;

    /* 画布跟着压缩过的日子走：运行时文章接上来，轴就往右长出新的地去 */
    roll.style.setProperty('--days', String(Math.ceil(span)));

    dated.forEach(function (n) {
      var day = n.__cv01Day;
      delete n.__cv01Day;
      var x = (day.x / span) * 100;
      n.style.setProperty('--x', x.toFixed(2));
      n.style.setProperty('--w', day.w.toFixed(2));
      n.setAttribute('data-x', x.toFixed(2));
    });

    /* 顶部刻度：每个月的牌子挂在这个月第一篇音符的起点上，牌子后面
       带着这个月的篇数（只有一篇的不报数）——只报数，不归拢。
       接龙轴上月份不再等宽，但先后还在：牌子按月序排，永不互相压住；
       没发博的月份天然没有牌子。轨道场里不拉月份竖线，音符自己就是刻度。 */
    ruler.innerHTML = months.map(function (m) {
      var text = m.label + (m.count > 1 ? ' · ' + m.count + ' 篇' : '');
      return '<span class="roll__month" style="--x:' + ((m.x / span) * 100).toFixed(2) + '">' + text + '</span>';
    }).join('');

    /* 音符重排过，横向的宽窄可能变——「可以左右滑动」的提示重新量一遍 */
    measureRolls();
  }

  /* ------------------------------------------------------------ 主题 */
  var toggle = doc.querySelector('[data-theme-toggle]');

  /* 手机浏览器的地址栏颜色跟着配色走。算式在 assets/js/palette.js 里
     （它知道当前是哪一轮、现在是哪一态），这里只负责在切主题时喊它一声；
     万一那个文件没加载上，就退回读 --paper 的实际值——总之不在这里写死颜色。 */
  function paintChrome() {
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    if (window.cv01Palette) return void window.cv01Palette.chrome();
    var paper = getComputedStyle(root).getPropertyValue('--paper').trim();
    if (paper) meta.setAttribute('content', paper);
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
  function initRolls() {
    toArray(doc.querySelectorAll('[data-roll]')).forEach(function (roll) {
      /* 页面若已经带着运行时补进来的音符（比如从后台切回来），按同一把尺重排 */
      if (roll.querySelector('.note[data-live]')) layoutTimeline(roll);
      setupRoll(roll);
    });
  }

  function setupRoll(roll) {
    var notes = toArray(roll.querySelectorAll('.note'));
    if (!notes.length) return;

    var live = roll.querySelector('[data-live]');
    var idle = live ? (live.getAttribute('data-idle') || '') : '';

    /* 触摸设备上既没有指针也没有方向键，待机文案得换一套说辞 */
    if (live && window.matchMedia && window.matchMedia('(hover: none)').matches) {
      idle = '点音符进文章；左边的轨道名也能点';
      live.textContent = idle;
      live.setAttribute('data-idle', idle);
    }

    /* Ctrl + 滚轮：调时间尺度（一天多宽）。滚上 = 放大、滚下 = 缩小，
       写进卷帘自己的 --roll-day，roll.css 的画布算式就地生效——
       所有位置都是百分比，音符、刻度跟着一起胖瘦。
       preventDefault 拦下浏览器自己的页面缩放；缩放后按比例留在
       原来的横向上，不把人甩回开头。只绑首页大卷帘。 */
    var scroller = roll.querySelector('.roll__scroller');
    if (scroller && roll.classList.contains('roll--hero') && !scroller.__cv01Zoom) {
      scroller.__cv01Zoom = true;
      scroller.addEventListener('wheel', function (e) {
        if (!e.ctrlKey) return;
        e.preventDefault();
        var declared = window.getComputedStyle(roll).getPropertyValue('--roll-day').trim();
        var rem = parseFloat(window.getComputedStyle(root).fontSize) || 16;
        var day = declared.indexOf('rem') >= 0
          ? (parseFloat(declared) || 1.15) * rem
          : (parseFloat(declared) || 1.15 * rem);
        var next = day * (e.deltaY < 0 ? 1.12 : 1 / 1.12);
        if (next < 8) next = 8;
        if (next > 56) next = 56;
        if (Math.abs(next - day) < 0.05) return;
        var before = scroller.scrollWidth - scroller.clientWidth;
        var left = scroller.scrollLeft;
        roll.style.setProperty('--roll-day', next.toFixed(2) + 'px');
        var after = scroller.scrollWidth - scroller.clientWidth;
        if (after > 0 && before > 0) scroller.scrollLeft = left * (after / before);
        measureRolls();
      }, { passive: false });
    }

    /* 播放头扫过一次，经过的音符依次点亮；随后全站再无自动动画。
       音符按日子排在横轴上，扫光就是按写作顺序把目录点亮一遍——
       终点按最右那格音符归一，不写死。 */
    if (reduce || !root.classList.contains('js')) {
      notes.forEach(function (n) { n.classList.add('is-lit'); });
    } else {
      var maxX = notes.reduce(function (m, n) {
        return Math.max(m, parseFloat(n.getAttribute('data-x')) || 0);
      }, 0) || 93;
      notes.forEach(function (n) {
        var x = parseFloat(n.getAttribute('data-x') || '0');
        var at = Math.min(2200, (x / maxX) * 2200);
        window.setTimeout(function () { n.classList.add('is-lit'); }, at);
      });
    }

    function show(note) {
      if (!live) return;
      var parts = [
        note.getAttribute('data-pitch'),
        note.getAttribute('data-title'),
        note.getAttribute('data-date'),
        (note.getAttribute('data-min') || '') + ' 分钟',
      ].filter(Boolean);
      live.textContent = parts.join(' · ');
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
      note.__cv01Note = true;
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
  }

  /* 卷帘只在窄屏上横向溢出：量过之后再决定要不要说「可以左右滑动」
     （提示本身由 roll.css 用 .is-scrollable 打开）。
     换页会换掉卷帘，所以量的动作按需调用；resize 只在这里装一次。 */
  function measureRolls() {
    toArray(doc.querySelectorAll('[data-roll]')).forEach(function (roll) {
      var scroller = roll.querySelector('.roll__scroller');
      if (scroller) roll.classList.toggle('is-scrollable', scroller.scrollWidth > scroller.clientWidth + 1);
    });
  }
  window.addEventListener('resize', measureRolls);

  /* ------------------------------------------------------- 每日一句
     以本地日期为种子，从胡盐乱雨集的句子里挑一句。
     同一天、所有页面、所有刷新都是同一句；过了本地零点自动换。 */
  function initExcerpt() {
    var slot = doc.querySelector('[data-excerpt]');
    var pool = window.CV01_EXCERPTS;
    if (!slot || !pool || !pool.length) return;
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

  /* 跟着「当前这一页的正文」走的那部分。
     nav.js 局部换完正文之后会再喊一遍 initPage()，所以每次切页
     播放头都会重扫、悬停读数与新卷帘重新绑定。 */
  function initPage() {
    initRolls();
    measureRolls();
    initExcerpt();
  }

  /* 给运行时文章补进来的音符挂上悬停读数。
     sections.js 合并完卷帘会喊一声；已经挂过的靠 __cv01Note 认出来，不会重复挂。 */
  function bindNotes(list) {
    toArray(list).forEach(function (note) {
      if (note.__cv01Note) return;
      var roll = note.closest ? note.closest('[data-roll]') : null;
      if (!roll) return;
      var live = roll.querySelector('[data-live]');
      var idle = live ? (live.getAttribute('data-idle') || '') : '';
      note.__cv01Note = true;
      note.addEventListener('mouseenter', function () { showNote(live, note); });
      note.addEventListener('mouseleave', function () { clearNote(live, idle); });
      note.addEventListener('focus', function () { showNote(live, note); });
      note.addEventListener('blur', function () { clearNote(live, idle); });
    });
  }

  function showNote(live, note) {
    if (!live) return;
    var parts = [
      note.getAttribute('data-pitch'),
      note.getAttribute('data-title'),
      note.getAttribute('data-date'),
      (note.getAttribute('data-min') || '') + ' 分钟',
    ].filter(Boolean);
    live.textContent = parts.join(' · ');
    live.classList.add('is-live');
  }

  function clearNote(live, idle) {
    if (!live) return;
    live.textContent = idle;
    live.classList.remove('is-live');
  }

  /* layoutTimeline 给 sections.js 用：运行时文章补进卷帘之后，
     按接龙把整条时间轴重排一遍（音符、月份刻度一起动） */
  cv01.site = { initPage: initPage, bindNotes: bindNotes, layoutTimeline: layoutTimeline };
  initPage();
})();
