/* ==========================================================================
   composables/useInlineEdit.ts · 页面上直接改字（旧站 studio.js 那一大段）
   ---------------------------------------------------------------------------
   右键 → 「编辑正文…」、或者全局编辑模式里点一下字：那一段当场变成可编辑的，
   光标落在你点的地方，页面上多出一条工具条（一级 / 二级 / 正文 / 注释，
   B / I / U(青) / U(粉) / S，还有一个 emoji 面板 ☺）。

   与旧站一一对应的是这些函数（名字都留着，方便对着读）：
     placeCaret / execCmd / touchedBlocks / retag / setBlock / underline
     buildBar / EMOJI_PICKER / insertAtCaret / toggleEmoji / placeBar
     startEdit / stopEdit / onEditKey / cancelEdit / textWithBreaks / saveEdit

   存到哪儿，还是那两层（一个字都不许动）：
     界面上写的文章（data/articles.json）→ 真正的 body / title 字段
     content/posts.mjs 里的原生文章    → data/overrides.json 的 body / title，
                                          源文件不动
     板块页那两段文字（简介 / 导语）    → data/sections.json 里的字段，直接改

   两条硬规矩：
     · 一次只改一段（edit 只有一份；改着的时候 start 直接返回）；
     · 工具条上的按钮 mousedown 一律 preventDefault——不然可编辑区一丢焦点，
       选区就没了，「选中文字再加效果」这套就废了。
   ========================================================================== */
import { bridgeError, bridgeRefresh, bridgeToast, bridgeWithKey, editReport } from './useEditBridge';
import { forgetLayers } from './useArticleLayers';

export type EditKind = 'body' | 'text' | 'name' | 'title';

export type EditTarget = {
  kind?: EditKind;
  el?: HTMLElement | null;
  /* 板块：{ id, field } */
  id?: string;
  field?: 'def' | 'lede';
  /* 文章：{ slug } */
  slug?: string;
};

type Session = {
  kind: EditKind;
  el: HTMLElement;
  target: EditTarget;
  info: any;
  before: string;
  beforeText: string;
  changed: boolean;
  saving: boolean;
};

/* ------------------------------------------------------------ 模块级的那一份状态 */

const edit = ref<Session | null>(null);
/* 工具条贴命令栏往下挂。命令栏是 sticky 的，位置随滚动变，所以是一个 ref */
const barTop = ref(10);
const emojiOpen = ref(false);

export const editActive = () => Boolean(edit.value);
export const editChanged = () => Boolean(edit.value && edit.value.changed);

/* 宿主（EditOverlay.vue）装进来的两个动作：都必须在组件 setup 的上下文里做 */
let hostRefresh: (() => Promise<unknown>) | null = null;

export const useInlineEditHost = (hooks: { refresh: () => Promise<unknown> }) => {
  hostRefresh = hooks.refresh;
};

const doRefresh = async () => {
  if (hostRefresh) return await hostRefresh();
  return await bridgeRefresh();
};

const doInvalidate = () => {
  forgetLayers();
};

/* ------------------------------------------------------------ 小工具 */

export const EDIT_LABEL: Record<EditKind, string> = {
  body: '编辑正文',
  text: '编辑这段文字',
  name: '编辑板块名',
  title: '编辑文章标题',
};

/* 板块页那两行是纯文本，但换行有意义（原生导语里就有 <br>）：
   读的时候只留 <br>，其余标签拍平；写回去的也是这个形状。 */
export const textWithBreaks = (el: HTMLElement): string => {
  const clone = el.cloneNode(true) as HTMLElement;
  for (const node of Array.from(clone.querySelectorAll('*'))) {
    if (String(node.tagName).toLowerCase() === 'br') continue;
    while (node.firstChild) node.parentNode?.insertBefore(node.firstChild, node);
    node.remove();
  }
  return clone.innerHTML
    .replace(/\s+/g, ' ')
    .replace(/(?:\s*<br\s*\/?>\s*)+/gi, '<br>')
    .trim();
};

/* 单行的那几样（板块名 / 文章标题）只认一行纯文本：把空白拍平 */
export const oneLine = (el: HTMLElement | null): string => String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------ 光标与选区 */

