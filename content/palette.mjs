/* ==========================================================================
   content/palette.mjs · 全站配色的唯一真源
   ---------------------------------------------------------------------------
   这个文件是**唯一**写着颜色字面量的地方。别的 CSS 里出现 #rrggbb / rgb() /
   rgba() 都是 bug —— node tools/tokens.mjs 会把它们逐个揪出来（见 tokens.mjs 的
   扫描段）。想改颜色，只改这里，然后跑一次生成。

   三层，从下往上：

     paint    原色。有名字、有出处。要调「初音那个青」，全站只改这一处。
     tokens   职务。token 名 → 它是什么职务、谁挂在谁身上、至少要多少对比度。
              这张表是给机器读的：不够 AA，生成器直接报错退出，不写文件。
     rounds   轮次。一轮配色 = 一份「token → [地面态, 暗窗态]」的完整表 + 一段
              为什么。换整套配色 = 改下面 active 一个字。

   工作流（详见 README 的「配色」一节）：

     node tools/tokens.mjs                 校验 + 生成 palette.css / palette.js
     node tools/tokens.mjs --check         只校验，不写文件（提交前 / CI 用）
     node tools/tokens.mjs --list          列出所有轮次与实测对比度
     node tools/tokens.mjs --diff r3 r4    两轮的 token 差异
     node tools/tokens.mjs --use r4        把 active 改成 r4 并重新生成
     浏览器加 ?cv01-palette=r4             不动文件，直接看候选轮次

   容器里有 window.cv01Palette: use(id) / list() / current() / root()。
   ========================================================================== */

/* ------------------------------------------------------------------ 原色 */

export const paint = {
  /* 初音未来的青。main 是大家都认识的那个青；dark 是它压深到能在地面上当字的
     那一档（对 #F5F8F8 4.78:1，过 AA）；ink 是它的「青黑」，用来当地面。 */
  miku: { main: '#39c5bb', light: '#86cecb', dark: '#137a7f', ink: '#0e2124' },

  /* 樱粉。main 只做「此刻」；deep 是压深到能在地面上当字的那一档。 */
  sakura: { main: '#ff3399', deep: '#d81b7a', light: '#ff69b4' },

  /* 中性灰。整套界面的承重墙——阅读的重量全在这里，不在色相上。 */
  grey: {
    paper: '#f5f8f8', card: '#ffffff', ink: '#2d3033', soft: '#666a6d', rule: '#bec8d1',
    pale: '#e6ebef', slate: '#3a4046',
    night: '#1a1c1e', nightCard: '#2d3033', nightDeep: '#0c0e10', nightRule: '#44494d',
    onNight: '#e6ebef', onNightSoft: '#9da4aa',
    keyNight: '#101214', keyNightHover: '#1c2024',
  },

  /* 黑。这个运动里的黑必须是**中性**的，不染青——这不是洁癖，是算术：
     黑一旦偏青，它就跟青同族，青在它上面就只剩明度差、没有了彩度差，
     画面里也从四个颜色塌成三个。黑越纯，青越亮。
     卷帘那扇暗窗、黑键、云村播放条的接缝，都从这一组取。 */
  black: {
    window: '#101214', raise: '#1d2024', key: '#1a1d20', keyHover: '#262b30',
    seam: '#2e3237', seamRaise: '#383d42',
    nightWindow: '#0b0c0d', nightRaise: '#16181b',
  },

  /* 旧两轮的青黑接缝。冻结在这儿只为让 r3 / r4 保持原样——它们记录的是已经
     发生过的历史，不该被后来的决定改写。新轮次不再用它。 */
  seamTeal: { line: '#14313a', raise: '#1d3538' },

  /* 二维码与打印：这两处不许跟主题走，白底黑块是功能，不是风格。 */
  qr: { ink: '#071316', face: '#ffffff' },
  print: { ink: '#000000', paper: '#ffffff' },

  /* 压在内容上的那层暗纱（站长工具箱的浮层） */
  scrim: '#0a0b0c',
};

/* 把原色 + 透明度写成 rgba()。CSS 里那一堆 rgba(134, 206, 203, 0.16)
   其实就是「初音青的淡版」，在这里写成 rgba(miku.light, .16)，出处就丢不了。 */
