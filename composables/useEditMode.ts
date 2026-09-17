/* ==========================================================================
   composables/useEditMode.ts · 全局编辑模式
   ---------------------------------------------------------------------------
   页顶那颗「全局编辑」按钮一按，整站进入编辑模式：

     · 虚线框里的文字点一下就变成可编辑的（不用右键）：
       板块页的板块名 / 简介 / 导语，文章页的标题 / 正文，
       以及任何页面上的轨道栏板块名、首页索引、卷帘轨道头、文章行标题。
     · 简介或导语是空的（板块页连那个 <p> 都没有）时，框里摆一颗
       「＋ 新建」：点它就地开工，存进去的就是从零新建的那一句。
     · Esc 退出；正在改的那一段先按它自己的规矩来（改过会问你一句）。

   身份与右键菜单同一把尺：服务在线、浏览器里有口令的人才看得到按钮
   （见 components/CommandBar.vue）。访客的页面一个字节都不动。真正的权限
   仍然在服务端那一层（每一次 PATCH 都要口令），这里只是把手递到明处。

   两条实现上的规矩：
     · 描点用 WeakMap 记，而且每次都是「从零认一遍」——Nuxt 的内容变了就是
       一次重渲染，旧节点会消失，挂在旧节点上的东西也就没有意义了。
     · 换页时不监听任何自定义事件：靠 watch(route) + 一个对站点共享状态的
       watch——改完名字 / 撤下一条之后 refreshSite() 一跑，整页重渲染，
       描点要跟着重来。
   ========================================================================== */
import { editActive, startEdit } from './useInlineEdit';
import { askState } from './useAsk';
import { bridgeToast } from './useEditBridge';
import { menuState } from './useContextMenu';
import { useSite } from './useSite';

export type SlotKind = 'name' | 'text' | 'title' | 'body';
export type Slot = {
  kind: SlotKind;
  el: HTMLElement | null;
  id?: string;
  field?: 'def' | 'lede';
  slug?: string;
};

/* 编辑模式开着没有。模块级：按钮（CommandBar）与描点（EditOverlay）在两棵子树上 */
const on = ref(false);
const targetCount = ref(0);

/* 这一页认出来的可编辑位置，以及「哪个节点属于哪个位置」 */
const SLOTS = new WeakMap<Element, Slot>();
let slots: Slot[] = [];
/* 我造出来的空壳导语（静态板块页在 lede 为空时连 <p> 都不渲染）：
   人没写东西进去就一并收走，别在页面上留一个空档 */
const ghosts: HTMLElement[] = [];

export const editModeOn = () => on.value;
export const editModeTargets = () => targetCount.value;
/* 右键菜单开着没有（它住在 useContextMenu 里，这里只问一句） */
const menuOpen = () => menuState.on;

/* 动态板块页拿「新建板块」当空简介的占位——它不算内容，算空 */
const EMPTY_MARKS: Record<string, boolean> = { '': true, '新建板块': true };

/* ------------------------------------------------------------ 小工具 */

