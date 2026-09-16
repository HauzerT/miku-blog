/* ==========================================================================
   palette.js · 由 content/palette.mjs 生成 —— 不要手改这个文件
   生成命令：node tools/tokens.mjs
   ---------------------------------------------------------------------------
   作用只有一个：在浏览器里临时换轮次（页面的四色），不动任何文件。
   地址栏加 ?cv01-palette=r4 看候选轮次，?cv01-palette=off 回到当前轮次。
   控制台里 window.cv01Palette.use('r4') / .list() / .current()。
   窗（--win-*，卷帘那一扇）不在这里——它归 content/palette.mjs 的
   `export const window` 管，改一个字再跑一次生成就换了，本来就只有两步。
   ========================================================================== */
window.CV01_PALETTE = {
  "active": "r3",
  "window": "cyan",
  "order": [
    "r3",
    "r4",
    "r5"
  ],
  "rounds": {
    "r3": {
      "name": "第三轮 · 中性地面",
      "note": "上一轮满屏饱和青做地面，正文吃力、照片发青，而且卷帘的音符块本身就是\n#39C5BB —— 青底等于把青从音符手里抢走，只好把音符改成粉。\n这一轮地面换成中性冷灰，等级差交给墨量（粗细、疏密、不透明度），不交给色相。\n\n代价是青在地面上只剩 1.99:1，读不了字，于是「指认」整个交给了粉：\n链接、序号、音高名、日期都成了粉。青退进唯一的暗窗（--display）里。\n粉的深色档从来源色 #E12885 压深到 #D81B7A，才够地面上的 4.51:1。",
      "light": {
        "--paper": "#f5f8f8",
        "--paper-deep": "rgba(19, 122, 127, 0.08)",
        "--card": "#ffffff",
        "--ink": "#2d3033",
        "--ink-soft": "#666a6d",
        "--miku-deep": "#d81b7a",
        "--miku": "#39c5bb",
        "--display": "#1a1c1e",
        "--display-soft": "#2d3033",
        "--cuer": "#ff3399",
        "--cuer-glow": "rgba(255, 51, 153, 0.5)",
        "--rule": "#bec8d1",
        "--rule-soft": "rgba(190, 200, 209, 0.55)",
        "--mark": "#ffe6f2",
        "--key-black": "#2d3033",
        "--key-black-hover": "#3a4046",
        "--on-display": "#e6ebef",
        "--on-display-soft": "#9da4aa",
        "--tap": "rgba(255, 51, 153, 0.22)",
        "--scrim": "rgba(10, 11, 12, 0.55)",
        "--roll-line": "rgba(16, 18, 20, 0.22)",
        "--roll-line-strong": "rgba(16, 18, 20, 0.3)",
        "--roll-lane": "rgba(16, 18, 20, 0.15)",
        "--roll-thumb": "rgba(16, 18, 20, 0.32)",
        "--roll-cap": "rgba(245, 248, 248, 0.88)",
        "--roll-cap-line": "rgba(16, 18, 20, 0.45)",
        "--roll-cap-black": "#101214",
        "--roll-lane-black": "rgba(16, 18, 20, 0.1)",
        "--note-ring": "rgba(16, 18, 20, 0.22)",
        "--km-seam": "#14313a",
        "--km-raise": "#1d3538",
        "--qr-ink": "#071316",
        "--qr-face": "#ffffff",
        "--qr-veil": "rgba(255, 255, 255, 0.74)",
        "--qr-soft": "#666a6d",
        "--print-ink": "#000000",
        "--print-paper": "#ffffff",
        "--win-ground": "#39c5bb",
        "--win-ink": "#101214",
        "--win-ink-soft": "#20484a",
        "--win-accent": "#101214",
        "--win-cue": "#101214",
        "--win-note": "#101214",
        "--win-note-ink": "#f5f8f8",
        "--win-note-idle": "#101214",
        "--win-ghost": "#101214",
        "--win-ring": "#101214",
        "--win-cursor": "#101214",
        "--win-cursor-glow": "rgba(16, 18, 20, 0)"
      },
      "dark": {
        "--paper": "#1a1c1e",
        "--paper-deep": "rgba(134, 206, 203, 0.08)",
        "--card": "#2d3033",
        "--ink": "#e6ebef",
        "--ink-soft": "#9da4aa",
        "--miku-deep": "#ff69b4",
        "--miku": "#39c5bb",
        "--display": "#0c0e10",
        "--display-soft": "#2d3033",
        "--cuer": "#ff69b4",
        "--cuer-glow": "rgba(255, 105, 180, 0.5)",
        "--rule": "#44494d",
        "--rule-soft": "rgba(68, 73, 77, 0.6)",
        "--mark": "#4a2038",
        "--key-black": "#101214",
        "--key-black-hover": "#1c2024",
        "--on-display": "#e6ebef",
        "--on-display-soft": "#9da4aa",
        "--tap": "rgba(255, 105, 180, 0.22)",
        "--scrim": "rgba(10, 11, 12, 0.55)",
        "--roll-line": "rgba(230, 235, 239, 0.16)",
        "--roll-line-strong": "rgba(230, 235, 239, 0.22)",
        "--roll-lane": "rgba(230, 235, 239, 0.12)",
        "--roll-thumb": "rgba(157, 164, 170, 0.35)",
        "--roll-cap": "rgba(230, 235, 239, 0.14)",
        "--roll-cap-line": "rgba(0, 0, 0, 0.85)",
        "--roll-cap-black": "rgba(0, 0, 0, 0.55)",
        "--roll-lane-black": "rgba(0, 0, 0, 0.28)",
        "--note-ring": "rgba(0, 0, 0, 0.18)",
        "--km-seam": "#14313a",
        "--km-raise": "#1d3538",
        "--qr-ink": "#071316",
        "--qr-face": "#ffffff",
        "--qr-veil": "rgba(255, 255, 255, 0.74)",
        "--qr-soft": "#666a6d",
        "--print-ink": "#000000",
        "--print-paper": "#ffffff",
        "--win-ground": "#101214",
        "--win-ink": "#e6ebef",
        "--win-ink-soft": "#9da4aa",
        "--win-accent": "#39c5bb",
        "--win-cue": "#ff3399",
        "--win-note": "#ff3399",
        "--win-note-ink": "#101214",
        "--win-note-idle": "#ff3399",
        "--win-ghost": "#ff3399",
        "--win-ring": "#ff3399",
        "--win-cursor": "#ff3399",
        "--win-cursor-glow": "rgba(255, 51, 153, 0.5)"
      },
      "paper": {
        "light": "#f5f8f8",
        "dark": "#1a1c1e"
      }
    },
    "r4": {
      "name": "第四轮 · 青墨归位（候选）",
      "note": "第三轮为了让青活下去，把「指认」整个让给了粉。但粉本来只该管一件事：此刻。\n它管链接、管序号、管日期，是上一轮被青底逼上去的——青底一撤，它就该退回来。\n\n  青墨   青在地面上当字的那一档是 #137A7F（4.78:1，过 AA），不是 #39C5BB。\n         上一轮量到 1.99:1 就断定「青只配活在暗窗里」，是把「青做不了字」\n         误读成了「青做不了地面层」。粉退回焦点环、播放头、正在播放。\n  青黑窗 --display 从 #1A1C1E 挪到 #0E2124。全站最大的一块深色变成青黑，\n         远看整页就是「青纸 + 一扇青黑的窗」。对比度不降反升，最便宜的一步。\n  青黑键 --key-black 跟着走，免得两种黑打架。\n  青选区 --mark 从粉换成淡青：粉不再被用来铺任何面积。\n  青雾   极淡的青从 .08 加到 .10，地面凉一点，但不至于变成底色。\n\n还没动的一条：--rule 仍是中性灰。把细线也染青是下一轮的实验——青色是刻度色，\n但细线一染，「纸」的感觉就没了，得看过再说。",
      "light": {
        "--paper": "#f5f8f8",
        "--paper-deep": "rgba(19, 122, 127, 0.1)",
        "--card": "#ffffff",
        "--ink": "#2d3033",
        "--ink-soft": "#666a6d",
        "--miku-deep": "#137a7f",
        "--miku": "#39c5bb",
        "--display": "#0e2124",
        "--display-soft": "#1d3538",
        "--cuer": "#ff3399",
        "--cuer-glow": "rgba(255, 51, 153, 0.5)",
        "--rule": "#bec8d1",
        "--rule-soft": "rgba(190, 200, 209, 0.55)",
        "--mark": "#d7efed",
        "--key-black": "#123039",
        "--key-black-hover": "#1a4650",
        "--on-display": "#e6ebef",
        "--on-display-soft": "#9da4aa",
        "--tap": "rgba(255, 51, 153, 0.22)",
        "--scrim": "rgba(10, 11, 12, 0.55)",
        "--roll-line": "rgba(16, 18, 20, 0.22)",
        "--roll-line-strong": "rgba(16, 18, 20, 0.3)",
        "--roll-lane": "rgba(16, 18, 20, 0.15)",
        "--roll-thumb": "rgba(16, 18, 20, 0.32)",
        "--roll-cap": "rgba(245, 248, 248, 0.88)",
        "--roll-cap-line": "rgba(16, 18, 20, 0.45)",
        "--roll-cap-black": "#101214",
        "--roll-lane-black": "rgba(16, 18, 20, 0.1)",
        "--note-ring": "rgba(16, 18, 20, 0.22)",
        "--km-seam": "#14313a",
        "--km-raise": "#1d3538",
        "--qr-ink": "#071316",
        "--qr-face": "#ffffff",
        "--qr-veil": "rgba(255, 255, 255, 0.74)",
        "--qr-soft": "#666a6d",
        "--print-ink": "#000000",
        "--print-paper": "#ffffff",
        "--win-ground": "#39c5bb",
        "--win-ink": "#101214",
        "--win-ink-soft": "#20484a",
        "--win-accent": "#101214",
        "--win-cue": "#101214",
        "--win-note": "#101214",
        "--win-note-ink": "#f5f8f8",
        "--win-note-idle": "#101214",
        "--win-ghost": "#101214",
        "--win-ring": "#101214",
        "--win-cursor": "#101214",
        "--win-cursor-glow": "rgba(16, 18, 20, 0)"
      },
      "dark": {
        "--paper": "#1a1c1e",
        "--paper-deep": "rgba(134, 206, 203, 0.09)",
        "--card": "#2d3033",
        "--ink": "#e6ebef",
        "--ink-soft": "#9da4aa",
        "--miku-deep": "#39c5bb",
        "--miku": "#39c5bb",
        "--display": "#0b1a1c",
        "--display-soft": "#14313a",
        "--cuer": "#ff69b4",
        "--cuer-glow": "rgba(255, 105, 180, 0.5)",
        "--rule": "#44494d",
        "--rule-soft": "rgba(68, 73, 77, 0.6)",
        "--mark": "#17343a",
        "--key-black": "#0b1a1c",
        "--key-black-hover": "#12262a",
        "--on-display": "#e6ebef",
        "--on-display-soft": "#9da4aa",
        "--tap": "rgba(255, 105, 180, 0.22)",
        "--scrim": "rgba(10, 11, 12, 0.55)",
        "--roll-line": "rgba(230, 235, 239, 0.16)",
        "--roll-line-strong": "rgba(230, 235, 239, 0.22)",
        "--roll-lane": "rgba(230, 235, 239, 0.12)",
        "--roll-thumb": "rgba(157, 164, 170, 0.35)",
        "--roll-cap": "rgba(230, 235, 239, 0.14)",
        "--roll-cap-line": "rgba(0, 0, 0, 0.85)",
        "--roll-cap-black": "rgba(0, 0, 0, 0.55)",
        "--roll-lane-black": "rgba(0, 0, 0, 0.28)",
        "--note-ring": "rgba(0, 0, 0, 0.18)",
        "--km-seam": "#14313a",
        "--km-raise": "#1d3538",
        "--qr-ink": "#071316",
        "--qr-face": "#ffffff",
        "--qr-veil": "rgba(255, 255, 255, 0.74)",
        "--qr-soft": "#666a6d",
        "--print-ink": "#000000",
        "--print-paper": "#ffffff",
        "--win-ground": "#101214",
        "--win-ink": "#e6ebef",
        "--win-ink-soft": "#9da4aa",
        "--win-accent": "#39c5bb",
        "--win-cue": "#ff3399",
        "--win-note": "#ff3399",
        "--win-note-ink": "#101214",
        "--win-note-idle": "#ff3399",
        "--win-ghost": "#ff3399",
        "--win-ring": "#ff3399",
        "--win-cursor": "#ff3399",
        "--win-cursor-glow": "rgba(255, 51, 153, 0.5)"
      },
      "paper": {
        "light": "#f5f8f8",
        "dark": "#1a1c1e"
      }
    },
    "r5": {
      "name": "第五轮 · 四色归位（候选）",
      "note": "第四轮把暗窗挪成了青黑，想让整页远看就是青的。可那一手把黑染青了：黑和青同族，\n青落在黑上就只剩明度差、没有了彩度差——青/粉/白/黑四个颜色塌成三个，青反而变弱，\n它不再是画面里唯一的彩度，而被读成\"深一点的青\"配\"浅一点的青\"。\n\n这一轮守住四个颜色各自的身份，谁也别吃掉谁：\n\n  黑回中性  --display  #0E2124 → #101214，黑键 #123039 → #1A1D20，云村播放条的\n            接缝也跟着去青（#14313A → #2E3237）。黑越纯，青越亮。\n  白是面积  --paper / --card 本来就是全站最大的白。这一轮让白在暗窗里也看得见：\n            钢琴那一列白键从 14% 提到 22%——它得真的像一排白键。\n  青扛指认  #137A7F 当字、#39C5BB 当块，与上一轮相同。另把暗态地面上那层字\n            从 #39C5BB 换成 #86CECB（对 #1A1C1E 9.53:1）：更深的一档反而更浅，\n            这样暗窗仍然独占那个满浓度的青。\n  粉管此刻  选区从青回到粉——它也是\"你此刻选中的\"。于是粉有这些地方：焦点环、\n            点按高亮、当前页那条下划线、播放头、正在播放的按钮、卷帘读数、选区。\n            没有一处是铺面积的，但每一页都会遇到它。",
      "light": {
        "--paper": "#f5f8f8",
        "--paper-deep": "rgba(19, 122, 127, 0.1)",
        "--card": "#ffffff",
        "--ink": "#2d3033",
        "--ink-soft": "#666a6d",
        "--miku-deep": "#137a7f",
        "--miku": "#39c5bb",
        "--display": "#101214",
        "--display-soft": "#1d2024",
        "--cuer": "#ff3399",
        "--cuer-glow": "rgba(255, 51, 153, 0.5)",
        "--rule": "#bec8d1",
        "--rule-soft": "rgba(190, 200, 209, 0.55)",
        "--mark": "#ffe6f2",
        "--key-black": "#1a1d20",
        "--key-black-hover": "#262b30",
        "--on-display": "#e6ebef",
        "--on-display-soft": "#9da4aa",
        "--tap": "rgba(255, 51, 153, 0.22)",
        "--scrim": "rgba(10, 11, 12, 0.55)",
        "--roll-line": "rgba(16, 18, 20, 0.22)",
        "--roll-line-strong": "rgba(16, 18, 20, 0.3)",
        "--roll-lane": "rgba(16, 18, 20, 0.15)",
        "--roll-thumb": "rgba(16, 18, 20, 0.32)",
        "--roll-cap": "rgba(245, 248, 248, 0.88)",
        "--roll-cap-line": "rgba(16, 18, 20, 0.45)",
        "--roll-cap-black": "#101214",
        "--roll-lane-black": "rgba(16, 18, 20, 0.1)",
        "--note-ring": "rgba(16, 18, 20, 0.22)",
        "--km-seam": "#2e3237",
        "--km-raise": "#383d42",
        "--qr-ink": "#071316",
        "--qr-face": "#ffffff",
        "--qr-veil": "rgba(255, 255, 255, 0.74)",
        "--qr-soft": "#666a6d",
        "--print-ink": "#000000",
        "--print-paper": "#ffffff",
        "--win-ground": "#39c5bb",
        "--win-ink": "#101214",
        "--win-ink-soft": "#20484a",
        "--win-accent": "#101214",
        "--win-cue": "#101214",
        "--win-note": "#101214",
        "--win-note-ink": "#f5f8f8",
        "--win-note-idle": "#101214",
        "--win-ghost": "#101214",
        "--win-ring": "#101214",
        "--win-cursor": "#101214",
        "--win-cursor-glow": "rgba(16, 18, 20, 0)"
      },
      "dark": {
        "--paper": "#1a1c1e",
        "--paper-deep": "rgba(134, 206, 203, 0.09)",
        "--card": "#2d3033",
        "--ink": "#e6ebef",
        "--ink-soft": "#9da4aa",
        "--miku-deep": "#86cecb",
        "--miku": "#39c5bb",
        "--display": "#0b0c0d",
        "--display-soft": "#16181b",
        "--cuer": "#ff69b4",
        "--cuer-glow": "rgba(255, 105, 180, 0.5)",
        "--rule": "#44494d",
        "--rule-soft": "rgba(68, 73, 77, 0.6)",
        "--mark": "#4a2038",
        "--key-black": "#0b0c0d",
        "--key-black-hover": "#16181b",
        "--on-display": "#e6ebef",
        "--on-display-soft": "#9da4aa",
        "--tap": "rgba(255, 105, 180, 0.22)",
        "--scrim": "rgba(10, 11, 12, 0.55)",
        "--roll-line": "rgba(230, 235, 239, 0.16)",
        "--roll-line-strong": "rgba(230, 235, 239, 0.22)",
        "--roll-lane": "rgba(230, 235, 239, 0.12)",
        "--roll-thumb": "rgba(157, 164, 170, 0.35)",
        "--roll-cap": "rgba(230, 235, 239, 0.14)",
        "--roll-cap-line": "rgba(0, 0, 0, 0.85)",
        "--roll-cap-black": "rgba(0, 0, 0, 0.55)",
        "--roll-lane-black": "rgba(0, 0, 0, 0.28)",
        "--note-ring": "rgba(0, 0, 0, 0.18)",
        "--km-seam": "#2e3237",
        "--km-raise": "#383d42",
        "--qr-ink": "#071316",
        "--qr-face": "#ffffff",
        "--qr-veil": "rgba(255, 255, 255, 0.74)",
        "--qr-soft": "#666a6d",
        "--print-ink": "#000000",
        "--print-paper": "#ffffff",
        "--win-ground": "#101214",
        "--win-ink": "#e6ebef",
        "--win-ink-soft": "#9da4aa",
        "--win-accent": "#39c5bb",
        "--win-cue": "#ff3399",
        "--win-note": "#ff3399",
        "--win-note-ink": "#101214",
        "--win-note-idle": "#ff3399",
        "--win-ghost": "#ff3399",
        "--win-ring": "#ff3399",
        "--win-cursor": "#ff3399",
        "--win-cursor-glow": "rgba(255, 51, 153, 0.5)"
      },
      "paper": {
        "light": "#f5f8f8",
        "dark": "#1a1c1e"
      }
    }
  },
  "fixed": {
    "qr": {
      "ink": "#071316",
      "face": "#ffffff"
    },
    "print": {
      "ink": "#000000",
      "paper": "#ffffff"
    }
  }
};