export const rgba = (hex, alpha) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/* ---------------------------------------------------------------- 窗
   卷帘那一扇窗是画面里唯一的"另一个地方"，所以它有自己的一套颜色，不跟着页面的
   地 / 墨 / 签 / 示 走。一个 window 方案 = 窗的地、窗的墨、窗里的音符、窗里的此刻。

     ink   墨窗：窗的地就是页面的暗色。它一个色值都不写，只写别名（var(--display)）——
           页面换成哪一轮，窗就跟着变。这是原来那一扇。
     cyan  青窗：青底、白块音符、黑字。它在日间和夜间长得一模一样：它是一块青色的
           实体，不属于任何主题。它还要 overrides——窗里那几根线（--roll-line 之类）
           原来是青 alpha，铺在青地上会整片消失，得换成黑的。

   窗为什么非要自己一套：青的亮度（相对亮度 0.44）容不下粉——#FF3399 落在 #39C5BB
   上只有 1.60:1，近白 #E6EBEF 只有 2.13:1，黑 8.83:1。所以青窗里只留得下黑；
   而"此刻"在窗里也只能是黑的。这是算出来的，不是选的。 */

export const windows = {
  ink: {
    note: '墨窗 —— 窗的地就是页面的暗色，窗跟着轮次变（原来那一扇）',
    '--win-ground': 'var(--display)',
    '--win-ink': 'var(--on-display)',
    '--win-ink-soft': 'var(--on-display-soft)',
    '--win-accent': 'var(--miku)',
    '--win-cue': 'var(--cuer)',
    '--win-note': 'var(--miku)',
    '--win-note-ink': 'var(--display)',
    '--win-note-idle': 'var(--miku)',
    '--win-ghost': 'var(--on-display-soft)',
    '--win-ring': 'var(--cuer)',
    '--win-cursor': 'var(--cuer)',
    '--win-cursor-glow': 'var(--cuer-glow)',
  },

  cyan: {
    note: '青窗 —— 白天青底黑键白字；晚上深底粉键黑字',
    /* 白天：青底、黑块、白字。晚上这一套整块翻过来——地变深、键变粉、字变黑。
       为什么晚上不能还是青底：粉 #FF3399 落在青 #39C5BB 上只有 1.60:1，
       粉块会整块消失（那条黑边救形状不救颜色，见门厅那颗"访客键"）。 */
    '--win-ground': [paint.miku.main, paint.black.window],          /* 白天青地 / 晚上深地 */
    '--win-ink': [paint.black.window, paint.grey.onNight],          /* 8.83:1 / 15.64:1 */
    '--win-ink-soft': ['#20484a', paint.grey.onNightSoft],          /* 4.73:1 / 7.44:1 */
    '--win-accent': [paint.black.window, paint.miku.main],          /* 晚上让青留在读数上（9.21:1） */
    '--win-cue': [paint.black.window, paint.sakura.main],           /* 此刻：白天黑，晚上回到粉 */
    '--win-note': [paint.black.window, paint.sakura.main],          /* 键：黑 / 粉 */
    '--win-note-ink': [paint.grey.paper, paint.black.window],       /* 字：白 / 黑 */
    '--win-note-idle': [paint.black.window, paint.sakura.main],     /* 未点亮：同色淡下去，扫光点亮它 */
    '--win-ghost': [paint.black.window, paint.sakura.main],         /* 定位条里的其他音符 */
    '--win-ring': [paint.black.window, paint.sakura.main],
    '--win-cursor': [paint.black.window, paint.sakura.main],        /* 播放头：白天黑线，晚上粉线 */
    '--win-cursor-glow': [rgba(paint.black.window, 0), rgba(paint.sakura.main, 0.5)],

    overrides: {
      '--roll-line': [rgba(paint.black.window, 0.22), rgba(paint.grey.pale, 0.16)],
      '--roll-line-strong': [rgba(paint.black.window, 0.3), rgba(paint.grey.pale, 0.22)],
      '--roll-lane': [rgba(paint.black.window, 0.15), rgba(paint.grey.pale, 0.12)],
      '--roll-thumb': [rgba(paint.black.window, 0.32), rgba(paint.grey.onNightSoft, 0.35)],
      '--roll-cap': [rgba(paint.grey.paper, 0.88), rgba(paint.grey.pale, 0.14)],   /* 白键 */
      '--roll-cap-line': [rgba(paint.black.window, 0.45), rgba('#000000', 0.85)],
      '--roll-cap-black': [paint.black.window, rgba('#000000', 0.55)],             /* 黑键 */
      '--roll-lane-black': [rgba(paint.black.window, 0.1), rgba('#000000', 0.28)],
      '--note-ring': [rgba(paint.black.window, 0.22), rgba('#000000', 0.18)],
    },
  },
};

