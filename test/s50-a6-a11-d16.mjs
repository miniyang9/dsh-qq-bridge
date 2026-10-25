import './_setup.mjs'
/**
 * A6 / A11 / D16 的回归（本轮按独立评审补的三条）
 */
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const fs = await import('node:fs')
const { Bridge } = await import('../src/app/bridge.js')

const dir = '.tmp/t-a6a11'
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })

const mk = (opts = {}) => {
  const sent = []
  const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }
  const b = new Bridge({
    appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
    statePath: `${dir}/state-${Math.random().toString(16).slice(2)}.json`,
    sessionsRoot: dir + '/none', log: { info() {}, error() {} }, ...opts,
  })
  return { b, sent }
}

// ---------- A6：10 / 30 分钟待答提醒 ----------
{
  let now = 1_700_000_000_000
  const { b, sent } = mk({ now: () => now })
  await b.start()
  const p = b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.read', args: {} }, { timeoutMs: 60_000 })
  await new Promise((r) => setTimeout(r, 10))
  const wp = b.points.list().at(-1)

  now += 11 * 60_000
  await b.tick()
  check('10 分钟提醒一次', sent.some((s) => s.includes(wp.id) && s.includes('10 分钟')), sent.slice(-1)[0])
  const after10 = sent.length
  await b.tick()
  check('同一档不重复提醒', sent.length === after10, String(sent.length - after10))

  now += 21 * 60_000
  await b.tick()
  check('30 分钟再提醒一次', sent.some((s) => s.includes('30 分钟')), sent.slice(-1)[0])

  b.points.drop(wp.id, 'cleanup')
  await p.catch(() => {})
}

// ---------- A11：标注以会话自己的 cwd 为根 ----------
{
  const { b } = mk()
  await b.start()
  // 会话 cwd 是 C:\Other，工具写 C:\Other\x —— 应当"不算工作区外"
  const p = b.handleApproval({
    agent: { session: { id: 's2', header: { cwd: 'C:\\Other' } } },
    toolName: 'fs.write',
    args: { path: 'C:\\Other\\x.txt' },
    callId: 'A11',
  }, { timeoutMs: 2000 })
  await new Promise((r) => setTimeout(r, 10))
  const wp = b.points.list().at(-1)
  check('会话 cwd 内的写操作不被标注', wp.meta.labeled === false, `labeled=${wp.meta.labeled} reason=${wp.meta.labelReason}`)
  b.points.drop(wp.id, 'cleanup')
  await p.catch(() => {})
}

// ---------- D16：/new 后等待 agent 就绪并绑定 ----------
{
  let polls = 0
  const agent = { id: 'session-late-1', session: { id: 'session-late-1', seq: 0, eventAt: () => null } }
  const { b, sent } = mk({
    workspaceIndex: `${dir}/ws.json`,
    getSessionController: () => ({ async create() { return { sessionId: 'session-late-1' } } }),
    getAgents: () => ({ get: () => (++polls >= 3 ? agent : null) }),   // 前两次拿不到
  })
  fs.writeFileSync(`${dir}/ws.json`, JSON.stringify({ tables: { workspaces: { 'ws-1': { path: '.' } } } }))
  await b.start()
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: '/new 1', author: { user_openid: 'u1' } } })
  check('/new 等到 agent 后才宣告成功', (sent.at(-1) ?? '').includes('已在'), sent.at(-1))
  check('新建后自动绑定', String(b.boundAgent?.id ?? '') === 'session-late-1', String(b.boundAgent?.id))
}

console.log('\n' + (failures.length === 0 ? 'S50 PASS' : 'S50 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
