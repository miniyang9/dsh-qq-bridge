import './_setup.mjs'
/**
 * 在场门控（s53）：卡片/通知在"在场"时不推、离开时补推、5 分钟兜底；
 * 以及 /say 分片与 /more（s54 合并到这里，避免再拆文件）。
 */
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const fs = await import('node:fs')
const { Bridge } = await import('../src/app/bridge.js')

const dir = '.tmp/t-gate'
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })

function mk({ idle = null, now = () => Date.now(), extra = {} } = {}) {
  const sent = []
  const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }
  const b = new Bridge({
    appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
    statePath: `${dir}/s-${Math.random().toString(16).slice(2)}.json`,
    sessionsRoot: dir + '/none', now,
    idleProbe: () => idle,
    log: { info() {}, error() {} },
    ...extra,
  })
  return { b, sent }
}

// ---------- 在场：卡片不推 ----------
{
  const { b, sent } = mk({ idle: 30_000 })   // 30 秒 → 在场
  await b.start()
  b.presence.sample(); b.presence.sample()
  const p = b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.read', args: {} }, { timeoutMs: 2000 })
  await new Promise((r) => setTimeout(r, 20))
  const wp = b.points.list().at(-1)
  check('在场：卡片不发到 QQ', !sent.some((s) => s.includes('需要你批准')), sent.join(' | '))
  check('在场：待答点标记未推送', wp.meta.pushedToQQ === false, String(wp.meta.pushedToQQ))
  b.points.drop(wp.id, 'cleanup'); await p.catch(() => {})
}

// ---------- 离开：卡片要推 ----------
{
  const { b, sent } = mk({ idle: 10 * 60_000 })  // 10 分钟 → 离开
  await b.start()
  b.presence.sample()
  const p = b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.read', args: {} }, { timeoutMs: 2000 })
  await new Promise((r) => setTimeout(r, 20))
  check('离开：卡片发到 QQ', sent.some((s) => s.includes('需要你批准')), sent.slice(-1)[0]?.slice(0, 20))
  const wp = b.points.list().at(-1)
  check('离开：标记已推送', wp.meta.pushedToQQ === true)
  b.points.drop(wp.id, 'cleanup'); await p.catch(() => {})
}

// ---------- /mode 与 /pc：手动静音 ----------
{
  const { b, sent } = mk({ idle: 10 * 60_000 })  // 物理上"离开"
  await b.start()
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: '/pc 60', author: { user_openid: 'u1' } } })
  check('/pc 回执含分钟', (sent.at(-1) ?? '').includes('60 分钟'), sent.at(-1))
  const p = b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.read', args: {} }, { timeoutMs: 2000 })
  await new Promise((r) => setTimeout(r, 20))
  check('/pc 期间卡片不发', !sent.some((s) => s.includes('需要你批准')))
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm2', content: '/mode', author: { user_openid: 'u1' } } })
  check('/mode 显示静音与剩余', (sent.at(-1) ?? '').includes('静音'), sent.at(-1))
  const wp = b.points.list().at(-1)
  b.points.drop(wp.id, 'cleanup'); await p.catch(() => {})
}

// ---------- 5 分钟兜底 ----------
{
  let now = 1_700_000_000_000
  const { b, sent } = mk({ idle: 30_000, now: () => now })   // 在场
  await b.start()
  b.presence.sample(); b.presence.sample()
  const p = b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.read', args: {} }, { timeoutMs: 60_000 })
  await new Promise((r) => setTimeout(r, 20))
  now += 5 * 60_000 + 1000
  await b.tick()
  check('5 分钟没人答 → 兜底推送', sent.some((s) => s.includes('5 分钟没有处理')), sent.slice(-1)[0]?.slice(0, 30))
  const wp = b.points.list().at(-1)
  b.points.drop(wp.id, 'cleanup'); await p.catch(() => {})
}

// ---------- /say 分片 + /more ----------
{
  const { b, sent } = mk({ idle: 10 * 60_000, extra: { sayReplyChars: 200 } })
  await b.start()
  const long = 'A'.repeat(450)
  const events = [{ type: 'turn/start' }, { type: 'turn/end' }]
  const session = { id: 'session-long-1', seq: events.length, eventAt: (i) => events[i] }
  b.sessions.set(session.id, { agent: { id: session.id, session, followup() {} } })
  b.sayRelay = { sessionId: session.id, qqMsgId: 'm', at: b.now() }
  b.sessionState.set(session.id, { turnOpen: true, lastAt: b.now(), notified: {}, lastText: long, startedAt: b.now(), tools: {} })
  await b.onSessionEvent(session, { type: 'turn/end' })
  const first = sent.find((x) => x.includes("片）")) ?? ''
  check('分片头告知总片数', first.includes('（1/3 片）'), first.slice(0, 40))
  check('分片尾给出 /more', first.includes('/more'), first.slice(-40))
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm9', content: '/more', author: { user_openid: 'u1' } } })
  check('/more 取到第 2 片', sent.some((x) => x.includes('2/3 片')), sent.slice(-1)[0]?.slice(0, 30))
}

console.log('\n' + (failures.length === 0 ? 'S53 PASS' : 'S53 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
