/* ==========================================================================
   composables/useContextMenu.ts · 右键菜单（旧站 studio.js 的「右键：改名 / 撤下」）
   ---------------------------------------------------------------------------
   只有站长看得到这个菜单：浏览器里存着口令（门厅存的，或第一次上传时输入的），
   而且服务认这把口令。访客右键 = 浏览器自己那一套，这里一个字都不拦。

   菜单挂在三种地方，做的事其实只有两件：
     板块（轨道栏 / 首页索引 / 卷帘的轨道头）→ 重命名 · 删除
     文章（板块页与归档的文章行 / 卷帘上的音符 / 文章页的标题正文）→ 重命名 · 删除
   站点里有两层东西，菜单对它们说的话不一样：
     界面建的（data/*.json）——真的删，连它带的图片视频音乐一起删；
     content/posts.mjs 里原生的那批——只「撤下」：服务在 data/overrides.json
     里记一笔，源文件一个字节不动，随时能放回来（提示条上的「撤销」就干这个）。

   为什么是**文档级**一个 contextmenu 监听器：要按的轨道栏板块名、文章行标题、
   首页索引、卷帘音符散在各个页面组件里（那些组件不归这一条工作流管），
   所以只认页面上的 class 与 data- 钩子，不去动每一个组件——旧站也是这么做的。

   键盘一样能用：Tab 到那一项上按 Shift+F10（或菜单键）。手机上是长按。
   ========================================================================== */
import { bridgeError, bridgeRefresh, bridgeToast, bridgeWithKey } from './useEditBridge';
import { forgetLayers, layersFor, verifyOnce } from './useArticleLayers';
import { paintPostTitle, paintSectionName } from './useInlineEdit';
import { pageSectionId, pageSlug, sectionIdOf, slugOf } from './usePageRoutes';

export type MenuTarget = {
  kind: 'section' | 'post' | 'body' | 'text';
  el: HTMLElement;
  id?: string;
  slug?: string;
  field?: 'def' | 'lede';
};

export type MenuItem = { label: string; danger?: boolean; run: () => void };

/* 菜单要摆的东西进 state；DOM 节点与函数进模块变量（payload 要序列化）。
   实际上这个菜单只在浏览器里被写，服务端渲染时永远是初值。 */
export const menuState = reactive({
  on: false,
  x: 0,
  y: 0,
  label: '板块',
  items: [] as { label: string; danger: boolean }[],
});

let menuTarget: MenuTarget | null = null;
let menuOwner: HTMLElement | null = null;
let menuAt = { x: 0, y: 0 };
let handlers: (() => void)[] = [];

/* 触摸屏：长按也算右键。长按抬手时浏览器还会补一次 click（可能就跳走了），
   那一次要吃掉——与旧站同一条。 */
let longPress: number | null = null;
let ateClick = false;

/* ------------------------------------------------------------ 右键点到了什么 */

/* 认不出就不弹（正文之外的空白都归浏览器） */
export const targetOf = (node: EventTarget | null): MenuTarget | null => {
  const el = node as HTMLElement | null;
  if (!el || !el.closest) return null;

  const key = el.closest('a.key');
  if (key && key.closest('.rail')) {
    return { kind: 'section', id: sectionIdOf(key.getAttribute('href') || ''), el: key as HTMLElement };
  }

  const entry = el.closest('.entry');
  if (entry) {
    const a = entry.querySelector('.entry__name a');
    if (a) return { kind: 'section', id: sectionIdOf(a.getAttribute('href') || ''), el: entry as HTMLElement };
  }

  const head = el.closest('.roll .head');
  if (head) return { kind: 'section', id: sectionIdOf(head.getAttribute('href') || ''), el: head as HTMLElement };

  /* 文章页：正文（点哪儿改哪儿）、标题 */
  const prose = el.closest('.prose');
  if (prose) {
    const slug = pageSlug();
    if (slug) return { kind: 'body', slug, el: prose as HTMLElement };
  }
  const title = el.closest('.article__title');
  if (title) {
    const slug = pageSlug();
    if (slug) return { kind: 'post', slug, el: title as HTMLElement };
  }

  /* 板块页上的两段文字：导语与简介 */
  const lede = el.closest('.lede');
  if (lede) {
    const id = pageSectionId();
    if (id) return { kind: 'text', id, field: 'lede', el: lede as HTMLElement };
  }
  const def = el.closest('.sect-head__def');
  if (def) {
    const id = pageSectionId();
    if (id) return { kind: 'text', id, field: 'def', el: def as HTMLElement };
  }
  const h1 = el.closest('.sect-head__name');
  if (h1) {
    const id = pageSectionId();
    if (id) return { kind: 'section', id, el: h1 as HTMLElement };
  }

  /* 文章列表里的行 / 卷帘上的音符 */
  const row = el.closest('.post-row');
  if (row) {
    const link = row.querySelector('.post-row__link');
    if (link) return { kind: 'post', slug: slugOf(link.getAttribute('href') || ''), el: row as HTMLElement };
  }
  const note = el.closest('.roll a.note');
  if (note) return { kind: 'post', slug: slugOf(note.getAttribute('href') || ''), el: note as HTMLElement };

  return null;
};

