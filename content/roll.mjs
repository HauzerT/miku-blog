/* ==========================================================================
   content/roll.mjs · 卷帘的几何
   ---------------------------------------------------------------------------
   「钢琴卷帘当目录」这件事的算式全在这里，而且只有这一份：

     · 轨道节奏槽（RHYTHMS / noteWidth / slotOf）—— 音符的 x 与宽度
     · 时间轴接龙（timelineChain / chainMonths / timelineSpan）—— 首页那条大卷帘的横轴
     · 几个小工具（cn / hash / brToSpace）

   谁在用：
     server/lib/shell.mjs   —— 生成器（tools/build.mjs）与旧上传服务渲染页面时用
     Vue 组件（components/RollHero.vue 等）—— Nuxt 应用 SSR 时用
     未来浏览器那份（assets/js/site.js 的 layoutTimeline）—— 仍按老规矩两边一起改

   这个文件**不碰 node: 也不碰 DOM**，谁都能 import。
   ========================================================================== */

export const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
export const cn = (n) => CN[n] || String(n);

/* 供 CSS 做变量用：把任意字符串压成一个稳定的短哈希 */
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/* 给字符串套一个 <br> 分隔器（tracks 里的 lede 用 <br> 换行） */
export const brToSpace = (s) => String(s || '').replace(/<br\s*\/?>/gi, ' ');

/* 卷帘节奏：每条轨道上音符的位置（x%）与宽度（w%）。
   手工排的，不是随机数——它们决定整条卷帘的呼吸。
   宽度对应文章的阅读分钟数（见 noteWidth）。顺序必须与轨道一致（高音在上）。 */
export const RHYTHMS = [
  [[4, 15], [25, 19], [54, 21]], // A5  二次生命
  [[2, 21], [30, 14], [52, 24]], // F#5 恰同学少年
  [[2, 19], [27, 23], [58, 14]], // D5  胡盐乱雨集
  [[5, 13], [24, 21], [52, 26]], // B4  千千千世界
  [[2, 26], [34, 12], [55, 17]], // G4  生活在云上
  [[8, 16], [30, 25], [63, 19]], // E4  剪剪又辑辑
  [[3, 21], [32, 15], [56, 22]], // C4  整点薯条
  [[6, 12], [23, 26], [56, 18]], // A3  网上囚徒
  [[2, 17], [26, 14], [48, 29]], // F#3 做题区doge
];

export function noteWidth(trackIndex, postIndex) {
  const rhythm = RHYTHMS[trackIndex % RHYTHMS.length];
  if (postIndex < rhythm.length) return rhythm[postIndex];
  const x = 2 + postIndex * 20;
  return [Math.min(x, 96 - 12), 12];
}

/* 一条轨道在卷帘上的「节奏槽」：迷你定位条（roll--strip）的 x 位置由它决定。
   显示顺序按音高排（高音在上），但节奏槽钉在内容顺序上——
   否则运行时新建一个更高的板块，会让所有已有轨道的音符节奏跟着挪位。
   静态页由生成器写死节奏槽（就是数组下标），服务端渲染时用 track.slot。 */
export const slotOf = (track, index) => (Number.isFinite(track.slot) ? track.slot : index);

/* ------------------------------------------------------------------ 时间轴
   首页那条大卷帘的横轴不是日历，是接龙：全部文章按日期从旧到新排成一列，
   一篇紧挨一篇往右接——中间隔了三天还是十个月，卷帘上都只是一个音符的
   宽度加一格休止，没发博的日子不留空白。尺子的单位仍是「天」
   （--roll-day = 一天的宽），只是这些天是压缩过的：
   · 每篇音符占 min × 1.3 天（压在 5–11 天之间）：宽 = 读得久；
   · 相邻两篇之间空 REST 天当休止；同一天的多篇也依次往右排，挤不重叠；
   · 左端留 HEAD 天、右端留 TAIL 天——右端那格是「还没写的下一篇」。
   · 画布按这些压缩过的天算宽（--days × --roll-day），文章越写越多，轴往右长。
   生成器、Nitro 与浏览器用同一套算式（浏览器那份在 assets/js/site.js 的
   layoutTimeline，改要两边一起改）。 */
const REST = 4;   /* 相邻两篇之间的休止（压缩天） */
const HEAD = 2;   /* 左端留白 */
const TAIL = 14;  /* 右端留白 */

export const dateDay = (value) => {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(String(value || ''));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
};
const clamp01 = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const noteDays = (min) => clamp01((Number(min) || 5) * 1.3, 5, 11);

/* posts：文章对象（认 .date 与 .min，顺序随意）。按日期从旧到新接成一条链，
   返回 { notes, span }：notes 是按接龙顺序排好的 [{ post, date, x, w }]
   （x/w 的单位是压缩天，CSS 里按 --roll-day 折成像素——画布拉宽，音符
   不会跟着虚胖），span 是整条轴的长度。一篇认得出的日期都没有就返回
   null，调用方退回节奏槽。同一天的多篇按传入顺序接（排序是稳定的，
   传入顺序即轨道自上而下的次序，浏览器那份也对得上）。 */
export function timelineChain(posts) {
  const dated = (posts || [])
    .filter((p) => p && Number.isFinite(dateDay(p.date)))
    .sort((a, b) => dateDay(a.date) - dateDay(b.date));
  const notes = [];
  let cursor = HEAD;
  for (const post of dated) {
    const w = noteDays(post.min);
    notes.push({ post, date: post.date, x: cursor, w });
    cursor += w + REST;
  }
  if (!notes.length) return null;
  return { notes, span: cursor - REST + TAIL };
}

/* 顶部刻度：每个月的牌子挂在这个月第一篇音符的起点上，牌子后面带着
   这个月的篇数（只有一篇的不报数）。接龙轴上同月的音符本来就一篇挨
   一篇排在一起，牌子只管报数，不再把音符归拢进色块；月份先后还在，
   牌子按月序排，永不互相压住。没发博的月份天然没有牌子。 */
export function chainMonths(chain) {
  if (!chain) return [];
  const out = [];
  let last = '';
  for (const n of chain.notes) {
    const label = String(n.date).slice(0, 7);
    if (label !== last) {
      out.push({ x: Number(((n.x / chain.span) * 100).toFixed(2)), label, count: 1 });
      last = label;
    } else {
      out[out.length - 1].count += 1;
    }
  }
  return out;
}

/* 读数上那段时间跨度：同年写成 2025.01–03，跨年写成 2025.11–2026.02 */
export function timelineSpan(minDate, maxDate) {
  const a = String(minDate || '').slice(0, 7);
  const b = String(maxDate || '').slice(0, 7);
  if (!a || !b) return '';
  return a.slice(0, 4) === b.slice(0, 4) ? a + '–' + b.slice(5) : a + '–' + b;
}
