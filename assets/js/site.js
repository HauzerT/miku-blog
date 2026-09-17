/* ==========================================================================
   site.js · 主题切换 / 时间轴播放头 / 悬停读数 / 时间轴键盘导航
   站点在不加载本文件时依然完整可读：音符站在生成器算好的日子上，全亮，
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

  /* ------------------------------------------------------------- 日历比例尺
     首页那条大卷帘的横轴是真实的日历。这份算式与生成器
     （server/lib/shell.mjs 的 timelineScale / timelinePos / monthClusters）
     是同一套，两边要一起改：静态页烤着生成器算好的位置；运行时新写的文章
     进来后，layoutTimeline 按同一把尺把整条时间轴（音符、刻度、月线、
     月份色块）重排一遍。 */
  var DAY = 86400000;
  function dayOf(value) {
    var m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(String(value || ''));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  }
  function layoutTimeline(roll) {
    var ruler = roll.querySelector('.roll__ruler');
    var grid = roll.querySelector('.roll__grid');
    var dated = toArray(roll.querySelectorAll('.note')).filter(function (n) {
      return Number.isFinite(dayOf(n.getAttribute('data-date')));
    });
    if (!dated.length || !ruler || !grid) return;

    var days = dated.map(function (n) { return dayOf(n.getAttribute('data-date')); });
    var t0 = Math.min.apply(null, days) - 2 * DAY;
    var span = Math.max.apply(null, days) + 18 * DAY - t0;

    /* 画布跟着日子走：运行时文章把比例尺拉长，轴就往右长出新的地去 */
    roll.style.setProperty('--days', String(Math.ceil(span / DAY)));

    dated.forEach(function (n) {
      var x = ((dayOf(n.getAttribute('data-date')) - t0) / span) * 100;
      var w = Math.min(11, Math.max(5, (parseFloat(n.getAttribute('data-min')) || 5) * 1.3));
      n.style.setProperty('--x', x.toFixed(2));
      n.style.setProperty('--w', w.toFixed(2));
      n.setAttribute('data-x', x.toFixed(2));
      n.setAttribute('data-month', String(n.getAttribute('data-date')).slice(0, 7));
    });

    /* 月份刻度与贯穿的月线跟着新的比例尺重画：每个月的第一天都落上轴。
       只画到最后一篇文章所在的月份——再往右是还没写的留白，不挂牌子 */
    var months = [];
    var horizon = t0 + span - 16 * DAY;
    var cursor = new Date(t0);
    cursor.setUTCDate(1);
    if (cursor.getTime() < t0) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    while (cursor.getTime() <= horizon) {
      months.push({
        x: (((cursor.getTime() - t0) / span) * 100).toFixed(2),
        label: cursor.getUTCFullYear() + '.' + ('0' + (cursor.getUTCMonth() + 1)).slice(-2),
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    ruler.innerHTML = months.map(function (m) {
      return '<span class="roll__month" style="--x:' + m.x + '">' + m.label + '</span>';
    }).join('');
    grid.innerHTML = months.map(function (m) {
      return '<i style="--x:' + m.x + '"></i>';
    }).join('');

    rebuildClusters(roll, dated);
    applyFold(roll, roll.getAttribute('data-open-month') || '');

    /* 音符重排过，横向的宽窄可能变——「可以左右滑动」的提示重新量一遍 */
    measureRolls();
  }

  /* ------------------------------------------------------------- 月份色块
     同一个月有 ≥2 篇时归拢成一个色块：默认收着，点一下展开成各自轨道里的
     音符再挑（手风琴：一次只开一个月），再点一下收回去。单篇的月份不成块。
     生成器烤出静态的块；运行时文章进来后这里按同一套算式重建。 */
  function rebuildClusters(roll, dated) {
    var wrap = roll.querySelector('.roll__clusters');
    if (!wrap) return;

    var byMonth = {};
    dated.forEach(function (n) {
      var month = n.getAttribute('data-month');
      (byMonth[month] = byMonth[month] || []).push(n);
    });
    var groups = Object.keys(byMonth).map(function (month) {
      var x0 = Infinity;
      var x1 = 0;
      byMonth[month].forEach(function (n) {
        x0 = Math.min(x0, parseFloat(n.style.getPropertyValue('--x')) || 0);
        x1 = Math.max(x1, (parseFloat(n.style.getPropertyValue('--x')) || 0) +
          (parseFloat(n.style.getPropertyValue('--w')) || 0));
      });
      return { month: month, count: byMonth[month].length, x0: x0, x1: x1 };
    }).filter(function (g) { return g.count >= 2; }).sort(function (a, b) { return a.x0 - b.x0; });
    groups.forEach(function (g, i) {
      if (i < groups.length - 1) g.x1 = Math.min(g.x1, groups[i + 1].x0 - 0.5);
      g.x0 = Math.max(g.x0, 0.5);
      g.x1 = Math.max(g.x0 + 1, Math.min(g.x1, 99.5));
    });

    wrap.innerHTML = groups.map(function (g) {
      return '<button class="roll__cluster" type="button" style="--x0:' + g.x0.toFixed(2) +
        ';--x1:' + g.x1.toFixed(2) + '" data-month="' + g.month + '" aria-expanded="false">' +
        '<span class="roll__cluster-name">' + g.month + '</span>' +
        '<span class="roll__cluster-count">' + g.count + ' 篇</span>' +
        '<span class="roll__cluster-hint">点开挑一篇</span>' +
        '</button>';
    }).join('');
  }

  function toggleMonth(roll, month) {
    applyFold(roll, roll.getAttribute('data-open-month') === month ? '' : month);
  }

  /* 收起/展开：开着的月份里音符归位，其余成块月份的音符退场；
     不成块的独行音符永远亮着——它没有色块可以回去 */
  function applyFold(roll, open) {
    roll.setAttribute('data-open-month', open || '');
    var wrap = roll.querySelector('.roll__clusters');
    var has = {};
    if (wrap) toArray(wrap.querySelectorAll('.roll__cluster')).forEach(function (btn) {
      var month = btn.getAttribute('data-month');
      has[month] = true;
      var isopen = month === open;
      btn.classList.toggle('is-open', isopen);
      btn.setAttribute('aria-expanded', isopen ? 'true' : 'false');
    });
    toArray(roll.querySelectorAll('.note[data-month]')).forEach(function (n) {
      var month = n.getAttribute('data-month');
      n.classList.toggle('is-folded', Boolean(has[month]) && month !== open);
    });
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
      /* 页面若已经带着运行时补进来的音符（比如从后台切回来），按日历重排 */
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
      idle = '点开色块再挑当月的文章；左边的轨道名也能点';
      live.textContent = idle;
      live.setAttribute('data-idle', idle);
    }

    /* 月份色块：点开/收起（手风琴，一次一个月）。
       委托在容器上——运行时文章进来后块会被重建，监听不用重挂 */
    var wrap = roll.querySelector('.roll__clusters');
    if (wrap && !wrap.__cv01Clusters) {
      wrap.__cv01Clusters = true;
      wrap.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.roll__cluster') : null;
        if (btn) toggleMonth(roll, btn.getAttribute('data-month'));
      });
    }
    applyFold(roll, roll.getAttribute('data-open-month') || '');

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
     按日历把整条时间轴重排一遍（音符、月份刻度、月线一起动） */
  cv01.site = { initPage: initPage, bindNotes: bindNotes, layoutTimeline: layoutTimeline };
  initPage();
})();