/* 拍平成纯文本：<br> 折成空格，其余标签摘掉，空白压成一格 */
const plainOf = (html: string) =>
  String(html == null ? '' : html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const oneLine = (el: Element | null) => String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();

/* 这一段是不是「空的」：元素不存在、只有一个 <br>、或者只剩动态页那句
   「新建板块」占位——都算，都要给站长一颗「＋ 新建」。 */
const isEmptyText = (el: Element | null): boolean => {
  if (!el) return true;
  return Boolean(EMPTY_MARKS[plainOf((el as HTMLElement).innerHTML)] || EMPTY_MARKS[oneLine(el)]);
};

/* href → 板块 id / 文章 slug（见 composables/usePageRoutes.ts）：
   干净路由 /sections/x 与 /posts/x 是正身，老地址 sections/x.html、posts/x.html
   也照认——它们会被 301 过来，但页面上可能还留着旧链接。 */
import { sectionIdOf, slugOf } from './usePageRoutes';

/* Nuxt 的干净路由：/posts/<slug>、/sections/<id>、/sections/<id>/<sub>。
   注意：这两个正则只能在浏览器里跑——服务端渲染时模块级求值会碰到 location
   未定义（preflight 的 500 就是这么来的），所以放在 computeTargets 里面。 */

/* ------------------------------------------------------------ 这一页有哪些可编辑的位置
   只认「改字」这一类事：名字、简介、导语、标题、正文。
   删除 / 撤下这些破坏性的动作仍然住在右键菜单里——编辑模式要敢开着到处点，
   就不能藏着一顺手就删东西的按钮。 */
const computeTargets = (): Slot[] => {
  const out: Slot[] = [];
  const main = document.querySelector('main#main');
  const path = typeof location === 'undefined' ? '' : location.pathname;
  const pagePost = /^\/posts\/([^/]+?)\/?$/.exec(path);
  const pageSection = /^\/sections\/([^/]+?)(?:\/([^/]+?))?\/?$/.exec(path);

  const add = (kind: SlotKind, el: Element | null, extra: Partial<Slot> = {}) => {
    if (!el) return;
    out.push({ kind, el: el as HTMLElement, ...extra });
  };

  /* 任何页面都有的：轨道栏的板块名 */
  for (const a of Array.from(document.querySelectorAll('.rail a.key'))) {
    const id = sectionIdOf(a.getAttribute('href') || '');
    if (id) add('name', a.querySelector('.key__name'), { id });
  }
  /* 首页卷帘的轨道头 */
  for (const h of Array.from(document.querySelectorAll('.roll--hero .head'))) {
    const id = sectionIdOf(h.getAttribute('href') || '');
    if (id) add('name', h.querySelector('.head__name'), { id });
  }
  /* 首页索引：板块名与那行简介（简介就是板块的 def，只是换了地方摆） */
  for (const li of Array.from(document.querySelectorAll('.entry'))) {
    const a = li.querySelector('.entry__name a');
    const id = a ? sectionIdOf(a.getAttribute('href') || '') : '';
    if (!id) continue;
    add('name', a, { id });
    add('text', li.querySelector('.entry__blurb'), { id, field: 'def' });
  }
  /* 板块页 / 归档里的文章行标题 */
  for (const li of Array.from(document.querySelectorAll('.post-row'))) {
    const a = li.querySelector('.post-row__link');
    const slug = a ? slugOf(a.getAttribute('href') || '') : '';
    if (slug) add('title', li.querySelector('.post-row__title'), { slug });
  }

  /* 文章页：标题与正文 */
  if (pagePost && main) {
    const slug = decodeURIComponent(pagePost[1]);
    add('title', main.querySelector('.article__title'), { slug });
    add('body', main.querySelector('.prose'), { slug });
    return out;
  }

  /* 板块页（子板块页没有自己的简介 / 导语接口，页头那行字是子板块的，
     想改它的名字仍走右键菜单——这里不认它） */
  if (pageSection && !pageSection[2] && main) {
    const sid = decodeURIComponent(pageSection[1]);
    add('name', main.querySelector('.sect-head__name'), { id: sid });
    add('text', main.querySelector('.sect-head__def'), { id: sid, field: 'def' });
    /* 导语可能整段缺失（动态页在 lede 为空时连 <p> 都不渲染）：
       这一条要故意带着 null 进名单——decorate 时把它造出来。 */
    out.push({ kind: 'text', el: main.querySelector('main .lede') as HTMLElement | null, id: sid, field: 'lede' });
  }
  return out;
};

/* ------------------------------------------------------------ 占位与「＋ 新建」 */

/* 导语「整段缺失」的页面，先给它把 <p class="lede"> 造出来（摆在板块页头的后面）。
   两种情形一起管：元素真的不在（lede 为空时模板连那个 <p> 都不吐），
   或者元素在但里面什么都没有（v-html="" 仍然会吐出空的 <p class="lede"></p>）。
   后者也算「整段缺失」——不把这种情况认出来，那颗「＋ 新建导语」就永远不出现。 */
const ensureLedeEl = (slot: Slot): HTMLElement | null => {
  const empty = (el: HTMLElement) => !plainOf(el.innerHTML) || Boolean(EMPTY_MARKS[plainOf(el.innerHTML)]);
  if (slot.el) {
    if (empty(slot.el)) slot.el.setAttribute('data-gm-ghost', '');
    return slot.el;
  }
  const head = document.querySelector('main .sect-head');
  if (!head) return null;
  const el = document.createElement('p');
  el.className = 'lede';
  el.setAttribute('data-gm-ghost', '');
  head.insertAdjacentElement('afterend', el);
  slot.el = el;
  ghosts.push(el);
  return el;
};

const chipFor = (slot: Slot): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'gm-chip';
  b.textContent = slot.field === 'lede' ? '＋ 新建导语' : '＋ 新建简介';
  return b;
};

