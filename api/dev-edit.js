// 改题：在 /dev 直接修改题目文字、答案、配图，不必到 GitHub 找 JSON 档。
//   target = 'pending'：改待审区里的题（还没采纳）
//   target = 'bank'   ：改已经上线的题（学生看得到，存档後自动部署）
//     action = 'hide' / 'unhide'：下架／恢复。题目留在原位、加上 hidden，学生端不显示。
//     不真的删掉：学生的进度、错题、笔记都按「第几题」记，删掉一题，後面每一题的纪录都会对到别题。
//     action = 'clearExplain'：清掉这一题（选择题）全班共用的 AI 讲解，下一个问的人会拿到新的。
//     action = 'move'：把下架的题移到同一科的另一章（toChapterId）。接在那一章最後面、仍是下架；
//     原位留一个标了 moved_to 的隐藏空位 —— 两边原有的题号都不变，学生的纪录才不会错位。
// 两种都跟采纳一样用 toBankEntry 验证，改完是坏的就不让存。
// GET：直接从 GitHub 读最新的三科题库与待审区。网站上的 /papers 要等 Vercel 部署完（约一分钟）
// 才会更新，工作台若读那份，刚存的修改会「消失」一下，接著再改就会撞到「题库被改过」。
const { publishingConfig, verifySession, sendJson, readJsonBody, sameOrigin } = require('./_lib/devauth');
const { snapshot, readJson, commitFiles, sendError } = require('./_lib/github');
const {
  SUBJECTS, PENDING_PATH, bankPath, InputError, normalize, stemOf, toBankEntry, applyPatch, decodeImage,
} = require('./_lib/questions');
const { clearExplain } = require('./_lib/ai');