/* 点哪儿改哪儿：把光标放在点击的那个字符旁边。认不出点在哪就落到末尾。 */
export const placeCaret = (el: HTMLElement, x: number, y: number) => {
  let range: Range | null = null;
  try {
    const doc = document as any;
    if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(x, y);
    else if (doc.caretPositionFromPoint) {
      const pos = doc.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
      }
    }
  } catch {
    range = null;
  }
  if (!range || !range.startContainer || !el.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false); /* 认不出点在哪：光标落到末尾 */
  }
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
};

/* execCommand 是过时的 API，但它仍然是「带撤销栈的行内格式」唯一现成的做法，
   旧站用的就是它。要标签（<u>/<b>），不要行内 style。 */
export const execCmd = (cmd: string, value?: string) => {
  try {
    document.execCommand('styleWithCSS', false, false as any);
    document.execCommand(cmd, false, value);
  } catch {
    /* 浏览器不认这个命令就算了，不砸场子 */
  }
};

/* 选区盖到的那些「块」（正文的直接子元素）；光标时就是它所在的那一块 */
const touchedBlocks = (el: HTMLElement): HTMLElement[] => {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  const out: HTMLElement[] = [];
  for (const child of Array.from(el.children)) {
    if (range.intersectsNode(child)) out.push(child as HTMLElement);
  }
  if (out.length) return out;
  let node: Node | null = range.startContainer;
  if (node && node.nodeType === 3) node = node.parentNode;
  while (node && node.parentNode && node.parentNode !== el) node = node.parentNode;
  return node && node.parentNode === el ? [node as HTMLElement] : [];
};

/* 换标签（p ⇄ h2 ⇄ h3）自己做，不走 execCommand：
   它一换标签就把选区弄丢，之后再问「选区盖到了哪几段」会把整篇都算进来，
   于是「这一行是注释」的 class 会被邻居顺手摘掉。自己换，属性、子节点、类全在手里。 */
const RETAGGABLE = /^(p|h[1-6]|div|blockquote)$/i;

const retag = (el: HTMLElement, tag: string): HTMLElement => {
  if (String(el.tagName).toLowerCase() === tag) return el;
  const next = document.createElement(tag);
  for (const attr of Array.from(el.attributes)) next.setAttribute(attr.name, attr.value);
  while (el.firstChild) next.appendChild(el.firstChild);
  el.parentNode?.replaceChild(next, el);
  return next;
};

/* 四档字号：一级（h2）/ 二级（h3）/ 正文（p）/ 注释（p.prose-note + 小字） */
export const setBlock = (tag: string, note: boolean) => {
  const session = edit.value;
  if (!session) return;
  const blocks = touchedBlocks(session.el);
  if (!blocks.length) return;
  let first: HTMLElement | null = null;
  for (const block of blocks) {
    /* 列表 / 引用 / 代码块不动标签，只跟着变字号那一档 */
    const next = RETAGGABLE.test(block.tagName) ? retag(block, tag) : block;
    if (note) next.classList.add('prose-note');
    else next.classList.remove('prose-note');
    if (!first) first = next;
  }
  if (!first) return;
  const range = document.createRange();
  range.selectNodeContents(first);
  range.collapse(false);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
};

/* 下划线：先让浏览器落成 <u>，再把选区盖到的那几个 <u> 染上颜色。
   存的是 var(--miku) / var(--cuer)，所以换配色、切夜间它都跟着走
   （服务端的 sanitizeHtml 只留 text-decoration-color 这一条行内样式）。 */
export const underline = (color: string) => {
  const session = edit.value;
  if (!session) return;
  execCmd('underline');
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  for (const u of Array.from(session.el.querySelectorAll('u'))) {
    if (range.intersectsNode(u)) (u as HTMLElement).style.setProperty('text-decoration-color', color);
  }
};

/* emoji 面板：一格常用的，点一个插到光标处（走 execCommand('insertText')，
   所以撤销栈与光标都正常）。面板就挂在工具条里，跟着一起折行。 */
export const EMOJI_PICKER = [
  '😄', '😁', '😂', '🤣', '😊', '😍', '😘', '😎',
  '🤔', '🙄', '😴', '🥺', '😭', '😱', '😤', '🤯',
  '👍', '👎', '👌', '✌️', '🙏', '👏', '🙌', '🤝',
  '💪', '👀', '🧠', '✍️', '❤️', '💔', '💖', '✨',
  '🔥', '⭐', '🎉', '🎁', '🏆', '✅', '❌', '⚠️',
  '💡', '📌', '📝', '📚', '💻', '🐛', '🔧', '🔍',
  '🎵', '🎧', '🎸', '🎹', '🎬', '📷', '🎨', '🎮',
  '☕', '🍰', '🍜', '🍣', '🌸', '🍀', '🌙', '☁️',
  '🚀', '✈️', '🚲', '🏠', '🐱', '🐼', '🦊', '🐳',
];

