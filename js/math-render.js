// 数学公式排版：题目、选项、解析、AI 讲解里用 $…$ 包住的 LaTeX，交给 KaTeX 排成公式。
// 做题、章节测验、模拟统考、错题本、笔记、题目档、/dev 都是动态画出来的，不在每个地方各叫一次，
// 而是看着整页：新画上去的内容带 $…$ 就排。
// KaTeX（vendor/katex/，约 600KB）等画面第一次出现 $…$ 才载入：没有公式的画面不会载到（生物、化学、物理的题多半只用 H₂O、m/s² 这类符号，不用 $…$）。
// 载入失败（离线又没快取过）就维持原本的 $…$ 文字，题目照样能做；恢复连线後下一次有公式再试。
(function () {
  const KATEX_DIR = '/vendor/katex/';
  const HAS_MATH = /\$[^$]+\$/;
  const OPTIONS = {
    delimiters: [{ left: '$', right: '$', display: false }],
    throwOnError: false,          // 写错的公式显示成红字原文，不会整题不见
    ignoredClasses: ['katex'],    // 已经排好的不再看
    // 分数、积分、Σ 照试卷排成全尺寸（行内预设会缩成小字，手机上看不清）；指数、上下限仍自动缩小
    preProcess: tex => '\\displaystyle ' + tex,
  };
  // 公式字比内文大一点就好（KaTeX 预设 1.21em，夹在中文里太抢）。
  // 网站有一条 * { font-family: "Noto Sans SC" … } 会盖掉 KaTeX 的字型（≠ 这类符号变方块），这里改回继承
  const KATEX_TUNING = '.katex{font-size:1.1em}.katex *{font-family:inherit}';
  let loading = null;
  let failed = false;

  function addScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('载入失败：' + src));
      document.head.appendChild(s);
    });
  }

  function loadKatex() {
    if (!loading) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = KATEX_DIR + 'katex-swap.min.css';
      const tuning = document.createElement('style');
      tuning.textContent = KATEX_TUNING;
      document.head.append(css, tuning);
      loading = addScript(KATEX_DIR + 'katex.min.js')
        .then(() => addScript(KATEX_DIR + 'contrib/auto-render.min.js'))
        .catch(e => { failed = true; css.remove(); tuning.remove(); throw e; });
    }
    return loading;
  }
  window.addEventListener('online', () => { if (failed) { failed = false; loading = null; } });

  // 只看画面上的字：网页内嵌程式码里的 `${…}` 不算公式（auto-render 也跳过这些标签）
  const SKIP_TAGS = new Set(['SCRIPT', 'NOSCRIPT', 'STYLE', 'TEXTAREA', 'PRE', 'CODE', 'OPTION']);
  function hasMath(root) {
    if (root.nodeType === 3) return HAS_MATH.test(root.data);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (SKIP_TAGS.has(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (HAS_MATH.test(n.data)) return true;
    return false;
  }

  // 可以 await：题目档的 PDF 要等公式排好、字型载完才截图
  async function renderMath(root) {
    if (!root || !hasMath(root)) return;
    try { await loadKatex(); } catch (e) { return; }
    window.renderMathInElement(root, OPTIONS);
    if (document.fonts && document.fonts.load) {
      await Promise.all(['1em KaTeX_Main', 'italic 1em KaTeX_Math'].map(f => document.fonts.load(f).catch(() => null)));
    }
  }
  window.renderMath = renderMath;

  const queue = new Set();
  function flush() {
    const roots = [...queue];
    queue.clear();
    roots.forEach(el => {
      if (el.isConnected && !roots.some(other => other !== el && other.contains(el))) renderMath(el);
    });
  }
  new MutationObserver(records => {
    const before = queue.size;
    records.forEach(r => r.addedNodes.forEach(n => {
      const el = n.nodeType === 1 ? n : n.parentElement;
      if (el && (n.textContent || '').includes('$') && !el.closest('.katex')) queue.add(el);
    }));
    if (queue.size && !before) queueMicrotask(flush);
  }).observe(document.body, { childList: true, subtree: true });

  renderMath(document.body);
})();
