<script setup>
/* ==========================================================================
   门厅（/login）· 两颗键
   ---------------------------------------------------------------------------
   访客那颗键是普通链接：没有 JS 也进得去，而且永远不会问口令。它指向
   `<目标>?enter=1`，服务看到就盖一枚三十天的章再把人送进去——所以
   「不许跳过门厅」这件事不靠脚本，靠服务。

   站长那颗键展开一行口令，交给 POST /api/auth 核对；核对通过服务同样盖章，
   页面这边再把口令记进 localStorage 的 cv01-key —— 与站长工具箱、右键菜单、
   编辑页用的是同一把钥匙，所以进门之后那些地方不会再问第二次。

   `?next=` 是「本来要去的那一页」（被门厅拦下来的），两颗键都把它带上。
   逻辑与旧的 assets/js/login.js 一一对应。
   ========================================================================== */
definePageMeta({ layout: 'gate' })

const route = useRoute()
const tracks = useTracks()
const { key, read, write, forget } = useOwnerKey()

const KEY_HINT = '口令印在启动服务的那个终端窗口里。';
const FILE_TIP =
  '这一页是用 file:// 打开的：口令要问本机的上传服务。双击 start.cmd 把它起来，再开 http://127.0.0.1:4321/login。';
const WAIT = 6000; /* 服务不在时别让人干等 */

/* 一排音高名：与左侧轨道栏、首页卷帘是同一份数据。不指路，只说明这是谁的门 */
const pitches = computed(() => (tracks.value || []).map((t) => t.pitch).slice().reverse());

/* 被门厅拦下来的那一页。只认本站路径，免得 ?next=//evil 把人带去别处 */
const NEXT = computed(() => {
  const raw = String(route.query.next || '');
  return !raw || raw[0] !== '/' || raw.slice(0, 2) === '//' ? '/' : raw;
});

/* 站在门厅里的人本来就是想去哪儿就回哪儿去：两颗键都带上 ?enter=1 */
const visitorHref = computed(() => NEXT.value + (NEXT.value.includes('?') ? '&' : '?') + 'enter=1');

const open = ref(false);
const typed = ref('');
const inputEl = ref(null);
const message = ref('');
const bad = ref(false);
const doorStamped = ref(false);
const hasKey = computed(() => Boolean(key.value));

/* 青地上只有黑字读得动，所以「错」不靠颜色，靠一块黑板 */
const say = (text, isBad = false) => {
  message.value = text || '';
  bad.value = Boolean(isBad);
};

const show = (next) => {
  open.value = next;
  if (next) {
    setTimeout(() => inputEl.value?.focus(), 30);
  } else {
    typed.value = '';
    say('');
  }
};

/* 把口令交给浏览器自己的密码库（如果它愿意收）：加密落盘、随账号同步、
   解锁交给系统。32 位的随机串本来就不该由人去背，也不该只躺在 localStorage。
   Firefox 没有这套 API 就跳过，它靠输入框的 autocomplete 自己提示保存。 */
const remember = (value) => {
  try {
    if (window.PasswordCredential && navigator.credentials && navigator.credentials.store) {
      const cred = new window.PasswordCredential({ id: 'cv01-owner', name: 'CV01 站长', password: value });
      navigator.credentials.store(cred).catch(() => {});
    }
  } catch {
    /* 浏览器拒绝就不存 */
  }
};

/* 进不去的时候把原因说清楚：是没跑服务、还是口令不对 */
const reason = (err, status) => {
  if (import.meta.client && window.location.protocol === 'file:') return FILE_TIP;
  if (err?.name === 'AbortError') return '上传服务没有回应。它跑着吗？' + KEY_HINT;
  if (!status) return '没连上上传服务。双击 start.cmd 把它起来，' + KEY_HINT;
  const fromServer = typeof err?.data?.error === 'string' ? err.data.error : '';
  return fromServer || err?.message || '没进去。' + KEY_HINT;
};

