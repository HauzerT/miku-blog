/* ==========================================================================
   owner.js · 站长工具箱（右下角那颗钥匙球）
   ---------------------------------------------------------------------------
   只有输入过口令的浏览器能开（studio.js 在开之前会先验一次）。
   里面三件事：
     · 新建板块 / 子板块   → 交给 sections.js 的那套表单
     · 上传音乐盒的音乐     → 交给 music.js 抽出来的上传面板
     · 快速写一篇博客       → 跳到独立的编辑页 editor.html（整页跳，不走局部刷新）

   每个子面板顶上有一条「← 工具箱」，点一下回到三选一的菜单。
   ========================================================================== */
(function () {
  'use strict';

  var doc = document;
  var cv01 = (window.cv01 = window.cv01 || {});
  var host = null;

  function menu() {
    host.innerHTML = '' +
      '<div class="ow">' +
      '  <div class="ow__head">' +
      '    <p class="ow__eyebrow">站长工具箱</p>' +
      '    <p class="ow__hint">这里的东西都要写文件，所以只有输入过口令的浏览器进得来。音乐盒和站点本身对谁都一样。</p>' +
      '  </div>' +
      '  <button class="ow__item" type="button" data-go="section">' +
      '    <b>新建板块 / 子板块</b><span>给它一个音高，它就接进卷帘</span></button>' +
      '  <button class="ow__item" type="button" data-go="music">' +
      '    <b>上传音乐盒的音乐</b><span>mp3 / m4a，传完立刻进曲库</span></button>' +
      '  <a class="ow__item" href="' + (cv01.base || '') + 'editor.html" data-no-spa>' +
      '    <b>快速写一篇博客</b><span>跳去编辑页：图片、视频、音乐都能带</span></a>' +
      '</div>';

    host.querySelector('[data-go="section"]').addEventListener('click', function () {
      open('新建板块', function (target) { cv01.sections.open(target); });
    });
    host.querySelector('[data-go="music"]').addEventListener('click', function () {
      open('上传音乐', function (target) { cv01.music.uploadPanel(target); });
    });
  }

  function open(title, render) {
    host.innerHTML = '';
    var bar = doc.createElement('div');
    bar.className = 'ow__bar';
    bar.innerHTML = '<button class="ow__back" type="button">← 工具箱</button>' +
      '<span class="ow__title">' + title + '</span>';
    host.appendChild(bar);
    bar.querySelector('.ow__back').addEventListener('click', function () {
      menu();
      if (cv01.focusPanel) cv01.focusPanel();
    });
    render(host);
  }

  cv01.owner = {
    open: function (target) {
      host = target;
      menu();
    },
  };
})();