/* 当前这扇窗。换窗 = 改这一个字，页面的四色一个不动。 */
export const window = 'cyan';

/* 窗必须有的那些 token（每个 window 方案都要有；note 与 overrides 是额外的）。 */
export const windowCore = Object.keys(windows.ink).filter((k) => k.startsWith('--'));

/* ------------------------------------------------------------ 职务与校验
   对比度是量出来的，不是估的。每条 check 都会在每一轮、每一态上重算一遍，
   低于 min 就报错——所以 tokens.css 顶上那段「实测」说明永远不会说谎。 */

export const checks = [
  { fg: '--ink', bg: '--paper', min: 4.5, why: '正文' },
  { fg: '--ink', bg: '--card', min: 4.5, why: '面板上的正文' },
  { fg: '--ink', bg: '--paper-deep', under: '--paper', min: 4.5, why: '悬停底上的正文' },
  { fg: '--ink', bg: '--mark', min: 4.5, why: '选区里的字' },
  { fg: '--ink-soft', bg: '--paper', min: 4.5, why: '次要文本' },
  { fg: '--miku-deep', bg: '--paper', min: 4.5, why: '地面上被指认的东西：链接 / 序号 / 音高名' },
  { fg: '--miku-deep', bg: '--card', min: 4.5, why: '面板上的链接' },
  { fg: '--cuer', bg: '--paper', min: 3, why: '焦点环与描边（UI 轮廓，3:1 即可）' },
  { fg: '--miku', bg: '--display', min: 4.5, why: '暗窗上的读数与音高' },
  { fg: '--miku', bg: '--key-black', min: 4.5, why: '黑键行的音高名' },
  { fg: '--display', bg: '--miku', min: 4.5, why: '音符块上的字' },
  { fg: '--on-display', bg: '--display', min: 4.5, why: '暗窗正文' },
  { fg: '--on-display', bg: '--display-soft', min: 4.5, why: '暗窗里抬起一层上的字（音乐球的计数角标）' },
  { fg: '--on-display', bg: '--key-black', min: 4.5, why: '黑键行的轨道名' },
  { fg: '--on-display-soft', bg: '--display', min: 4.5, why: '暗窗里的次要文本' },

  /* 门厅（/login）新加的一条：粉第一次被用来铺一块面积。
     那一页只有两颗键，「访客」那颗就是粉的——粉在这里不是气氛，是「此刻要按下
     的那一颗」。粉与青之间的色差只有 1.6:1，所以那颗键另外描一条黑边：键的
     轮廓由黑给出（对青 8:1），不靠粉自己撑。这条只管键面上的字。 */
  { fg: '--display', bg: '--cuer', min: 4.5, why: '门厅：粉键上的字（访客键）' },

  /* 窗自己那一套。它和页面四色是两回事，所以单独验一遍：
     窗换成青的（或以后换成别的）时，是这张表在兜底。 */
  { fg: '--win-ink', bg: '--win-ground', min: 4.5, why: '窗里的正文（轨道名 / 读数）' },
  { fg: '--win-ink-soft', bg: '--win-ground', min: 4.5, why: '窗里的次要文本（标尺 / 篇数）' },
  { fg: '--win-accent', bg: '--win-ground', min: 4.5, why: '窗里被指认的东西' },
  { fg: '--win-cue', bg: '--win-ground', min: 4.5, why: '窗里的「此刻」（悬停读数）' },
  { fg: '--win-note-ink', bg: '--win-note', min: 4.5, why: '音符块上的字' },
  { fg: '--win-cursor', bg: '--win-ground', min: 3, why: '播放头（2px 的线，3:1 即可）' },
  { fg: '--win-ring', bg: '--win-ground', min: 3, why: '音符的悬停 / 焦点描边' },
];

