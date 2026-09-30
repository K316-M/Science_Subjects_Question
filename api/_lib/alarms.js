// 统考闹钟的储存与排程（Upstash，与跨装置同步共用同一个资料库）
//   uec:push:vapid        伺服器推播身分（VAPID 钥匙），第一次用到时产生，之後不换
//   uec:alarm:dev:<杂凑>  一台装置的推播订阅与它设的闹钟；键名是订阅网址的杂凑，不含任何个人资料
//   uec:alarm:due         排程：每个闹钟「下一次该响的时间」，每分钟由 api/alarm-tick.js 取出到期的送出
//   uec:alarm:lastTick    最近一次每分钟检查的时间：网站据此判断定时器有没有在跑
const crypto = require('crypto');
const { command } = require('./store');
const { generateVapidKeys, sendPush } = require('./webpush');
const table = require('../../js/exam-timetable.js');
const { examStart, message } = require('../../js/alarm-common.js');

const VAPID_KEY = 'uec:push:vapid';
const DUE_KEY = 'uec:alarm:due';
const TICK_KEY = 'uec:alarm:lastTick';
const deviceKey = hash => `uec:alarm:dev:${hash}`;
const DAY = 864e5;

// 一台装置最多几个闹钟（网站那边的 MAX_ALARMS 不能比这个大，不然多出来的会被这里拒收）
const MAX_ALARMS = 20;
// 装置资料多久没更新就自动删掉（统考一年一次，考完就没用了）
const DEVICE_TTL_SECONDS = 60 * 24 * 3600;
// 晚了超过这么久就不送：定时器停过一阵、装置关机很久，醒来时不该补发一堆过时的「还有 3 天」
const LATE_LIMIT_MS = 30 * 60 * 1000;
// 推播服务替关机的装置保留讯息多久（秒）；同一个道理，过时的就别送到
const PUSH_TTL_SECONDS = LATE_LIMIT_MS / 1000;

const deviceHash = endpoint => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

async function readJson(key) {
  const raw = await command(['GET', key]);
  try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

let vapidCache = null;
async function vapidKeys() {
  if (vapidCache) return vapidCache;
  // 同时有两个请求第一次产生钥匙时，NX 让先到的那把留下，大家都读回同一把
  await command(['SET', VAPID_KEY, JSON.stringify(generateVapidKeys()), 'NX']);
  vapidCache = await readJson(VAPID_KEY);
  return vapidCache;
}

async function lastTick() {
  return Number(await command(['GET', TICK_KEY])) || 0;
}

// 浏览器送来的闹钟：[{ id, subject, first（第一次响的时间，毫秒）, daily }]。格式不对整批拒收（回 null）；
// 考试已经开始、设在开考之後、时间表上找不到这一科（例如科目改了名）的，只略过那一个
function cleanAlarms(raw, now) {
  if (!Array.isArray(raw) || raw.length > MAX_ALARMS) return null;
  const out = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object' || !/^[a-z0-9]{1,16}$/.test(String(a.id)) || !Number.isFinite(Number(a.first))) return null;
    const start = examStart(table.papers, a.subject);
    if (!start) continue;
    const daily = a.daily === true;
    let first = Number(a.first);
    if (daily) while (first < now) first += DAY;
    if (first < now - 60000 || first >= start) continue;
    out.push({ id: String(a.id), subject: a.subject, first, daily });
  }
  return out;
}

// 整批换掉这台装置的闹钟（空阵列＝全部删掉）
async function saveDevice(sub, alarms) {
  const hash = deviceHash(sub.endpoint);
  const old = await readJson(deviceKey(hash));
  if (old && Array.isArray(old.alarms) && old.alarms.length) {
    await command(['ZREM', DUE_KEY, ...old.alarms.map(a => `${hash}|${a.id}`)]);
  }
  if (!alarms.length) {
    await command(['DEL', deviceKey(hash)]);
    return;
  }
  await command(['SET', deviceKey(hash), JSON.stringify({ sub, alarms }), 'EX', String(DEVICE_TTL_SECONDS)]);
  await command(['ZADD', DUE_KEY, ...alarms.flatMap(a => [String(a.first), `${hash}|${a.id}`])]);
}

async function dropDevice(hash, dev) {
  await command(['DEL', deviceKey(hash)]);
  if (dev && Array.isArray(dev.alarms) && dev.alarms.length) {
    await command(['ZREM', DUE_KEY, ...dev.alarms.map(a => `${hash}|${a.id}`)]);
  }
}

// 伺服器推播身分的 sub 栏：推播服务出问题时联络谁。用网站网址，不放任何人的 email
const pushOptions = site => ({ subject: site, ttl: PUSH_TTL_SECONDS });

// 送一则测试通知：学生按「试一下」，马上确认这台装置收得到
async function sendTest(sub, site) {
  return sendPush(sub, { title: '闹钟通知正常 ✓', body: '到了你设的时间，就会像这样提醒你。', tag: 'alarm-test' }, await vapidKeys(), pushOptions(site));
}

// 每分钟跑一次：取出到期的闹钟送出，每天重复的排好明天
async function tick(site, now = Date.now()) {
  await command(['SET', TICK_KEY, String(now)]);
  const due = await command(['ZRANGEBYSCORE', DUE_KEY, '-inf', String(now), 'WITHSCORES', 'LIMIT', '0', '200']) || [];
  const jobs = [];
  for (let i = 0; i < due.length; i += 2) jobs.push({ member: due[i], at: Number(due[i + 1]) });
  const vapid = jobs.length ? await vapidKeys() : null;
  const stats = { due: jobs.length, sent: 0, late: 0, gone: 0, failed: 0 };

  async function run({ member, at }) {
    // 先抢下这一笔：两次检查重叠时（上一分钟还没跑完），同一个闹钟只会送一次
    if (!(await command(['ZREM', DUE_KEY, member]))) return;
    const [hash, id] = member.split('|');
    const dev = await readJson(deviceKey(hash));
    const alarm = dev && Array.isArray(dev.alarms) && dev.alarms.find(a => a.id === id);
    const start = alarm && examStart(table.papers, alarm.subject);
    if (!alarm || !start || start <= at) return;
    if (now - at > LATE_LIMIT_MS) {
      stats.late += 1;
    } else {
      const text = message(table.papers, alarm.subject, at);
      let status = 0;
      try {
        status = await sendPush(dev.sub, { ...text, tag: `alarm-${id}` }, vapid, pushOptions(site));
      } catch (e) {
        console.error('alarm push failed:', e.message);
      }
      // 学生取消了通知、清掉网站资料：订阅失效，这台装置的闹钟全部删掉
      if (status === 404 || status === 410) { stats.gone += 1; await dropDevice(hash, dev); return; }
      if (status >= 200 && status < 300) stats.sent += 1; else stats.failed += 1;
    }
    if (alarm.daily) {
      const next = at + DAY * Math.max(1, Math.ceil((now - at) / DAY));
      if (next < start) await command(['ZADD', DUE_KEY, String(next), member]);
    }
  }

  // 同一分钟可能很多人设（例如大家都设晚上 9 点）：每 10 个一起送
  for (let i = 0; i < jobs.length; i += 10) await Promise.all(jobs.slice(i, i + 10).map(run));
  return stats;
}

module.exports = { MAX_ALARMS, vapidKeys, lastTick, cleanAlarms, saveDevice, sendTest, tick };
