// 审题：把待审区（papers/pending_approval.json）里的题目采纳进正式题库，或直接退回。
// 这是整条流水线最後一哩 —— 在此之前，AI 产出的题目永远到不了学生手上。
const { publishingConfig, verifySession, sendJson, readJsonBody, sameOrigin } = require('./_lib/devauth');

const PENDING_PATH = 'papers/pending_approval.json';
const SUBJECTS = ['biology', 'chemistry', 'physics'];
const bankPath = subject => `papers/${subject}_question_bank.json`;

class InputError extends Error {}

class GitHubError extends Error {
  constructor(status, detail) {
    super(`GitHub API ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'uec-science-dev-console',
  };
}

async function readFile(pub, filePath) {
  const url = `https://api.github.com/repos/${pub.repo}/contents/${filePath}?ref=${encodeURIComponent(pub.branch)}`;
  const res = await fetch(url, { headers: ghHeaders(pub.token) });

  if (res.status === 404) {
    return { sha: null, json: null };
  }

  if (!res.ok) {
    throw new GitHubError(res.status, await res.text());
  }

  const data = await res.json();

  try {
    return {
      sha: data.sha,
      json: JSON.parse(
        Buffer.from(data.content || '', 'base64').toString('utf8')
      ),
    };
  } catch (e) {
    throw new InputError(
      `${filePath} 不是合法的 JSON，请先修好再采纳。`
    );
  }
}

async function writeFile(pub, filePath, json, sha, message) {
  const res = await fetch(
    `https://api.github.com/repos/${pub.repo}/contents/${filePath}`,
    {
      method: 'PUT',
      headers: {
        ...ghHeaders(pub.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        content: Buffer.from(
          JSON.stringify(json, null, 2) + '\n',
          'utf8'
        ).toString('base64'),
        branch: pub.branch,
        ...(sha ? { sha } : {}),
      }),
    }
  );

  if (!res.ok) {
    throw new GitHubError(res.status, await res.text());
  }
}

const normalize = t =>
  String(t || '').replace(/\s+/g, '').trim();

// 只挑认得的栏位写进题库。
// 待审区里的其余栏位（flags、来源、时间戳等）不带进正式资料。
function toBankEntry(item) {
  // =========================
  // 主观题
  // =========================
  if (item.type === 'subjective') {
    const question = String(item.question || '').trim();
    const answer = String(item.answer || '').trim();

    if (!question) {
      throw new InputError('这题没有题干，不能采纳。');
    }

    if (!answer) {
      throw new InputError('主观题没有答案，不能采纳。');
    }

    return {
      question,
      answer,
    };
  }

  // =========================
  // 选择题
  // =========================
  const q = String(item.q || '').trim();

  const options = Array.isArray(item.options)
    ? item.options.map(o => String(o).trim())
    : [];

  if (!q) {
    throw new InputError('这题没有题干，不能采纳。');
  }

  if (options.length !== 4) {
    throw new InputError('选项不是 4 个，不能采纳。');
  }

  if (options.some(o => !o)) {
    throw new InputError('有选项是空白的，不能采纳。');
  }

  // 检查选项经过 normalize 后是否重复
  const normalizedOptions = options.map(normalize);

  if (new Set(normalizedOptions).size !== 4) {
    throw new InputError('选择题存在重复选项，不能采纳。');
  }

  if (
    !Number.isInteger(item.answer) ||
    item.answer < 0 ||
    item.answer > 3
  ) {
    throw new InputError(
      '答案序号不在 0–3 之间，不能采纳。'
    );
  }

  const entry = {
    q,
    options,
    answer: item.answer,
    explanation: String(item.explanation || '').trim(),
  };

  if (item.image) {
    entry.image = String(item.image);
  }

  return entry;
}

module.exports = async (req, res) => {
  // =========================
  // 登录验证
  // =========================
  if (!verifySession(req)) {
    return sendJson(res, 401, {
      ok: false,
      error: 'unauthenticated',
      message: '请先登录开发者工作台',
    });
  }

  if (req.method !== 'POST') {
    return sendJson(
      res,
      405,
      {
        ok: false,
        error: 'method_not_allowed',
      },
      {
        Allow: 'POST',
      }
    );
  }

  if (!sameOrigin(req)) {
    return sendJson(res, 403, {
      ok: false,
      error: 'bad_origin',
    });
  }

  // =========================
  // GitHub 发布配置
  // =========================
  const pub = publishingConfig();

  if (!pub.token) {
    return sendJson(res, 501, {
      ok: false,
      error: 'publishing_not_configured',
      message:
        '尚未配置一键发布：请在 Vercel 环境变数里加入 GITHUB_TOKEN。',
    });
  }

  try {
    const body = await readJsonBody(req);

    const action =
      body.action === 'reject'
        ? 'reject'
        : 'adopt';

    // =========================
    // 读取待审区
    // =========================
    const pending = await readFile(
      pub,
      PENDING_PATH
    );

    const items =
      pending.json &&
      Array.isArray(pending.json.items)
        ? pending.json.items
        : [];

    if (!items.length) {
      throw new InputError('待审区目前是空的。');
    }

    // =========================
    // 取得本次请求要处理的题目
    // =========================
    const requested =
      action === 'adopt'
        ? Array.isArray(body.items)
          ? body.items
          : []
        : Array.isArray(body.ids)
          ? body.ids.map(id => ({ id }))
          : [];

    if (!requested.length) {
      throw new InputError(
        '没有指定要处理的题目。'
      );
    }

    // =========================
    // 建立 ID 索引
    // =========================
    const byId = new Map(
      items.map(it => [it.id, it])
    );

    const handled = [];
    const handledSet = new Set();

    const skipped = [];
    const skippedSet = new Set();

    function markHandled(id) {
      if (!handledSet.has(id)) {
        handledSet.add(id);
        handled.push(id);
      }
    }

    function markSkipped(id, why) {
      if (!skippedSet.has(id)) {
        skippedSet.add(id);
        skipped.push({
          id,
          why,
        });
      }
    }

    // ============================================================
    // 采纳题目
    // ============================================================
    if (action === 'adopt') {
      // ----------------------------------------------------------
      // 同一次请求中，同一个 ID 只处理一次
      // ----------------------------------------------------------
      const uniqueRequested = [];
      const requestedIds = new Set();

      for (const ask of requested) {
        if (requestedIds.has(ask.id)) {
          continue;
        }

        requestedIds.add(ask.id);
        uniqueRequested.push(ask);
      }

      // ----------------------------------------------------------
      // 按科目分组
      // 每个科目的题库只读取 / 写入一次
      // ----------------------------------------------------------
      const groups = new Map();

      for (const ask of uniqueRequested) {
        const item = byId.get(ask.id);

        if (!item) {
          markSkipped(
            ask.id,
            '待审区里找不到这一题'
          );
          continue;
        }

        const subject = SUBJECTS.includes(
          item.subject
        )
          ? item.subject
          : null;

        if (!subject) {
          markSkipped(
            ask.id,
            '科目不明'
          );
          continue;
        }

        if (!groups.has(subject)) {
          groups.set(subject, []);
        }

        groups.get(subject).push({
          item,
          chapterId: String(
            ask.chapterId ||
            item.chapter_id ||
            ''
          ),
        });
      }

      // ----------------------------------------------------------
      // 逐科目处理
      // ----------------------------------------------------------
      for (const [subject, rows] of groups) {
        const bank = await readFile(
          pub,
          bankPath(subject)
        );

        if (
          !bank.json ||
          !Array.isArray(bank.json.sections)
        ) {
          rows.forEach(r =>
            markSkipped(
              r.item.id,
              `${subject} 的题库读不到或格式不对`
            )
          );

          continue;
        }

        const sections = bank.json.sections;
        let changed = 0;

        // --------------------------------------------------------
        // 逐题处理
        // --------------------------------------------------------
        for (const {
          item,
          chapterId,
        } of rows) {
          // 找目标章节
          const section = sections.find(
            s => s.id === chapterId
          );

          if (!section) {
            markSkipped(
              item.id,
              '找不到对应章节，请先在下拉选单指定'
            );
            continue;
          }

          // ------------------------------------------------------
          // 数据验证
          // ------------------------------------------------------
          let entry;

          try {
            entry = toBankEntry(item);
          } catch (e) {
            markSkipped(
              item.id,
              e.message
            );
            continue;
          }

          // ------------------------------------------------------
          // 取得目标题型列表
          // ------------------------------------------------------
          const list =
            item.type === 'subjective'
              ? (section.subjectives =
                  section.subjectives || [])
              : (section.mcqs =
                  section.mcqs || []);

          // ------------------------------------------------------
          // 题干标准化
          // ------------------------------------------------------
          const key = normalize(
            entry.q || entry.question
          );

          // ------------------------------------------------------
          // 目标章节已经存在相同题目
          //
          // 这是幂等情况：
          // 说明之前可能已经成功写入题库，
          // 但 pending 区没有及时移除。
          // 因此可以安全地从 pending 移除。
          // ------------------------------------------------------
          if (
            list.some(
              x =>
                normalize(
                  x.q || x.question
                ) === key
            )
          ) {
            markHandled(item.id);
            continue;
          }

          // ------------------------------------------------------
          // 检查其他章节是否已经有相同题目
          //
          // 不能因为管理员选择了错误章节，
          // 就把同一道题复制到多个章节。
          //
          // 与目标章节重复：
          //   → 幂等成功
          //
          // 与其他章节重复：
          //   → 跳过
          //   → 保留 pending
          //   → 让管理员人工决定章节归属
          // ------------------------------------------------------
          const duplicateElsewhere =
            sections.some(s => {
              if (s.id === section.id) {
                return false;
              }

              const otherList =
                item.type === 'subjective'
                  ? Array.isArray(
                      s.subjectives
                    )
                    ? s.subjectives
                    : []
                  : Array.isArray(s.mcqs)
                    ? s.mcqs
                    : [];

              return otherList.some(
                x =>
                  normalize(
                    x.q || x.question
                  ) === key
              );
            });

          if (duplicateElsewhere) {
            markSkipped(
              item.id,
              '正式题库其他章节已有相同题干，请人工确认章节归属'
            );
            continue;
          }

          // ------------------------------------------------------
          // 再检查一次目标列表
          //
          // 防止同一批次中不同 pending ID
          // 带着完全相同的题目进入同一章节。
          // ------------------------------------------------------
          if (
            list.some(
              x =>
                normalize(
                  x.q || x.question
                ) === key
            )
          ) {
            markHandled(item.id);
            continue;
          }

          // ------------------------------------------------------
          // 正式写入
          // ------------------------------------------------------
          list.push(entry);

          markHandled(item.id);
          changed += 1;
        }

        // --------------------------------------------------------
        // 该科目有新增题目才写回 GitHub
        // --------------------------------------------------------
        if (changed) {
          await writeFile(
            pub,
            bankPath(subject),
            bank.json,
            bank.sha,
            `📥 采纳 ${changed} 道题目进 ${subject} 题库`
          );
        }
      }
    } else {
      // ==========================================================
      // 退回题目
      // ==========================================================
      const uniqueIds = new Set();

      requested.forEach(ask => {
        if (uniqueIds.has(ask.id)) {
          return;
        }

        uniqueIds.add(ask.id);

        if (byId.has(ask.id)) {
          markHandled(ask.id);
        } else {
          markSkipped(
            ask.id,
            '待审区里找不到这一题'
          );
        }
      });
    }

    // ============================================================
    // 从 pending 区移除已经处理成功的题目
    // ============================================================
    if (handled.length) {
      // 题库先写、待审区后写。
      //
      // 如果待审区这一步失败：
      //   题目会继续留在 pending。
      //
      // 下一次再次采纳时：
      //   目标章节的去重逻辑会避免重复写入。
      const keep = items.filter(
        it => !handledSet.has(it.id)
      );

      await writeFile(
        pub,
        PENDING_PATH,
        {
          ...pending.json,
          items: keep,
        },
        pending.sha,
        action === 'adopt'
          ? `✅ 待审区移除已采纳的 ${handled.length} 题`
          : `🗑️ 退回 ${handled.length} 道待审题目`
      );
    }

    // ============================================================
    // 返回结果
    // ============================================================
    return sendJson(res, 200, {
      ok: true,
      action,
      handled: handled.length,
      skipped,
    });
  } catch (err) {
    // ==========================================================
    // 输入错误
    // ==========================================================
    if (err instanceof InputError) {
      return sendJson(res, 400, {
        ok: false,
        error: 'bad_request',
        message: err.message,
      });
    }

    // ==========================================================
    // GitHub API 错误
    // ==========================================================
    if (err instanceof GitHubError) {
      const map = {
        401: 'GITHUB_TOKEN 无效或已过期，请重新产生。',
        403: 'GITHUB_TOKEN 权限不足：需要对该仓库的 Contents「Read and write」权限。',
        404: '找不到仓库或档案（检查 GITHUB_REPO）。',
        409: '档案刚被别处改动，请重试一次。',
        422: '档案刚被别处改动，请重试一次。',
      };

      return sendJson(res, 502, {
        ok: false,
        error: 'github_error',
        message:
          map[err.status] ||
          `GitHub 返回错误（${err.status}）。`,
      });
    }

    // ==========================================================
    // 未知服务器错误
    // ==========================================================
    console.error(
      'dev-approve failed:',
      err
    );

    return sendJson(res, 500, {
      ok: false,
      error: 'server_error',
      message:
        '服务器处理失败，请稍后再试。',
    });
  }
};
