/* ==========================================================================
   composables/useRoll.ts · 卷帘的运行时行为
   ---------------------------------------------------------------------------
   assets/js/site.js 里与卷帘有关的那几条搬到这里：

     · layoutTimeline   运行时文章补进卷帘后，按接龙把整条轴重排一遍
     · measureRolls     量过之后才决定要不要说「可以左右滑动」
     · useRollZoom      Ctrl + 滚轮调时间尺度（只绑首页大卷帘）

   接龙的算式本身住在 content/roll.mjs —— 生成器、Nitro 与浏览器共用一份。
   ========================================================================== */
import { dateDay } from '../content/roll.mjs';

const HEAD_DAYS = 2;   /* 左端留白 */
const REST_DAYS = 4;   /* 相邻两篇之间的休止 */

/* 运行时文章补进卷帘后，用同一把尺把音符与月份刻度重排一遍。
   静态页烤着生成器算好的位置；这条只在「页面上出现了 data-live 的音符」时用。 */
export function layoutTimeline(roll) {
  const ruler = roll.querySelector('.roll__ruler');
  const notes = Array.from(roll.querySelectorAll('.note')).filter((n) =>
    Number.isFinite(dateDay(n.getAttribute('data-date')))
  );
  if (!notes.length || !ruler) return;

  notes.sort((a, b) => {
    const da = a.getAttribute('data-date');
    const db = b.getAttribute('data-date');
    return da < db ? -1 : da > db ? 1 : 0;
  });

  const months = [];
  let lastMonth = '';
  let cursor = HEAD_DAYS;
  for (const note of notes) {
    const w = Math.min(11, Math.max(5, (parseFloat(note.getAttribute('data-min')) || 5) * 1.3));
    const month = String(note.getAttribute('data-date')).slice(0, 7);
    if (month !== lastMonth) {
      months.push({ x: cursor, label: month, count: 1 });
      lastMonth = month;
    } else {
      months[months.length - 1].count += 1;
    }
    note.__cv01Day = { x: cursor, w };
    cursor += w + REST_DAYS;
  }
  const span = cursor - REST_DAYS + 14; /* 右端那格留给「还没写的下一篇」 */

  roll.style.setProperty('--days', String(Math.ceil(span)));

  for (const note of notes) {
    const day = note.__cv01Day;
    delete note.__cv01Day;
    const x = (day.x / span) * 100;
    note.style.setProperty('--x', x.toFixed(2));
    note.style.setProperty('--w', day.w.toFixed(2));
    note.setAttribute('data-x', x.toFixed(2));
  }

  /* 月份牌子挂在每个月第一篇的起点上，只报数、不归拢（见 content/roll.mjs） */
  ruler.innerHTML = months
    .map((m) => {
      const text = m.label + (m.count > 1 ? ' · ' + m.count + ' 篇' : '');
      return `<span class="roll__month" style="--x:${((m.x / span) * 100).toFixed(2)}">${text}</span>`;
    })
    .join('');

  measureRolls();
}

/* 卷帘只在窄屏上横向溢出：量过之后再决定要不要说「可以左右滑动」
   （提示本身由 roll.css 用 .is-scrollable 打开） */
export function measureRolls() {
  if (!import.meta.client) return;
  for (const roll of document.querySelectorAll('[data-roll]')) {
    const scroller = roll.querySelector('.roll__scroller');
    if (scroller) roll.classList.toggle('is-scrollable', scroller.scrollWidth > scroller.clientWidth + 1);
  }
}

/* Ctrl + 滚轮：调时间尺度（一天多宽）。滚上 = 放大、滚下 = 缩小，
   写进卷帘自己的 --roll-day，roll.css 的画布算式就地生效——所有位置都是
   百分比，音符、刻度跟着一起胖瘦。缩放后按比例留在原来的横向上。 */
export function useRollZoom(rollEl) {
  onMounted(() => {
    const roll = rollEl.value;
    if (!roll || !roll.classList.contains('roll--hero')) return;
    const scroller = roll.querySelector('.roll__scroller');
    if (!scroller) return;

    const onWheel = (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const root = document.documentElement;
      const declared = getComputedStyle(roll).getPropertyValue('--roll-day').trim();
      const rem = parseFloat(getComputedStyle(root).fontSize) || 16;
      const day = declared.includes('rem')
        ? (parseFloat(declared) || 1.15) * rem
        : parseFloat(declared) || 1.15 * rem;
      let next = day * (event.deltaY < 0 ? 1.12 : 1 / 1.12);
      if (next < 8) next = 8;
      if (next > 56) next = 56;
      if (Math.abs(next - day) < 0.05) return;
      const before = scroller.scrollWidth - scroller.clientWidth;
      const left = scroller.scrollLeft;
      roll.style.setProperty('--roll-day', next.toFixed(2) + 'px');
      const after = scroller.scrollWidth - scroller.clientWidth;
      if (after > 0 && before > 0) scroller.scrollLeft = left * (after / before);
      measureRolls();
    };

    scroller.addEventListener('wheel', onWheel, { passive: false });
    onBeforeUnmount(() => scroller.removeEventListener('wheel', onWheel));
  });
}

/* 卷帘上的键盘导航：上下换轨，左右在同一轨内沿时间轴移动，Home / End 到首尾 */
export function useRollKeys(rollEl) {
  const onKeydown = (event) => {
    const key = event.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
    const root = rollEl.value;
    if (!root) return;
    const notes = Array.from(root.querySelectorAll('.note'));
    const current = document.activeElement;
    if (notes.indexOf(current) === -1) return;
    event.preventDefault();

    let target = null;
    if (key === 'Home') target = notes[0];
    else if (key === 'End') target = notes[notes.length - 1];
    else if (key === 'ArrowUp' || key === 'ArrowDown') {
      target = notes[notes.indexOf(current) + (key === 'ArrowDown' ? 1 : -1)];
    } else {
      const lane = Array.from(current.parentNode.querySelectorAll('.note'));
      target = lane[lane.indexOf(current) + (key === 'ArrowRight' ? 1 : -1)];
    }
    if (target) target.focus();
  };
  return { onKeydown };
}