export const insertAtCaret = (text: string) => {
  const session = edit.value;
  if (!session) return;
  session.el.focus();
  const sel = window.getSelection();
  const inside = sel && sel.rangeCount && session.el.contains(sel.getRangeAt(0).startContainer);
  if (!inside && sel) {
    const range = document.createRange();
    range.selectNodeContents(session.el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  let done = false;
  try {
    done = document.execCommand('insertText', false, text);
  } catch {
    done = false;
  }
  if (!done) {
    const now = window.getSelection();
    if (now && now.rangeCount) {
      const node = document.createTextNode(text);
      now.getRangeAt(0).insertNode(node);
      now.getRangeAt(0).setStartAfter(node);
      now.getRangeAt(0).collapse(true);
    } else {
      session.el.appendChild(document.createTextNode(text));
    }
  }
  markChanged();
};

export const toggleEmoji = () => {
  emojiOpen.value = !emojiOpen.value;
};

/* ------------------------------------------------------------ 工具条的位置 */
/* 工具条贴着命令栏往下挂。命令栏是 sticky 的，位置随滚动变（顶上还有「每日一句」
   那一条会滚走），所以不能写死——每次开、每次滚都按它的实际底边算一次。 */
export const placeBar = () => {
  if (!edit.value) return;
  const bar = document.querySelector('.bar');
  const y = bar ? Math.round(bar.getBoundingClientRect().bottom + 10) : 10;
  barTop.value = Math.max(10, y);
};

const onScroll = () => placeBar();
const onResize = () => placeBar();

const listenBar = () => {
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);
};

const unlistenBar = () => {
  window.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', onResize);
};

/* ------------------------------------------------------------ 开与关 */

const markChanged = () => {
  if (edit.value) edit.value.changed = true;
};

/* startEdit(kind, target, info, point)
   kind：'body'（正文）/ 'text'（板块的简介或导语）/ 'name'（板块名）/ 'title'（文章标题）
   target 里带身份（{id, field} 或 {slug}），el 是要编辑的那个节点。
   point 是光标该落在哪儿（右键菜单传来指针的位置；全局编辑模式传来点击的位置；
   都不给就落在开头）。全局编辑模式（useEditMode）也走这一个入口——两条路，一套机器。 */
export const startEdit = (kind: EditKind, target: EditTarget, info: any = {}, point?: { x: number; y: number }) => {
  if (edit.value) return;
  const el = target.el as HTMLElement | null;
  if (!el) return;

  edit.value = {
    kind,
    el,
    target,
    info: info || {},
    before: el.innerHTML,
    beforeText: kind === 'text' ? textWithBreaks(el) : el.textContent || '',
    changed: false,
    saving: false,
  };
  emojiOpen.value = false;

  el.setAttribute('contenteditable', 'true');
  el.setAttribute('spellcheck', 'false');
  document.documentElement.setAttribute('data-editing', kind);
  el.focus();
  placeCaret(el, point?.x ?? 0, point?.y ?? 0);
  el.addEventListener('input', markChanged);
  document.addEventListener('keydown', onEditKey, true);
  listenBar();
  placeBar();
};

/* 收尾。restore = true 就把内容放回编辑前那一份 */
const stopEdit = (restore: boolean) => {
  const session = edit.value;
  if (!session) return;
  const { el, kind, target } = session;

  el.removeEventListener('input', markChanged);
  document.removeEventListener('keydown', onEditKey, true);
  if (restore) el.innerHTML = session.before;
  el.removeAttribute('contenteditable');
  el.removeAttribute('spellcheck');
  document.documentElement.removeAttribute('data-editing');
  unlistenBar();
  emojiOpen.value = false;
  edit.value = null;

  /* 全局编辑模式（useEditMode）靠这一声把「＋ 新建」的占位补回来：
     取消了一次新建，或者存完之后空位已经填上了，两边都要重新看一眼 */
  document.dispatchEvent(new CustomEvent('cv01:edit-ended', { detail: { kind, target } }));
};

const onEditKey = (e: KeyboardEvent) => {
  if (!edit.value) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    cancelEdit();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    e.stopPropagation();
    saveEdit();
  }
};