/* ------------------------------------------------------------ 菜单本身 */

export const closeMenu = (back = false) => {
  if (!menuState.on) return;
  const owner = menuOwner;
  menuState.on = false;
  menuState.items = [];
  menuTarget = null;
  menuOwner = null;
  if (back && owner && owner.focus) owner.focus();
};

const openMenu = (target: MenuTarget, x: number, y: number, items: MenuItem[]) => {
  closeMenu(false);
  if (!items.length) return;
  menuTarget = target;
  menuOwner = target.el;
  menuAt = { x, y };
  menuState.label = target.kind === 'section' ? '板块' : '文章';
  menuState.items = items.map((item) => ({ label: item.label, danger: Boolean(item.danger) }));
  runs = items.map((item) => item.run);
  /* 菜单先摆到屏幕外量尺寸，再贴着指针摆好——不许出界（旧站同一条）。
     这一段等下一次渲染之后再量：那时 Vue 已经把菜单按 -9999px 摆好了。 */
  menuState.x = -9999;
  menuState.y = -9999;
  menuState.on = true;
  nextTick(() => {
    const box = document.querySelector('.ctx') as HTMLElement | null;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    menuState.x = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    menuState.y = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    if (!window.matchMedia('(hover: none)').matches) {
      const first = box.querySelector('.ctx__item') as HTMLElement | null;
      first?.focus();
    }
  });
};

/* 菜单项上的动作要在这里留一份（state 里进不去函数）。
   map 的键就是它在菜单里的序号。 */
let runs: (() => void)[] = [];

/* ------------------------------------------------------------ 菜单里有哪几条 */

const dropLabel = (native: boolean) => (native ? '撤下' : '删除');

const itemsFor = (target: MenuTarget, map: any): MenuItem[] => {
  runs = [];

  if (target.kind === 'body') {
    const post = map.posts[target.slug as string] || { slug: target.slug, title: '这一篇', runtime: false };
    const out: MenuItem[] = [
      {
        label: '编辑正文…',
        run: () => {
          void import('./useInlineEdit').then((m) => m.startEdit('body', target, post, menuAt));
        },
      },
    ];
    if (post.body) {
      out.push({
        label: '恢复成源文件里的正文…',
        run: () => {
          void import('./useInlineEdit').then((m) => m.restoreBody(target, post));
        },
      });
    }
    out.push({
      label: `${dropLabel(!post.runtime)}这篇文章…`,
      danger: true,
      run: () => dropPost(target, post),
    });
    return out;
  }

  if (target.kind === 'text') {
    return [
      {
        label: target.field === 'lede' ? '编辑这段导语…' : '编辑这段简介…',
        run: () => {
          void import('./useInlineEdit').then((m) => m.startEdit('text', target, {}, menuAt));
        },
      },
    ];
  }

  if (target.kind === 'section') {
    const info = map.sections[target.id as string];
    if (!info) return [];
    return [
      { label: '重命名板块…', run: () => renameSection(target, info) },
      { label: `${dropLabel(info.seed)}这个板块…`, danger: true, run: () => dropSection(target, info) },
    ];
  }

  const post = map.posts[target.slug as string];
  if (!post) return [];
  return [
    { label: '重命名文章…', run: () => renamePost(target, post) },
    { label: `${dropLabel(!post.runtime)}这篇文章…`, danger: true, run: () => dropPost(target, post) },
  ];
};

