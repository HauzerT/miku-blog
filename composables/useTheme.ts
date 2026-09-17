/* ==========================================================================
   composables/useTheme.ts · 夜间调声
   ---------------------------------------------------------------------------
   主题本身在首帧之前就由 nuxt.config.ts 内联的 BOOT 决定好了（避免闪烁），
   这里只管按钮：文案、aria、切换、记住，
   以及切完把地址栏颜色重算一遍（算式在 assets/js/palette.js 里）。
   ========================================================================== */
export const useTheme = () => {
  const dark = ref(false);
  const narrow = ref(false);
  /* hidden 到挂载后才解开——没有 JS 就不摆一颗按不动的按钮 */
  const ready = ref(false);

  const label = computed(() =>
    dark.value ? (narrow.value ? '日间' : '日间调声') : narrow.value ? '夜间' : '夜间调声'
  );
  const ariaLabel = computed(() =>
    dark.value ? '切换到日间调声（浅色）' : '切换到夜间调声（深色）'
  );

  /* 地址栏颜色跟着配色走：palette.js 知道现在是哪一轮、哪一态，喊它一声就行。
     它没加载上就退回读 --paper 的实际值——总之不在这里写死颜色。 */
  const paintChrome = () => {
    if (!import.meta.client) return;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    const palette = window.cv01Palette;
    if (palette) return void palette.chrome();
    const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
    if (paper) meta.setAttribute('content', paper);
  };

  const toggle = () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.classList.add('is-theming');
    root.setAttribute('data-theme', next);
    try {
      localStorage.setItem('cv01-theme', next);
    } catch {
      /* 隐私模式：忽略 */
    }
    setTimeout(() => root.classList.remove('is-theming'), 220);
    dark.value = next === 'dark';
    paintChrome();
  };

  onMounted(() => {
    const root = document.documentElement;
    dark.value = root.getAttribute('data-theme') === 'dark';
    ready.value = true;
    paintChrome();
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 720px)');
    narrow.value = mq.matches;
    /* 窄屏上和音效按钮一起挤，标签收短 */
    mq.addEventListener('change', () => {
      narrow.value = mq.matches;
    });
  });

  return { dark, ready, label, ariaLabel, toggle };
};