/* token 的职务。生成 CSS 时写成注释，改配色时一眼能看出「这个动不得」。 */
export const jobs = {
  '--paper': '地', '--paper-deep': '地', '--card': '地', '--display': '地', '--display-soft': '地',
  '--key-black': '地', '--key-black-hover': '地', '--mark': '地', '--scrim': '地',
  '--ink': '墨', '--ink-soft': '墨', '--on-display': '墨', '--on-display-soft': '墨',
  '--miku': '签', '--miku-deep': '签',
  '--cuer': '示', '--cuer-glow': '示',
  '--rule': '线', '--rule-soft': '线', '--tap': '线',
  '--roll-line': '窗', '--roll-line-strong': '窗', '--roll-lane': '窗',
  '--roll-thumb': '窗', '--roll-cap': '窗',
  '--roll-cap-line': '窗', '--roll-cap-black': '窗', '--roll-lane-black': '窗',
  '--note-ring': '窗', '--km-seam': '窗', '--km-raise': '窗',
  '--win-ground': '窗·地', '--win-ink': '窗·墨', '--win-ink-soft': '窗·次墨',
  '--win-accent': '窗·签', '--win-cue': '窗·示',
  '--win-note': '窗·音符块', '--win-note-ink': '窗·块上的字',
  '--win-note-idle': '窗·未点亮', '--win-ghost': '窗·定位条的幽灵音符',
  '--win-ring': '窗·描边', '--win-cursor': '窗·播放头', '--win-cursor-glow': '窗·播放头的辉光',
  '--qr-ink': '静', '--qr-face': '静', '--qr-veil': '静', '--qr-soft': '静',
  '--print-ink': '静', '--print-paper': '静',
};

/* ------------------------------------------------------------------ 轮次
   一轮 = 一张完整的表。刻意不写成「在上一轮基础上打补丁」：
   轮次是已经发生过的历史，改 r3 不该悄悄改动 r4 的样子。
   值只有两种写法：
     ['亮态值', '暗态值']   两态不同
     '值'                   两态相同（暗态从 :root 继承，不再重复声明）
   ---------------------------------------------------------------- 历史
   第二轮「青底粉字」没有记进这里——它发生在这个文件存在之前，数值已经找不回来，
   只留下 design/preview-home.png 一张截图。那正是要做这个文件的原因。 */

