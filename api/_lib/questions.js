// 题目资料的共用规则：审题（dev-approve）与改题（dev-edit）都用这一套，
// 才不会出现「待审区改得过、进了题库却是坏的」这种两边标准不一的情况。

const SUBJECTS = ['biology', 'chemistry', 'physics'];
const PENDING_PATH = 'papers/pending_approval.json';
const bankPath = subject => `papers/${subject}_question_bank.json`;

class InputError extends Error {}

const normalize = t =>
  String(t || '').replace(/\s+/g, '').trim();

const stemOf = item => (item && (item.q || item.question)) || '';

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

  // 检查选项经过 normalize 后是否重复（先去掉「A.」前缀，不然四个选项永远不一样）
  const normalizedOptions = options.map(o => normalize(o.replace(/^[A-D][.．]\s*/, '')));

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

// /dev 编辑器送来的修改：只收这几个栏位，其余一律忽略
const IMAGE_PATH = /^\.\/images\/(biology|chemistry|physics)\/[\w.-]+\.(png|jpe?g|webp)$/;

function applyPatch(item, patch) {
  const out = { ...item };
  const p = patch && typeof patch === 'object' ? patch : {};
  const text = v => String(v == null ? '' : v).trim();

  if (item.type === 'subjective') {
    if ('question' in p) out.question = text(p.question);
    if ('answer' in p) out.answer = text(p.answer);
    return out;
  }

  if ('q' in p) out.q = text(p.q);
  if ('explanation' in p) out.explanation = text(p.explanation);
  if ('options' in p) {
    if (!Array.isArray(p.options)) throw new InputError('选项格式不对。');
    out.options = p.options.map(text);
  }
  if ('answer' in p) out.answer = Number(p.answer);
  if ('image' in p) {
    const img = text(p.image);
    if (!img) delete out.image;
    else if (IMAGE_PATH.test(img)) out.image = img;
    else throw new InputError('配图路径不对。');
  }
  return out;
}

// 上传的配图：浏览器端已经缩成 1600px 以内，这里只挡格式与大小
const IMAGE_TYPES = {
  'image/png': { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  'image/jpeg': { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  'image/webp': { ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },
};
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function decodeImage(subject, name, dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new InputError('配图只收 PNG、JPG、WebP。');
  const type = IMAGE_TYPES[m[1]];
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) throw new InputError('配图超过 2MB，请裁小一点再上传。');
  if (!type.magic.every((b, i) => bytes[i] === b)) throw new InputError('配图档案内容和格式对不上。');
  const safe = String(name).replace(/[^\w-]/g, '').slice(0, 40) || 'img';
  const path = `images/${subject}/${safe}_${Date.now().toString(36)}.${type.ext}`;
  return { path, base64: m[2], ref: `./${path}` };
}

module.exports = {
  SUBJECTS, PENDING_PATH, bankPath, InputError, normalize, stemOf, toBankEntry, applyPatch, decodeImage,
};
