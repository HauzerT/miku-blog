/* ==========================================================================
   audio.js · 调声
   ---------------------------------------------------------------------------
   把卷帘上的音变成可以听见的东西 —— 原生九个音，以及用界面新建板块时挑的任何一个音。

   默认关闭。没人喜欢的网站会自己出声。开启之后：
     · 点轨道名 / 点卷帘的轨道头 —— 先响一声，再切模块
     · 指针掠过音符块，或用方向键在卷帘上走 —— 试听那个音

   两种声源，自动选择：
     1) 你自己放的真采样：assets/audio/a5.mp3、fs3.mp3 …（缺哪个就用合成补哪个）
     2) 没有采样时：WebAudio 现场合成一个柔和的电钢琴音色
   所以「需不需要导入文件」的答案是：不导入也能用；想换成真钢琴再导入。
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var cv01 = (window.cv01 = window.cv01 || {});
  var STORE = 'cv01-sound';
  var SWITCH_DELAY = 190;          // 切模块前让音符响多久（毫秒）。用真钢琴采样可以调大
  var EXTS = ['.mp3', '.wav', '.ogg'];
  var MASTER = 0.15;               // 总音量。想更响改这里，别改单个音符

  /* 音高 → 频率：十二平均律，A4 = 440Hz。
     以前这里是一张只有原生九个音的表，于是用界面新建的板块（比如 B5）点了是哑的
     —— 表里查不到就 return 了。算出来的话，C2 到 B6 任何音都认，
     采样文件（assets/audio/b5.mp3 这种）也才有机会被找出来。 */
  var SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function hz(pitch) {
    var m = /^([A-G])(#?)(-?\d)$/.exec(String(pitch || ''));
    if (!m) return 0;
    var midi = (Number(m[3]) + 1) * 12 + SEMITONE[m[1]] + (m[2] ? 1 : 0);   // MIDI 音高号
    return 440 * Math.pow(2, (midi - 69) / 12);                            // A4 = 69 = 440Hz
  }

  var btn = doc.querySelector('[data-sound-toggle]');
  var self = doc.currentScript;
  /* 从本文件自己的地址推出站点根，这样 /sections/ 和 /posts/ 里也能找到音频 */
  var base = self && self.src ? self.src.replace(/assets\/js\/audio\.js.*$/, '') : '';

  var ctx = null;
  var enabled = false;
  var extOf = {};                  // 音高 -> 可用的采样后缀；false 表示确实没有
  var lastPitch = '';
  var lastAt = 0;

  var slug = function (pitch) { return pitch.toLowerCase().replace('#', 's'); };

  /* ------------------------------------------------------------ 合成 */
  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    var gain = ctx.createGain();
    gain.gain.value = MASTER;
    gain.connect(ctx.destination);
    ctx.__master = gain;
    return ctx;
  }

  /* 加法合成的柔和小钟琴：基频 + 三个泛音，快起音、长衰减 */
  function synth(pitch, short) {
    if (!ensure()) return;
    var t = ctx.currentTime + 0.001;
    var partials = [[1, 1], [2, 0.3], [3, 0.12], [4, 0.05]];

    var env = ctx.createGain();
    if (short) {
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(0.9, t + 0.006);
      env.gain.exponentialRampToValueAtTime(0.26, t + 0.12);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    } else {
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(0.9, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.3, t + 0.22);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    }

    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    lp.Q.value = 0.6;
    env.connect(lp);
    lp.connect(ctx.__master);

    partials.forEach(function (p) {
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz(pitch) * p[0];
      var g = ctx.createGain();
      g.gain.value = p[1];
      osc.connect(g);
      g.connect(env);
      osc.start(t);
      osc.stop(t + (short ? 0.5 : 1.25));
    });
  }

  /* ------------------------------------------------------------ 采样 */
  function playFile(pitch, ext, short) {
    var a = new Audio(base + 'assets/audio/' + slug(pitch) + ext);
    a.volume = 0.55;
    var p = a.play();
    if (p && p.catch) p.catch(function () { synth(pitch, short); });
  }

  function trySample(pitch, i, short) {
    if (i >= EXTS.length) { extOf[pitch] = false; synth(pitch, short); return; }
    var a = new Audio(base + 'assets/audio/' + slug(pitch) + EXTS[i]);
    a.volume = 0.55;
    var p = a.play();
    if (!p || !p.then) { extOf[pitch] = EXTS[i]; return; }
    p.then(function () { extOf[pitch] = EXTS[i]; })
      .catch(function () { trySample(pitch, i + 1, short); });
  }

  /* ------------------------------------------------------------ 发声 */
  function play(pitch, short, force) {
    if (!enabled || !hz(pitch)) return;
    var now = Date.now();
    if (!force && pitch === lastPitch && now - lastAt < 260) return;  // 掠过时不连响
    lastPitch = pitch;
    lastAt = now;

    if (extOf[pitch] === false) { synth(pitch, short); return; }
    if (extOf[pitch]) { playFile(pitch, extOf[pitch], short); return; }
    trySample(pitch, 0, short);
  }

  /* ------------------------------------------------------------ 开关 */
  function paint() {
    if (!btn) return;
    var narrow = window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
    btn.textContent = enabled ? (narrow ? '音效开' : '关闭音效') : (narrow ? '音效关' : '开启音效');
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    btn.setAttribute('aria-label', enabled
      ? '关闭音效：切换模块与时不再发声'
      : '开启音效：切换模块时会响一声，卷帘上可以试听');
  }

  if (btn) {
    btn.hidden = false;
    try { enabled = window.localStorage.getItem(STORE) === 'on'; } catch (e) { /* 隐私模式 */ }
    paint();

    btn.addEventListener('click', function () {
      enabled = !enabled;
      if (enabled) {
        ensure();
        if (ctx && ctx.state === 'suspended') ctx.resume();
        play('A5', true, true);            // 开启时用最高那个音应一声
      }
      try { window.localStorage.setItem(STORE, enabled ? 'on' : 'off'); } catch (e) { /* 忽略 */ }
      paint();
    });

    if (window.matchMedia) {
      var mq = window.matchMedia('(max-width: 720px)');
      var onmq = function () { paint(); };
      if (mq.addEventListener) mq.addEventListener('change', onmq);
      else if (mq.addListener) mq.addListener(onmq);
    }
  }

  /* ------------------------------------------------------------ 交互 */
  function pitchOf(node) {
    var el = node && node.closest ? node.closest('[data-pitch]') : null;
    return el ? el.getAttribute('data-pitch') : '';
  }

  /* 点任何一个带音高的链接：先响，再走。
     只在音效开启时拦截，关闭时零延迟、零副作用。 */
  doc.addEventListener('click', function (e) {
    if (!enabled) return;
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    var link = e.target.closest ? e.target.closest('a[data-pitch]') : null;
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

    var pitch = link.getAttribute('data-pitch');
    if (!hz(pitch)) return;

    e.preventDefault();
    play(pitch, true, true);
    var href = link.getAttribute('href');
    /* 切模块也走 nav.js 的局部刷新，否则整页跳转会把这根 audio 一起销毁 */
    window.setTimeout(function () {
      if (cv01.go) cv01.go(href);
      else window.location.assign(href);
    }, SWITCH_DELAY);
  });

  /* 掠过音符块、键盘走到音符块 —— 试听 */
  doc.addEventListener('pointerover', function (e) {
    if (!enabled) return;
    var n = e.target.closest ? e.target.closest('.note[data-pitch]') : null;
    if (n) play(n.getAttribute('data-pitch'), false, false);
  });
  doc.addEventListener('focusin', function (e) {
    if (!enabled) return;
    var p = pitchOf(e.target);
    if (p) play(p, false, true);
  });
})();