/* 取消：改过东西先问一句「放弃这次修改？」，没改过就直接放回去 */
export const cancelEdit = () => {
  const session = edit.value;
  if (!session) return;
  if (!session.changed) {
    stopEdit(true);
    return;
  }
  askDialog({
    title: '放弃这次修改？',
    hint: '改的东西还没保存——放弃就回到原来的样子。',
    ok: '放弃',
  }).then((yes) => {
    if (yes === null) return;
    stopEdit(true);
    bridgeToast('没保存，改回去了');
  });
};

/* ------------------------------------------------------------ 请求 */

const patchSection = (id: string, body: any) =>
  withOwnerKey(`/api/sections/${encodeURIComponent(id)}`, { method: 'PATCH', body });

const patchPost = (key: string, body: any) =>
  withOwnerKey(`/api/articles/${encodeURIComponent(key)}`, { method: 'PATCH', body });

/* 一篇文章住在哪一层：提示条与工具条要靠它说得准 */
const whereOf = (info: any) => (info && info.runtime ? 'data/articles.json' : 'data/overrides.json（源文件没动）');

/* ------------------------------------------------------------ 保存 */

export const saveEdit = async () => {
  const session = edit.value;
  if (!session || session.saving) return;
  const { kind, target, info, el, before, beforeText } = session;

  let request: Promise<any>;
  let where: string;

  if (kind === 'text') {
    /* 板块页那两行是纯文本（换行用 <br> 带着），存回 data/sections.json */
    const text = textWithBreaks(el);
    if (!text) {
      bridgeToast('这一段不能空着', true);
      return;
    }
    if (text === String(beforeText || '').trim()) {
      stopEdit(true);
      return;
    }
    request = patchSection(String(target.id), { [String(target.field)]: text });
    where = 'data/sections.json';
  } else if (kind === 'name') {
    /* 板块名：改的是显示名，音高、地址、文章都不动 */
    const name = oneLine(el);
    if (!name) {
      bridgeToast('名字不能空着', true);
      return;
    }
    if (name === String(beforeText || '').trim()) {
      stopEdit(true);
      return;
    }
    request = patchSection(String(target.id), { name });
    where = 'data/sections.json';
  } else if (kind === 'title') {
    /* 文章标题：同样是显示名，地址不动 */
    const title = oneLine(el);
    if (!title) {
      bridgeToast('标题不能空着', true);
      return;
    }
    if (title === String(beforeText || '').trim()) {
      stopEdit(true);
      return;
    }
    request = patchPost(String(target.slug), { title });
    where = whereOf(info);
  } else {
    request = patchPost(String(target.slug), { body: el.innerHTML });
    where = whereOf(info);
  }

  session.saving = true;
  try {
    await bridgeWithKey(() => request);
  } catch (err) {
    session.saving = false;
    bridgeError(err);
    return;
  }

  const name = kind === 'name' ? oneLine(el) : '';
  const title = kind === 'title' ? oneLine(el) : '';
  const savedHtml = el.innerHTML;

  stopEdit(false);
  doInvalidate();
  /* 存盘成功了：提示条立刻说话，整站内容在后台重取（旧站是先说话，
     再让 sections.js 把那几处 DOM 改掉——顺序一样，只是这里不用改 DOM）。
     重取失败不该把「已存好」这句吞掉。 */
  void doRefresh().catch((err) => bridgeError(err));
  if (kind === 'name') paintSectionName(String(target.id), name);
  if (kind === 'title') paintPostTitle(String(target.slug), title);

  /* 探针与调试想知道「这一次是往哪一层存的」 */
  editReport.push({ kind, where, target: { id: target.id || '', slug: target.slug || '', field: target.field || '' } });

  bridgeToast(`改好了，存进了 ${where}`, false, {
    label: '撤销',
    run: () => {
      const back =
        kind === 'text'
          ? patchSection(String(target.id), { [String(target.field)]: beforeText })
          : kind === 'name'
            ? patchSection(String(target.id), { name: String(beforeText || '').trim() })
            : kind === 'title'
              ? patchPost(String(target.slug), { title: String(beforeText || '').trim() })
              : patchPost(String(target.slug), { body: before });
      bridgeWithKey(() => back)
        .then(async () => {
          doInvalidate();
          await doRefresh();
          if (kind === 'title') paintPostTitle(String(target.slug), String(beforeText || '').trim());
          void savedHtml;
          bridgeToast('改回来了，刷新一下就看到');
          window.setTimeout(() => window.location.reload(), 700);
        })
        .catch((err) => bridgeError(err));
    },
  });
};