/* 点下「＋ 新建」或点进空框之前：把占位清干净（「新建板块」那几个字、
   空导语里的 <br>、chip 本身），让编辑从一张真正的白纸开始。
   取消的话 cv01:edit-ended 会把 chip 补回来。 */
const clearForEdit = (slot: Slot) => {
  const el = slot.el;
  if (!el) return;
  if (plainOf(el.innerHTML) && !EMPTY_MARKS[oneLine(el)]) return; /* 有真内容：一个字都不动 */
  el.innerHTML = '';
};

/* ------------------------------------------------------------ 描点 / 擦除 */

const decorate = () => {
  slots = computeTargets();
  for (const slot of slots) {
    let el = slot.el;
    if (slot.field === 'lede') el = ensureLedeEl(slot);
    if (!el) continue;
    SLOTS.set(el, slot);
    el.setAttribute('data-gm', slot.kind);
    if (slot.kind === 'text' && isEmptyText(el)) {
      el.classList.add('is-gm-empty');
      if (!el.querySelector('.gm-chip')) el.appendChild(chipFor(slot));
    }
  }
  targetCount.value = slots.filter((s) => Boolean(s.el)).length;
  if (!slots.length) bridgeToast('这一页没有可编辑的文字', false, null, true);
};

const undecorate = () => {
  for (const ghost of ghosts.splice(0)) {
    /* 人没写东西进去的空壳导语：收走。写进去了（或已经被 Vue 重渲染换掉）
       就留着——内容归页面自己管 */
    if (ghost.isConnected && isEmptyText(ghost)) ghost.remove();
  }
  for (const slot of slots) {
    const el = slot.el;
    if (!el) continue;
    SLOTS.delete(el);
    el.removeAttribute('data-gm');
    el.classList.remove('is-gm-empty');
    const chip = el.querySelector('.gm-chip');
    if (chip) chip.remove();
    el.removeAttribute('data-gm-ghost');
  }
  slots = [];
  targetCount.value = 0;
};

/* 保存或取消之后重新看一眼：存进去了 → 框里就是真内容，chip 不再出现；
   取消了一次新建 → 框还是空的，chip 补回来，随时可以再来。 */
export const refreshSlots = () => {
  if (!on.value) return;
  undecorate();
  decorate();
};

/* ------------------------------------------------------------ 点字即改 */

/* 正在改的那一段就是它自己的「链接」：改着这一段时点别处的链接不跳，
   先问一句——跳了就是一次整页刷新，没保存的字就全没了。
   （框里的链接本来就不会跳：浏览器对可编辑区里的链接只放光标。） */
