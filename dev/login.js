/* 开发者登录页 */
(function () {
  const form = document.getElementById('loginForm');
  const userInput = document.getElementById('username');
  const passInput = document.getElementById('password');
  const submitBtn = document.getElementById('submitBtn');
  const message = document.getElementById('formMessage');
  const capsHint = document.getElementById('capsHint');
  const shine = document.getElementById('shine');

  document.getElementById('backLink').prepend(icon('arrowLeft'));
  document.getElementById('userWrap').prepend(icon('user'));
  document.getElementById('passWrap').prepend(icon('lock'));

  const toggle = el('button', {
    class: 'trailing-btn',
    type: 'button',
    attrs: { 'aria-label': '显示密码', 'aria-pressed': 'false' },
    onclick: () => {
      const show = passInput.type === 'password';
      passInput.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(show));
      toggle.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
      clear(toggle).appendChild(icon(show ? 'eyeOff' : 'eye'));
      passInput.focus();
    },
  }, icon('eye'));
  document.getElementById('passWrap').appendChild(toggle);

  passInput.addEventListener('keyup', (e) => {
    if (typeof e.getModifierState === 'function') capsHint.hidden = !e.getModifierState('CapsLock');
  });

  function showError(text) {
    clear(message).appendChild(el('div', { class: 'form-error' }, icon('alert'), el('span', { text })));
  }

  const STATUS_TEXT = {
    ok: { mark: '✅', tip: '已读取到' },
    missing: { mark: '❌', tip: '没有读取到' },
    short: { mark: '⚠️', tip: '太短了' },
  };

  // setup 由 /api/dev-session 与 /api/dev-login 回传：只说明每个变量「有没有」，
  // 不会回传内容。把它直接画成自查清单，省得盲猜是哪一项没配好。
  function showSetupNote(setup) {
    const note = el('div', { class: 'form-note' });
    note.appendChild(el('div', { text: '开发者登录尚未启用。服务器现在读到的状态：' }));

    const rows = el('div', { style: 'margin-top:8px; display:flex; flex-direction:column; gap:4px;' });
    const vars = [
      ['DEV_USERNAME', '登录账号'],
      ['DEV_PASSWORD', '登录密码（建议 12 位以上）'],
      ['DEV_SESSION_SECRET', `随机字符串，至少 ${(setup && setup.minSecretLength) || 16} 位`],
    ];
    vars.forEach(([name, desc]) => {
      const state = (setup && setup[name]) || 'missing';
      const s = STATUS_TEXT[state] || STATUS_TEXT.missing;
      rows.appendChild(el('span', {}, `${s.mark} `, el('code', { text: name }), `　${s.tip} · ${desc}`));
    });
    note.appendChild(rows);

    note.appendChild(el('div', { style: 'margin-top:10px; line-height:1.7;' },
      el('strong', { text: '最常见的两个原因：' }),
      el('div', { text: '① 变量加错地方了。这三项要加在 Vercel 项目的 Settings → Environment Variables（勾选 Production），而不是 GitHub 仓库的 Secrets——GitHub Secrets 只给 Actions 用，网站读不到。' }),
      el('div', { text: '② 加了但没重新部署。到 Vercel 的 Deployments → 最新那次 → ⋯ → Redeploy，环境变量才会生效。' })));
    clear(message).appendChild(note);
  }

  function setLoading(loading) {
    submitBtn.disabled = loading;
    clear(submitBtn);
    if (loading) appendChildren(submitBtn, [el('span', { class: 'spinner' }), '验证中…']);
    else submitBtn.textContent = '登录';
  }

  function shake() {
    shine.classList.remove('shake');
    void shine.offsetWidth;
    shine.classList.add('shake');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clear(message);
    const username = userInput.value.trim();
    const password = passInput.value;
    if (!username || !password) {
      showError('请输入账号和密码');
      shake();
      (username ? passInput : userInput).focus();
      return;
    }

    setLoading(true);
    const { ok, status, data } = await api('/api/dev-login', { method: 'POST', body: { username, password } });
    setLoading(false);

    if (ok) {
      submitBtn.textContent = '登录成功，正在进入…';
      submitBtn.disabled = true;
      window.location.replace('/dev/');
      return;
    }
    if (status === 503 && data.error === 'not_configured') {
      showSetupNote(data.setup);
      return;
    }
    showError(data.message || (status === 0 ? '无法连接服务器' : `登录失败（${status}）`));
    shake();
    passInput.value = '';
    passInput.focus();
  });

  // 已经登录过就直接进工作台；顺便提前提示「尚未配置」
  api('/api/dev-session').then(({ ok, data, status }) => {
    if (ok && data.authenticated) {
      window.location.replace('/dev/');
    } else if (ok && data.configured === false) {
      showSetupNote(data.setup);
    } else if (!ok && status === 0) {
      showError('无法连接登录服务，请检查网络。');
    }
  });

  userInput.focus();
})();