/* ------------------------------------------------------------ 恢复成源文件里的正文
   把上一次「页面上改的正文」撤掉，回到 content/posts.mjs（或 Markdown 源）里的那一份。
   运行时文章也走这一条：body: false 把 articles.json 里那份富文本删掉，
   正文回到它的 Markdown 源。 */
export const restoreBody = (target: EditTarget, post: any) => {
  askDialog({
    title: '恢复成源文件里的正文？',
    hint: post?.runtime
      ? '这一篇是编辑页写的：正文会回到 data/articles.json 里那份 Markdown 渲染出来的样子。'
      : '这一篇在 content/posts.mjs 里：页面上改的那一版会从 data/overrides.json 里删掉，回到源文件的正文。',
    ok: '恢复',
  })
    .then(async (yes) => {
      if (yes === null) return;
      await bridgeWithKey(() => patchPost(String(target.slug), { body: false }));
      doInvalidate();
      await doRefresh();
      bridgeToast('恢复了，刷新一下就看到');
      window.setTimeout(() => window.location.reload(), 700);
    })
    .catch((err) => bridgeError(err));
};

/* ------------------------------------------------------------ 把改动画回页面上
   旧站 studio.js 的 paintSection / paintPost 那一套「就地改 DOM」，是为了让烤进
   HTML 的静态页当场跟上。在这里内容的真相是共享状态，上面已经喊过 refreshSite()；
   这两条只多管一件事：**当前这一页**（轨道栏、索引、卷帘、文章行、文章页大标题）
   立刻就更新，不用等那份 tracks 走完一次重渲染——旧站 sections.js 干的就是这件事。
   DOM 里的地址都是干净路由（个别的还带 .html 尾巴），所以一律按后缀认。 */
export const paintSectionName = (id: string, name: string) => {
  if (!name) return;
  const tail = `/sections/${encodeURIComponent(id)}`;
  const matches = (href: string | null) => String(href || '').indexOf(tail) > -1;
  for (const node of Array.from(document.querySelectorAll('a.key .key__name'))) {
    const a = node.closest('a.key');
    if (a && matches(a.getAttribute('href'))) node.textContent = name;
  }
  for (const node of Array.from(document.querySelectorAll('.roll .head .head__name'))) {
    const head = node.closest('.head');
    if (head && matches(head.getAttribute('href'))) node.textContent = name;
  }
  for (const li of Array.from(document.querySelectorAll('.entry'))) {
    const a = li.querySelector('.entry__name a');
    if (a && matches(a.getAttribute('href'))) a.textContent = name;
  }
};

export const paintPostTitle = (slug: string, title: string) => {
  if (!title) return;
  const tail = `/posts/${encodeURIComponent(slug)}`;
  const matches = (href: string | null) => String(href || '').indexOf(tail) > -1;
  for (const node of Array.from(document.querySelectorAll('.post-row__link .post-row__title'))) {
    const a = node.closest('.post-row__link');
    if (a && matches(a.getAttribute('href'))) node.textContent = title;
  }
  for (const node of Array.from(document.querySelectorAll('.roll a.note'))) {
    if (!matches(node.getAttribute('href'))) continue;
    node.setAttribute('data-title', title);
    node.setAttribute(
      'aria-label',
      `${title}（${node.getAttribute('data-pitch') || ''}，${node.getAttribute('data-min') || ''} 分钟）`
    );
  }
};

/* ------------------------------------------------------------ 对外 */

/* 工具条（RteToolbar.vue）要读的那几样 */
export const useInlineEdit = () => {
  return {
    edit,
    barTop,
    emojiOpen,
    label: computed(() => (edit.value ? EDIT_LABEL[edit.value.kind] : '')),
    kind: computed(() => edit.value?.kind || ''),
    changed: computed(() => Boolean(edit.value && edit.value.changed)),
    actions: {
      setBlock,
      execCmd,
      underline,
      insertAtCaret,
      toggleEmoji,
      saveEdit,
      cancelEdit,
      markChanged,
    },
  };
};