/* 菜单项被点：先收菜单，再做事 */
export const runMenuItem = (index: number) => {
  const run = runs[index];
  closeMenu(false);
  if (run) run();
};

/* ------------------------------------------------------------ 四件事
   每一件都走 withKey：没口令 / 口令过期时，服务回 401，它会先把口令问来
   再重放一次。菜单本来就只对「浏览器里有口令」的人开，这里是第二道——
   身份、口令、服务端校验，三道都过才写得进去。 */
const patchSection = (id: string, body: any) =>
  bridgeWithKey(() => withOwnerKey(`/api/sections/${encodeURIComponent(id)}`, { method: 'PATCH', body }));

const patchPost = (key: string, body: any) =>
  bridgeWithKey(() => withOwnerKey(`/api/articles/${encodeURIComponent(key)}`, { method: 'PATCH', body }));

const dropSectionReq = (id: string) =>
  bridgeWithKey(() => withOwnerKey(`/api/sections/${encodeURIComponent(id)}`, { method: 'DELETE' }));

const dropPostReq = (key: string) =>
  bridgeWithKey(() => withOwnerKey(`/api/articles/${encodeURIComponent(key)}`, { method: 'DELETE' }));

/* ------------------------------------------------------------ 把改动画回页面上
   旧站 studio.js 有一整套 paint/unpaint（就地改轨道栏、索引、卷帘、文章行），
   因为静态页把内容烤进了 HTML。在这里内容本来就是一份共享状态，重取一次就够
   （composables/useSite.ts 的 refreshSite）。下面这几条只收那些**共享状态照不到**
   的地方——认不出身份时的收尾，与旧站同名同义。 */

const hrefTail = (path: string) => `[href$="${path}"]`;

const each = (selector: string, fn: (el: Element) => void) => {
  for (const node of Array.from(document.querySelectorAll(selector))) fn(node);
};

const drop = (selector: string) => each(selector, (n) => n.remove());

const countTracks = () => {
  const CN_NUM = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];
  const rail = document.querySelector('.rail');
  const n = rail ? rail.querySelectorAll('a.key').length : 0;
  const label = rail && rail.querySelector('.rail__label');
  if (label) label.textContent = `轨道 · ${CN_NUM[n] || String(n)}个音`;
  const head = document.querySelector('.index-head p');
  if (head) head.textContent = (head.textContent || '').replace(/(·\s*)\d+(\s*轨)/, `$1${n}$2`);
};

export const unpaintSection = (id: string) => {
  const tail = hrefTail(`/sections/${encodeURIComponent(id)}`);
  drop(`.rail a.key${tail}`);
  each('.entry', (li) => {
    const a = li.querySelector('.entry__name a');
    if (a && String(a.getAttribute('href') || '').indexOf(`/sections/${id}`) > -1) li.remove();
  });
  drop(`.roll .head${tail}`);
  countTracks();
};

const countPosts = () => {
  const list = document.querySelector('main .post-list');
  const head = document.querySelector('.sect-head__pitch');
  if (list && head) {
    head.textContent = (head.textContent || '').replace(/(·\s*)\d+(\s*篇)/, `$1${list.querySelectorAll('.post-row').length}$2`);
  }
};

export const unpaintPost = (slug: string) => {
  const tail = hrefTail(`/posts/${encodeURIComponent(slug)}`);
  each('.post-row', (li) => {
    const a = li.querySelector('.post-row__link');
    if (a && String(a.getAttribute('href') || '').indexOf(`/posts/${slug}`) > -1) li.remove();
  });
  drop(`.roll a.note${tail}`);
  countPosts();
};

/* ------------------------------------------------------------ 改名 */

const renameSection = (target: MenuTarget, info: any) => {
  askDialog({
    title: '重命名板块',
    hint: `只改显示名。音高 ${info.pitch} 与地址都不动，文章也留在原处。`,
    value: info.name,
    ok: '改名',
    maxlength: 40,
  })
    .then(async (name) => {
      if (name === null) return;
      if (!name) {
        bridgeToast('名字不能空着', true);
        return;
      }
      await patchSection(String(target.id), { name });
      paintSectionName(String(target.id), name);
      forgetLayers();
      void bridgeRefresh().catch((err) => bridgeError(err));
      bridgeToast(`改好了：${info.name} → ${name}`);
    })
    .catch((err) => bridgeError(err));
};

