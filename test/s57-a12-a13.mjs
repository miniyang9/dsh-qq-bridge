import './_setup.mjs'
/**
 * A12（睡眠摘要）/ A13（中断 turn 计数）/ A10（答复属于已结束请求）
 * 以及 A6 预算计数（A8）
 */
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const fs = await import('node:fs')
const { Bridge } = await import('../src/app/bridge.js')

const dir = '.tmp/t-a12'
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })

function mk(opts = {}) {
  const sent = []
  const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }
  const b = new Bridge({
    appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
    statePath: `${dir}/s-${Math.random().toString(16).slice(2)}.json`,
    sessionsRoot: dir + '/none', idleProbe: () => 10 * 60_000,
    log: { info() {}, error() {} }, ...opts,
  })
  return { b, sent }
}

// A12：真实墙钟间隔 > 3 分钟 → 一条摘要
{
  const { b, sent } = mk()
  await b.start()
  b.lastWallTickAt = Date.now() - 10 * 60_000   // 伪造"设备睡过 10 分钟"
  await b.tick()
  check('睡眠后只发一条摘要', sent.filter((s) => s.includes('设备睡眠/挂起过')).length === 1, sent.slice(-1)[0])
  await b.tick()
  check('不会重复发睡眠摘要', sent.filter((s) => s.includes('设备睡眠/挂起过')).length === 1)
}

// A13：turn/start 记账，onReady 报"N 个中断 turn"
{
  const { b, sent } = mk()
  await b.start()
  const sess = { id: 'sess-a13', seq: 1, eventAt: () => ({ type: 'turn/start' }) }
  b.sessions.set(sess.id, { agent: { id: sess.id, session: sess } })
  await b.onSessionEvent(sess, { type: 'turn/start' })
  check('turn/start 记账', Object.keys(b.state.activeTurns ?? {}).length === 1, JSON.stringify(b.state.activeTurns))

  b.state.interruption = { dropped: 2 }
  await b.onReady()
  const msg = sent.at(-1) ?? ''
  check('重启文案含中断 turn 数', msg.includes('1 个中断 turn'), msg)
  check('重启文案含作废待答数', msg.includes('2 个待答请求已作废'), msg)
}

// A10：答复已结束的请求 → 文案含"属于已结束的请求 + id"
{
  const { b, sent } = mk()
  await b.start()
  const p = b.points.create({ kind: 'approval', title: 'x', meta: {} })
  b.points.drop(p.id, 'restart')
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: `/ans ${p.id} 1`, author: { user_openid: 'u1' } } })
  const msg = sent.at(-1) ?? ''
  check('答复过期请求带 id 与说明', msg.includes('属于已结束的请求') && msg.includes(p.id), msg)
}

// A8：主动推送计数（卡片也算）
{
  const { b } = mk()
  await b.start()
  await b.send('hello', null)
  await b.send('reply', 'msg-1')
  check('主动推送计数=1（被动不计）', (b.state.push?.count ?? 0) === 1, JSON.stringify(b.state.push))
}

console.log('\n' + (failures.length === 0 ? 'S57 PASS' : 'S57 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