module.exports = async (req, res) => {
  if (!verifySession(req)) {
    return sendJson(res, 401, { ok: false, error: 'unauthenticated', message: '请先登录开发者工作台' });
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'GET, POST' });
  }
  if (req.method === 'POST' && !sameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: 'bad_origin' });
  }
  const pub = publishingConfig();
  if (!pub.token) {
    return sendJson(res, 501, {
      ok: false, error: 'publishing_not_configured', message: '尚未配置一键发布：请在 Vercel 环境变数里加入 GITHUB_TOKEN。',
    });
  }

  if (req.method === 'GET') {
    try {
      const snap = await snapshot(pub);
      const [pending, ...banks] = await Promise.all(
        [PENDING_PATH, ...SUBJECTS.map(bankPath)].map(p => readJson(pub, snap, p)));
      return sendJson(res, 200, {
        ok: true,
        pending: pending || { items: [] },
        banks: Object.fromEntries(SUBJECTS.map((s, i) => [s, banks[i] || { sections: [] }])),
      });
    } catch (err) {
      return sendError(res, err, 'dev-edit GET');
    }
  }

  try {
    const body = await readJsonBody(req);
    const snap = await snapshot(pub);
    const writes = [];

    // 套上修改、处理配图、验证；回传改好的题
    function edit(item, subject, imageName) {
      const edited = applyPatch(item, body.patch);
      if (body.image) {
        const image = decodeImage(subject, imageName, body.image);
        edited.image = image.ref;
        writes.push({ path: image.path, base64: image.base64 });
      }
      toBankEntry(edited);
      return edited;
    }

    if (body.target === 'pending') {
      const pending = await readJson(pub, snap, PENDING_PATH);
      const items = pending && Array.isArray(pending.items) ? pending.items : [];
      const idx = items.findIndex(it => it.id === body.id);
      if (idx < 0) throw new InputError('待审区里找不到这一题（可能已经被采纳或退回），请重新整理。');
      const item = items[idx];
      items[idx] = { ...edit(item, item.subject, item.id), edited_at: new Date().toISOString() };
      writes.push({ path: PENDING_PATH, json: pending });
      await commitFiles(pub, snap, writes, `✏️ 修改待审题目 ${item.id}`);
      return sendJson(res, 200, { ok: true, item: items[idx] });
    }

    if (body.target === 'bank') {
      const subject = SUBJECTS.includes(body.subject) ? body.subject : null;
      if (!subject) throw new InputError('科目不明。');
      const type = body.type === 'subjective' ? 'subjective' : 'mcq';
      const bank = await readJson(pub, snap, bankPath(subject));
      const section = bank && Array.isArray(bank.sections) && bank.sections.find(s => s.id === body.chapterId);
      const list = section && (type === 'subjective' ? section.subjectives : section.mcqs);
      const current = Array.isArray(list) ? list[body.index] : null;
      // 用题干核对是不是同一题：页面打开之後题库若被改过，索引可能已经指到别题
      if (!current || normalize(stemOf(current)) !== normalize(body.expect)) {
        throw new InputError('题库在你打开之後被改过，请按「重新整理」再改。');
      }
      const label = `${section.title || section.id} ${type === 'subjective' ? '做答题' : '选择题'}第 ${body.index + 1} 题`;
      // 移走後留在原位的空位：恢复或再改，同一题就会出现在两章
      if (current.moved_to) throw new InputError('这题已经移到别章了，请到那边改。');
      if (body.action === 'move') {
        if (!current.hidden) throw new InputError('只能移动已下架的题：先按「下架」。');
        const dest = bank.sections.find(s => s.id === body.toChapterId);
        if (!dest || dest === section) throw new InputError('请选另一个章节。');
        const destList = type === 'subjective' ? (dest.subjectives = dest.subjectives || []) : (dest.mcqs = dest.mcqs || []);
        const moved = { ...current, hidden: true, hidden_at: new Date().toISOString(), moved_from: { chapterId: section.id, index: body.index } };
        destList.push(moved);
        const to = { chapterId: dest.id, index: destList.length - 1 };
        list[body.index] = { ...current, moved_to: to };
        writes.push({ path: bankPath(subject), json: bank });
        await commitFiles(pub, snap, writes,
          `↪️ 移动 ${subject} 题库：${label} → ${dest.title || dest.id} 第 ${to.index + 1} 题（仍下架）`);
        return sendJson(res, 200, { ok: true, item: list[body.index], moved, to });
      }
      if (body.action === 'clearExplain') {
        if (type !== 'mcq') throw new InputError('只有选择题有 AI 讲解。');
        const n = await clearExplain(subject, section.id, body.index, current);
        if (n === null) throw new InputError('没有设定 Upstash，AI 讲解没有共用快取，不用清。');
        return sendJson(res, 200, { ok: true, cleared: n });
      }
      if (body.action === 'hide' || body.action === 'unhide') {
        const hide = body.action === 'hide';
        const changed = { ...current };
        if (hide) { changed.hidden = true; changed.hidden_at = new Date().toISOString(); }
        else { delete changed.hidden; delete changed.hidden_at; }
        list[body.index] = changed;
        writes.push({ path: bankPath(subject), json: bank });
        await commitFiles(pub, snap, writes, `${hide ? '🙈 下架' : '↩️ 恢复'} ${subject} 题库：${label}`);
        return sendJson(res, 200, { ok: true, item: changed });
      }
      const edited = edit({ ...current, type }, subject, `${section.id}_${type}${body.index}`);
      delete edited.type;
      const key = normalize(stemOf(edited));
      // 移走後的空位和移过去的那题题干一样，不算重复
      const clash = bank.sections.some(s => ((type === 'subjective' ? s.subjectives : s.mcqs) || [])
        .some(x => x !== current && !x.moved_to && normalize(stemOf(x)) === key));
      if (clash) throw new InputError('改完的题干和题库里另一题一模一样。');
      list[body.index] = edited;
      writes.push({ path: bankPath(subject), json: bank });
      await commitFiles(pub, snap, writes, `✏️ 修改 ${subject} 题库：${section.title || section.id}`);
      return sendJson(res, 200, { ok: true, item: edited });
    }

    throw new InputError('不知道要改哪里的题。');
  } catch (err) {
    return sendError(res, err, 'dev-edit');
  }
};