const renamePost = (target: MenuTarget, post: any) => {
  askDialog({
    title: '重命名文章',
    hint: post.runtime
      ? '这篇是编辑页写的，改的是 data/articles.json 里的标题。'
      : '这篇在 content/posts.mjs 里：只改站点上显示的名字，源文件不动（改回来只要再改一次）。',
    value: post.title,
    ok: '改名',
    maxlength: 120,
  })
    .then(async (title) => {
      if (title === null) return;
      if (!title) {
        bridgeToast('标题不能空着', true);
        return;
      }
      await patchPost(String(target.slug), { title });
      paintPostTitle(String(target.slug), title);
      forgetLayers();
      void bridgeRefresh().catch((err) => bridgeError(err));
      bridgeToast(`改好了：${post.title} → ${title}`);
    })
    .catch((err) => bridgeError(err));
};

/* ------------------------------------------------------------ 撤下 / 删除 */

const dropSection = (target: MenuTarget, info: any) => {
  const native = Boolean(info.seed);
  askDialog({
    title: `${native ? '撤下' : '删除'}板块「${info.name}」？`,
    hint: native
      ? '它是 content/posts.mjs 里的原生板块（tools/build.mjs 生成的）。撤下之后站点上不再出现，源文件一个字节不动，随时能放回来。'
      : '它存在 data/sections.json 里，会真的删掉；用它写的文章，连同那些图片 / 视频 / 音乐，一起走。',
    ok: native ? '撤下' : '删除',
  })
    .then(async (yes) => {
      if (yes === null) return;
      const data: any = await dropSectionReq(String(target.id));
      unpaintSection(String(target.id));
      forgetLayers();
      void bridgeRefresh().catch((err) => bridgeError(err));
      if (data?.mode === 'hidden') {
        bridgeToast(`「${info.name}」撤下了——源文件没动`, false, {
          label: '撤销',
          run: () => {
            patchSection(String(target.id), { hidden: false })
              .then(async () => {
                forgetLayers();
                await bridgeRefresh();
                bridgeToast('放回来了，刷新一下就看到');
                window.setTimeout(() => window.location.reload(), 700);
              })
              .catch((err) => bridgeError(err));
          },
        });
      } else {
        bridgeToast(`「${info.name}」删掉了${data?.removedArticles ? `，连同 ${data.removedArticles} 篇文章` : ''}`);
      }
    })
    .catch((err) => bridgeError(err));
};

const dropPost = (target: MenuTarget, post: any) => {
  const native = !post.runtime;
  askDialog({
    title: `${native ? '撤下' : '删除'}文章「${post.title}」？`,
    hint: native
      ? '它在 content/posts.mjs 里。撤下之后站点上不再出现（那一页会回一句「已撤下」），源文件不动，随时能放回来。'
      : '它是编辑页写的，会从 data/articles.json 里真的删掉，连同它的图片 / 视频 / 音乐。',
    ok: native ? '撤下' : '删除',
  })
    .then(async (yes) => {
      if (yes === null) return;
      const data: any = await dropPostReq(String(target.slug));
      unpaintPost(String(target.slug));
      forgetLayers();
      void bridgeRefresh().catch((err) => bridgeError(err));
      if (data?.mode === 'hidden') {
        bridgeToast(`「${post.title}」撤下了——源文件没动`, false, {
          label: '撤销',
          run: () => {
            patchPost(String(target.slug), { hidden: false })
              .then(async () => {
                forgetLayers();
                await bridgeRefresh();
                bridgeToast('放回来了，刷新一下就看到');
                window.setTimeout(() => window.location.reload(), 700);
              })
              .catch((err) => bridgeError(err));
          },
        });
      } else {
        bridgeToast(`「${post.title}」删掉了`);
      }
    })
    .catch((err) => bridgeError(err));
};

/* ------------------------------------------------------------ 谁来喊菜单 */