export const rounds = {
  r3: {
    name: '第三轮 · 中性地面',
    note: [
      '上一轮满屏饱和青做地面，正文吃力、照片发青，而且卷帘的音符块本身就是',
      '#39C5BB —— 青底等于把青从音符手里抢走，只好把音符改成粉。',
      '这一轮地面换成中性冷灰，等级差交给墨量（粗细、疏密、不透明度），不交给色相。',
      '',
      '代价是青在地面上只剩 1.99:1，读不了字，于是「指认」整个交给了粉：',
      '链接、序号、音高名、日期都成了粉。青退进唯一的暗窗（--display）里。',
      '粉的深色档从来源色 #E12885 压深到 #D81B7A，才够地面上的 4.51:1。',
    ].join('\n'),
    tokens: {
      '--paper': ['#f5f8f8', paint.grey.night],
      '--paper-deep': [rgba(paint.miku.dark, 0.08), rgba(paint.miku.light, 0.08)],
      '--card': [paint.grey.card, paint.grey.nightCard],
      '--ink': [paint.grey.ink, paint.grey.onNight],
      '--ink-soft': [paint.grey.soft, paint.grey.onNightSoft],
      '--miku-deep': [paint.sakura.deep, paint.sakura.light],
      '--miku': paint.miku.main,
      '--display': [paint.grey.night, paint.grey.nightDeep],
      '--display-soft': paint.grey.nightCard,
      '--cuer': [paint.sakura.main, paint.sakura.light],
      '--cuer-glow': [rgba(paint.sakura.main, 0.5), rgba(paint.sakura.light, 0.5)],
      '--rule': [paint.grey.rule, paint.grey.nightRule],
      '--rule-soft': [rgba(paint.grey.rule, 0.55), rgba(paint.grey.nightRule, 0.6)],
      '--mark': ['#ffe6f2', '#4a2038'],
      '--key-black': [paint.grey.ink, paint.grey.keyNight],
      '--key-black-hover': [paint.grey.slate, paint.grey.keyNightHover],
      '--on-display': paint.grey.onNight,
      '--on-display-soft': paint.grey.onNightSoft,
      '--tap': [rgba(paint.sakura.main, 0.22), rgba(paint.sakura.light, 0.22)],
      '--scrim': rgba(paint.scrim, 0.55),
      '--roll-line': rgba(paint.miku.light, 0.16),
      '--roll-line-strong': rgba(paint.miku.light, 0.22),
      '--roll-lane': rgba(paint.miku.light, 0.12),
      '--roll-thumb': rgba(paint.grey.onNightSoft, 0.35),
      '--roll-cap': rgba(paint.grey.pale, 0.14),
      '--roll-cap-line': rgba('#000000', 0.85),
      '--roll-cap-black': rgba('#000000', 0.55),
      '--roll-lane-black': rgba('#000000', 0.28),
      '--note-ring': rgba('#000000', 0.18),
      '--km-seam': paint.seamTeal.line,
      '--km-raise': paint.seamTeal.raise,
      '--qr-ink': paint.qr.ink,
      '--qr-face': paint.qr.face,
      '--qr-veil': rgba(paint.qr.face, 0.74),
      '--qr-soft': paint.grey.soft,
      '--print-ink': paint.print.ink,
      '--print-paper': paint.print.paper,
    },
  },

  r4: {
    name: '第四轮 · 青墨归位（候选）',
    note: [
      '第三轮为了让青活下去，把「指认」整个让给了粉。但粉本来只该管一件事：此刻。',
      '它管链接、管序号、管日期，是上一轮被青底逼上去的——青底一撤，它就该退回来。',
      '',
      '  青墨   青在地面上当字的那一档是 #137A7F（4.78:1，过 AA），不是 #39C5BB。',
      '         上一轮量到 1.99:1 就断定「青只配活在暗窗里」，是把「青做不了字」',
      '         误读成了「青做不了地面层」。粉退回焦点环、播放头、正在播放。',
      '  青黑窗 --display 从 #1A1C1E 挪到 #0E2124。全站最大的一块深色变成青黑，',
      '         远看整页就是「青纸 + 一扇青黑的窗」。对比度不降反升，最便宜的一步。',
      '  青黑键 --key-black 跟着走，免得两种黑打架。',
      '  青选区 --mark 从粉换成淡青：粉不再被用来铺任何面积。',
      '  青雾   极淡的青从 .08 加到 .10，地面凉一点，但不至于变成底色。',
      '',
      '还没动的一条：--rule 仍是中性灰。把细线也染青是下一轮的实验——青色是刻度色，',
      '但细线一染，「纸」的感觉就没了，得看过再说。',
    ].join('\n'),
    tokens: {
      '--paper': ['#f5f8f8', paint.grey.night],
      '--paper-deep': [rgba(paint.miku.dark, 0.1), rgba(paint.miku.light, 0.09)],
      '--card': [paint.grey.card, paint.grey.nightCard],
      '--ink': [paint.grey.ink, paint.grey.onNight],
      '--ink-soft': [paint.grey.soft, paint.grey.onNightSoft],
      '--miku-deep': [paint.miku.dark, paint.miku.main],
      '--miku': paint.miku.main,
      '--display': [paint.miku.ink, '#0b1a1c'],
      '--display-soft': [paint.seamTeal.raise, paint.seamTeal.line],
      '--cuer': [paint.sakura.main, paint.sakura.light],
      '--cuer-glow': [rgba(paint.sakura.main, 0.5), rgba(paint.sakura.light, 0.5)],
      '--rule': [paint.grey.rule, paint.grey.nightRule],
      '--rule-soft': [rgba(paint.grey.rule, 0.55), rgba(paint.grey.nightRule, 0.6)],
      '--mark': ['#d7efed', '#17343a'],
      '--key-black': ['#123039', '#0b1a1c'],
      '--key-black-hover': ['#1a4650', '#12262a'],
      '--on-display': paint.grey.onNight,
      '--on-display-soft': paint.grey.onNightSoft,
      '--tap': [rgba(paint.sakura.main, 0.22), rgba(paint.sakura.light, 0.22)],
      '--scrim': rgba(paint.scrim, 0.55),
      '--roll-line': rgba(paint.miku.light, 0.16),
      '--roll-line-strong': rgba(paint.miku.light, 0.22),
      '--roll-lane': rgba(paint.miku.light, 0.12),
      '--roll-thumb': rgba(paint.grey.onNightSoft, 0.35),
      '--roll-cap': rgba(paint.grey.pale, 0.14),
      '--roll-cap-line': rgba('#000000', 0.85),
      '--roll-cap-black': rgba('#000000', 0.55),
      '--roll-lane-black': rgba('#000000', 0.28),
      '--note-ring': rgba('#000000', 0.18),
      '--km-seam': paint.seamTeal.line,
      '--km-raise': paint.seamTeal.raise,
      '--qr-ink': paint.qr.ink,
      '--qr-face': paint.qr.face,
      '--qr-veil': rgba(paint.qr.face, 0.74),
      '--qr-soft': paint.grey.soft,
      '--print-ink': paint.print.ink,
      '--print-paper': paint.print.paper,
    },
  },

  r5: {
    name: '第五轮 · 四色归位（候选）',
    note: [
      '第四轮把暗窗挪成了青黑，想让整页远看就是青的。可那一手把黑染青了：黑和青同族，',
      '青落在黑上就只剩明度差、没有了彩度差——青/粉/白/黑四个颜色塌成三个，青反而变弱，',
      '它不再是画面里唯一的彩度，而被读成"深一点的青"配"浅一点的青"。',
      '',
      '这一轮守住四个颜色各自的身份，谁也别吃掉谁：',
      '',
      '  黑回中性  --display  #0E2124 → #101214，黑键 #123039 → #1A1D20，云村播放条的',
      '            接缝也跟着去青（#14313A → #2E3237）。黑越纯，青越亮。',
      '  白是面积  --paper / --card 本来就是全站最大的白。这一轮让白在暗窗里也看得见：',
      '            钢琴那一列白键从 14% 提到 22%——它得真的像一排白键。',
      '  青扛指认  #137A7F 当字、#39C5BB 当块，与上一轮相同。另把暗态地面上那层字',
      '            从 #39C5BB 换成 #86CECB（对 #1A1C1E 9.53:1）：更深的一档反而更浅，',
      '            这样暗窗仍然独占那个满浓度的青。',
      '  粉管此刻  选区从青回到粉——它也是"你此刻选中的"。于是粉有这些地方：焦点环、',
      '            点按高亮、当前页那条下划线、播放头、正在播放的按钮、卷帘读数、选区。',
      '            没有一处是铺面积的，但每一页都会遇到它。',
    ].join('\n'),
    tokens: {
      '--paper': ['#f5f8f8', paint.grey.night],
      '--paper-deep': [rgba(paint.miku.dark, 0.1), rgba(paint.miku.light, 0.09)],
      '--card': [paint.grey.card, paint.grey.nightCard],
      '--ink': [paint.grey.ink, paint.grey.onNight],
      '--ink-soft': [paint.grey.soft, paint.grey.onNightSoft],
      '--miku-deep': [paint.miku.dark, paint.miku.light],
      '--miku': paint.miku.main,
      '--display': [paint.black.window, paint.black.nightWindow],
      '--display-soft': [paint.black.raise, paint.black.nightRaise],
      '--cuer': [paint.sakura.main, paint.sakura.light],
      '--cuer-glow': [rgba(paint.sakura.main, 0.5), rgba(paint.sakura.light, 0.5)],
      '--rule': [paint.grey.rule, paint.grey.nightRule],
      '--rule-soft': [rgba(paint.grey.rule, 0.55), rgba(paint.grey.nightRule, 0.6)],
      '--mark': ['#ffe6f2', '#4a2038'],
      '--key-black': [paint.black.key, paint.black.nightWindow],
      '--key-black-hover': [paint.black.keyHover, paint.black.nightRaise],
      '--on-display': paint.grey.onNight,
      '--on-display-soft': paint.grey.onNightSoft,
      '--tap': [rgba(paint.sakura.main, 0.22), rgba(paint.sakura.light, 0.22)],
      '--scrim': rgba(paint.scrim, 0.55),
      '--roll-line': rgba(paint.miku.light, 0.16),
      '--roll-line-strong': rgba(paint.miku.light, 0.22),
      '--roll-lane': rgba(paint.miku.light, 0.12),
      '--roll-thumb': rgba(paint.grey.onNightSoft, 0.35),
      '--roll-cap': rgba(paint.grey.pale, 0.22),
      '--roll-cap-line': rgba('#000000', 0.85),
      '--roll-cap-black': rgba('#000000', 0.55),
      '--roll-lane-black': rgba('#000000', 0.28),
      '--note-ring': rgba('#000000', 0.18),
      '--km-seam': paint.black.seam,
      '--km-raise': paint.black.seamRaise,
      '--qr-ink': paint.qr.ink,
      '--qr-face': paint.qr.face,
      '--qr-veil': rgba(paint.qr.face, 0.74),
      '--qr-soft': paint.grey.soft,
      '--print-ink': paint.print.ink,
      '--print-paper': paint.print.paper,
    },
  },
};

/* 当前生效的一轮。换整套配色，改这一个字。 */
export const active = 'r3';

/* 轮次的声明顺序 = 版本顺序，生成器靠它算「与上一轮的不同之处」。 */
export const order = ['r3', 'r4', 'r5'];