export const editModeClick = (e: MouseEvent) => {
  if (!on.value) return;
  if (!ownerNow()) return;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

  if (editActive()) {
    const target = e.target as HTMLElement | null;
    const a = target && target.closest ? target.closest('a[href]') : null;
    if (a && !a.closest('[contenteditable="true"]')) {
      e.preventDefault();
      e.stopPropagation();
      bridgeToast('先保存或取消这一段（Ctrl+S / Esc），再点链接');
    }
    return;
  }

  if (e.defaultPrevented) return;
  const node = e.target as HTMLElement | null;
  const el = node && node.closest ? (node.closest('[data-gm]') as HTMLElement | null) : null;
  if (!el) return;
  const slot = SLOTS.get(el);
  if (!slot) return;
  e.preventDefault(); /* 此刻它是字，不是门 */
  e.stopPropagation();

  clearForEdit(slot);
  const point = { x: e.clientX, y: e.clientY };
  if (slot.slug) {
    /* 查一查这篇住在哪一层（界面写的还是原生的）：提示条要说得准 */
    import('./useArticleLayers')
      .then((m) => m.loadLayers())
      .then((map) => startEdit(slot.kind, slot, map.posts[slot.slug as string] || {}, point))
      .catch(() => startEdit(slot.kind, slot, {}, point));
  } else {
    startEdit(slot.kind, slot, {}, point);
  }
};

/* 「＋ 新建」那颗按钮：它住在 [data-gm] 里面，click 会冒到上面那条，
   所以这里不用单独处理——旧站也是这么走的（说明一下，免得看代码时四处找）。 */

/* ------------------------------------------------------------ 开与关 */

export const enterEditMode = () => {
  on.value = true;
  document.documentElement.setAttribute('data-editmode', 'on');
  decorate();
  bridgeToast('编辑模式开着：虚线框里的文字点一下就能改，空简介 / 导语点「＋ 新建」。Esc 退出', false, null, true);
};

export const exitEditMode = () => {
  on.value = false;
  document.documentElement.removeAttribute('data-editmode');
  undecorate();
  /* 退出时手上还改着一段：交给它自己的规矩——改过会先问你一句 */
  if (editActive()) {
    import('./useInlineEdit').then((m) => m.cancelEdit());
  }
};

const toggle = () => {
  if (on.value) exitEditMode();
  else enterEditMode();
};

/* Esc：退出模式。手上正改着一段时不接手——那一段的 Esc 是「取消这次编辑」；
   口令框 / 「问一句」/ 右键菜单**开着**的时候也不接手（Esc 是它们的事）。 */
export const editModeEscape = (e: KeyboardEvent) => {
  if (!on.value || e.key !== 'Escape') return false;
  if (e.defaultPrevented) return false;
  if (editActive()) return false;
  if (askState.value.on) return false;
  /* 口令框（.keygate）与「问一句」都是 v-if，不在 DOM 里就是没开；
     右键菜单走 v-show（它一直在 DOM 里，只是 display: none），必须看状态 */
  if (document.querySelector('.keygate')) return false;
  if (menuOpen()) return false;
  exitEditMode();
  return true;
};

/* ------------------------------------------------------------ 宿主（EditOverlay.vue） */

/* 「现在是不是站长」由宿主（EditOverlay）装进来：按钮何时出现是 CommandBar 的事，
   但点字即改那一层也要同一把尺——浏览器里的口令被忘掉之后（门厅的「访客进入」），
   编辑模式当场退出，这一条也不该再认字。 */
let ownerNow: () => boolean = () => false;
export const setEditModeOwner = (fn: () => boolean) => {
  ownerNow = fn;
};

export const useEditMode = () => {
  const site = useSite();
  const route = useRoute();

  /* 内容变了（改名、撤下、写完一篇）：Nuxt 会重渲染，描点跟着重来。
     旧站靠 cv01:navigated 那一声，这里靠共享状态 + 路由。 */
  watch(
    () => site.value,
    () => {
      if (on.value) nextTick(refreshSlots);
    },
    { deep: false }
  );
  watch(
    () => route.fullPath,
    () => {
      if (on.value) nextTick(refreshSlots);
    }
  );

  /* 服务在线 + 浏览器里有口令 = 站长。两个条件少一个都是访客（按钮的事见 CommandBar） */
  const owner = computed(() => ownerNow());

  return { editMode: on, targets: targetCount, owner, toggle };
};