/* 菜单住在一个组件里，但它要能在任何页面上被喊出来，所以这里只做「派发」：
   验一次口令 → 取两层名单 → 按身份摆菜单。 */
const menuFor = async (target: MenuTarget, x: number, y: number) => {
  try {
    await bridgeWithKey(() => verifyOnce());
    const map = await layersFor({ section: target.id, post: target.slug });
    openMenu(target, x, y, itemsFor(target, map));
  } catch (err) {
    bridgeError(err);
  }
};

const owner = () => {
  try {
    return Boolean(localStorage.getItem('cv01-key'));
  } catch {
    return false;
  }
};

/* 菜单在同一个 document 上只装一次 */
export const installContextMenu = (isOnline: () => boolean) => {
  const onContextMenu = (e: MouseEvent) => {
    const target = targetOf(e.target);
    if (!target) return;
    if (!isOnline() || !owner()) return; /* 没服务 / 没口令：这一页对访客照旧 */
    /* 认不出身份的（href 里没有 id / slug）不弹——旧站同一条 */
    if (target.kind === 'section' && !target.id) return;
    if ((target.kind === 'post' || target.kind === 'body') && !target.slug) return;
    e.preventDefault();
    void menuFor(target, e.clientX, e.clientY);
  };

  const onTouchStart = (e: TouchEvent) => {
    if (!isOnline() || !owner() || e.touches.length !== 1) return;
    const target = targetOf(e.target);
    if (!target) return;
    const t = e.touches[0];
    longPress = window.setTimeout(() => {
      longPress = null;
      ateClick = true;
      void menuFor(target, t.clientX, t.clientY);
    }, 550);
  };

  const stopLongPress = () => {
    if (longPress === null) return;
    window.clearTimeout(longPress);
    longPress = null;
  };

  /* 长按抬起手指时浏览器还会补一次 click（可能就跳走了）：吃掉它。
     必须 stopImmediatePropagation——同一个节点上还挂着「点外面就收起」那条，
     光 stopPropagation 拦不住它，菜单会在刚弹出来的下一秒被自己关掉。 */
  const onAteClick = (e: MouseEvent) => {
    if (!ateClick) return;
    ateClick = false;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  /* 点外面 / 滚动 / 改窗口大小：菜单收起 */
  const onDocClick = (e: MouseEvent) => {
    if (!menuState.on) return;
    const box = document.querySelector('.ctx');
    if (box && !box.contains(e.target as Node)) closeMenu(false);
  };
  const onScroll = () => closeMenu(false);
  const onResize = () => closeMenu(false);
  const onBlur = () => closeMenu(false);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!menuState.on) return;
    const items = Array.from(document.querySelectorAll('.ctx__item')) as HTMLElement[];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      /* 必须 stopImmediatePropagation：全局编辑模式那条「Esc 退出」的监听器
         挂在同一个 document 上，stopPropagation 拦不住同一节点上的其他监听器 */
      e.stopImmediatePropagation();
      closeMenu(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1 + items.length) % items.length]?.focus();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  };

  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  for (const name of ['touchend', 'touchmove', 'touchcancel']) {
    document.addEventListener(name, stopLongPress, { passive: true });
  }
  document.addEventListener('click', onAteClick, true);
  document.addEventListener('click', onDocClick, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('blur', onBlur);
  /* 菜单的 Esc 要在捕获阶段拿到——与它上面那条上下文一致 */
  document.addEventListener('keydown', onKeyDown, true);

  handlers = [
    () => document.removeEventListener('contextmenu', onContextMenu),
    () => document.removeEventListener('touchstart', onTouchStart),
    () => {
      for (const name of ['touchend', 'touchmove', 'touchcancel']) document.removeEventListener(name, stopLongPress);
    },
    () => document.removeEventListener('click', onAteClick, true),
    () => document.removeEventListener('click', onDocClick, true),
    () => window.removeEventListener('scroll', onScroll, true),
    () => window.removeEventListener('resize', onResize),
    () => window.removeEventListener('blur', onBlur),
    () => document.removeEventListener('keydown', onKeyDown, true),
  ];
};

export const uninstallContextMenu = () => {
  for (const off of handlers) off();
  handlers = [];
  closeMenu(false);
};

export const useContextMenu = () => ({ menuState, runMenuItem, closeMenu });