(function () {
  var D = window.CV01_PALETTE;
  var root = document.documentElement;
  var keys = Object.keys(D.rounds[D.active].light);
  var media = document.querySelector('meta[name="theme-color"]');

  function theme() { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function write(id) {
    try {
      if (id === null) localStorage.removeItem('cv01-palette');
      else localStorage.setItem('cv01-palette', id + '@' + D.active);
    } catch (e) {}
  }
  /* 存下来的选择里带着"当时生效的那一轮"。配色文件后来换了轮次，这条临时覆盖就作废——
     文件是唯一的真源，浏览器里那次试看不该压过它的决定。 */
  function remembered() {
    var raw = null;
    try { raw = localStorage.getItem('cv01-palette'); } catch (e) { return null; }
    if (!raw) return null;
    var at = raw.lastIndexOf('@');
    var id = at < 0 ? raw : raw.slice(0, at);
    var forActive = at < 0 ? null : raw.slice(at + 1);
    if (!D.rounds[id] || (forActive && forActive !== D.active)) { write(null); return null; }
    return id;
  }
  /* 地址栏里问的轮次：没有就问出 null，写了但空着就是 '' */
  function asked() {
    try { return new URLSearchParams(location.search).get('cv01-palette'); } catch (e) { return null; }
  }

  function apply(id) {
    keys.forEach(function (k) { root.style.removeProperty(k); });
    if (id && id !== D.active) {
      var set = D.rounds[id][theme()];
      Object.keys(set).forEach(function (k) { root.style.setProperty(k, set[k]); });
    }
    root.setAttribute('data-palette', id || D.active);
    chrome();
  }

  /* 手机浏览器地址栏的颜色：当前轮次、当前态的「地面」。
     site.js 切主题时会喊这个函数，所以全站只有这一处算式。 */
  function chrome() {
    if (!media) return;
    var id = root.getAttribute('data-palette') || D.active;
    media.setAttribute('content', D.rounds[id].paper[theme()]);
  }

  var api = {
    list: function () {
      return D.order.map(function (id) {
        return { id: id, name: D.rounds[id].name, active: id === D.active, current: id === api.current() };
      });
    },
    current: function () { return root.getAttribute('data-palette') || D.active; },
    chrome: chrome,
    /* use('r4') 看候选，use(null) 回到当前轮次 */
    use: function (id, persist) {
      if (id && !D.rounds[id]) return false;
      apply(id);
      if (persist !== false) write(id);
      return true;
    },
    root: root,
  };
  window.cv01Palette = api;

  /* 地址栏优先，其次记住的选择。?cv01-palette=off 用来清掉。
     无论走哪条路最后都要 apply 一次：地址栏的颜色、data-palette 都靠它落定。 */
  var q = asked();
  if (q !== null) {
    if (q === 'off' || q === '' || q === D.active) { write(null); apply(null); }
    else if (!api.use(q)) apply(null);   /* 认不出的轮次：别把页面留在半途 */
  } else {
    var saved = remembered();
    apply(saved || null);
  }

  /* 切主题时重新压一遍覆盖值：覆盖是按当前态取的那一份 */
  new MutationObserver(function () {
    var now = api.current();
    if (now !== D.active) apply(now); else apply(null);
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
})();