const enter = async () => {
  const value = typed.value.trim();
  if (!value) {
    say('先填口令。' + KEY_HINT, true);
    inputEl.value?.focus();
    return;
  }
  say('');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), WAIT);
  try {
    await $fetch('/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cv01-key': value },
      body: {},
      signal: ctl.signal,
    });
    clearTimeout(timer);
    write(value);
    remember(value);
    /* 口令过了，服务那边已经盖了门厅那枚章，这一跳直接去本来要去的地方。
       给浏览器的「保存口令」留一小拍：store() 是异步的，立刻跳走会把
       第一次保存掐死在半路。 */
    setTimeout(() => {
      window.location.href = NEXT.value;
    }, 250);
  } catch (err) {
    clearTimeout(timer);
    const status = err?.statusCode || err?.status;
    /* 试的是记着的那把钥匙却吃了 401 / 403：口令换过了，旧账当场作废 */
    if ((status === 401 || status === 403) && value === read()) forget();
    say(reason(err, status), true);
    await nextTick();
    inputEl.value?.select();
  }
};

/* 这台浏览器记着口令就把填表这一步省掉：预填进去、直接试一次门 */
const tryRemembered = () => {
  const saved = read();
  if (!saved) return false;
  typed.value = saved;
  enter();
  return true;
};

const onOwner = () => {
  const opening = !open.value;
  show(opening);
  /* 展开的那一下就试门：记着口令的话一击直接进 */
  if (opening) tryRemembered();
};

/* 访客那颗键：先降级再进门。身份就是「这台浏览器里有没有那把口令」，
   不这么做的话，之前输过口令的浏览器点了访客照样带着站长权限进门。 */
const onVisitor = () => {
  forget();
};

onMounted(() => {
  doorStamped.value = /(?:^|;\s*)cv01-enter=/.test(document.cookie || '');
  /* 地址栏写 #owner 就直接停在口令那一行——站长可以把它存成书签 */
  if (window.location.hash === '#owner') {
    show(true);
    tryRemembered();
  }
  if (open.value) return;
  const onKey = (event) => {
    if (event.key === 'Escape' && open.value) show(false);
  };
  window.addEventListener('keydown', onKey);
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
});

useHead({
  title: '进门 · 初音ミク CV01',
  meta: [{ name: 'description', content: '进站：访客直接进，站长要口令。口令印在启动服务的那个终端窗口里。' }],
});
</script>

<template>
  <main class="gate">
    <header class="gate__head">
      <p class="gate__mark">初音ミク <span>CV01</span></p>
    </header>

    <div class="gate__body">
      <div class="gate__panel">
        <h1 class="gate__title">进门</h1>
        <p class="gate__note">访客直接进。站长要口令，它印在启动服务的终端里。</p>

        <div class="gate__keys">
          <!-- 普通链接，不是客户端路由：盖章那件事必须由服务做，没有 JS 也成立 -->
          <a class="gate-key gate-key--visitor" :href="visitorHref" data-visitor @click="onVisitor">访客进入</a>
          <button
            class="gate-key gate-key--owner"
            type="button"
            data-owner
            :aria-expanded="open ? 'true' : 'false'"
            aria-controls="gate-pass"
            @click="onOwner"
          >站长登录</button>
        </div>

        <form class="gate__pass" id="gate-pass" data-pass novalidate :hidden="!open" @submit.prevent="enter">
          <label class="gate__label" for="gate-input">口令</label>
          <input
            id="gate-input"
            ref="inputEl"
            v-model="typed"
            class="gate__input"
            data-pass-input
            type="password"
            inputmode="latin"
            name="passphrase"
            autocomplete="current-password"
            spellcheck="false"
            enterkeyhint="go"
            placeholder="例如 3f9a1c02"
            :aria-invalid="bad ? 'true' : undefined"
          >
          <button class="gate-key gate-key--owner gate-key--go" type="submit">进入</button>
        </form>

        <p class="gate__msg" :class="{ 'gate__msg--bad': bad }" :hidden="!message" data-msg role="status" aria-live="polite">{{ message }}</p>

        <p v-if="hasKey" class="gate__status" data-status>
          这台浏览器是<strong>站长</strong>身份（记着口令）：点「站长登录」会直接进门，进站后右键能改名、撤下、改字。按「访客进入」会把这把口令忘掉。<button class="gate__forget" type="button" data-forget @click="forget">现在就忘掉</button>
        </p>

        <!-- 门厅这道门盖的章（三十天）。已经盖过的人，这里给一条重新上锁的路 -->
        <p v-if="doorStamped" class="gate__status" data-door>
          这台浏览器已经进过门，三十天内不再问。<a class="gate__forget" href="/login?leave=1">锁上门</a>
        </p>
      </div>
    </div>

    <footer class="gate__foot" aria-hidden="true">
      <span v-for="pitch in pitches" :key="pitch">{{ pitch }}</span>
    </footer>
  </main>
</template>
