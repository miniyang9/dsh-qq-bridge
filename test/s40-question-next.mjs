import fs from 'node:fs'
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { Bridge } = await import('../src/app/bridge.js')

const dir = '.tmp/t-q-next'
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
const sent = []
const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }

function mk(extra = {}) {
  return new Bridge({
    appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
    statePath: dir + '/state-' + Math.random().toString(16).slice(2) + '.json',
    sessionsRoot: dir + '/none', log: { info() {}, error() {} }, ...extra,
  })
}

const question = (agentId = 's') => ({
  agent: { session: { id: agentId } },
  questions: [{ id: 'q1', question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }] }],
})

// 1) 传 next 不崩（R3 的 B4 回归）
{
  const b = mk(); await b.start()
  const p = b.handleQuestion(question(), { next: () => new Promise(() => {}) })
  await new Promise((r) => setTimeout(r, 20))
  check('传 next 时 handleQuestion 不抛错', p instanceof Promise && typeof p.then === 'function')
  const wp = b.points.list().at(-1)
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: `/ans ${wp.id} 1`, author: { user_openid: 'u1' } } })
  const ans = await p
  check('QQ 答复返回 {answers}', Array.isArray(ans?.answers) && ans.answers.length === 1, JSON.stringify(ans).slice(0, 80))
}

// 2) GUI 先答（对象形状）→ 采用 GUI 的答复
{
  const b = mk(); await b.start()
  const gui = Promise.resolve({ answers: [{ id: 'q1', selected: ['B'] }] })
  const ans = await b.handleQuestion(question('s2'), { next: () => gui })
  check('GUI 答复被采纳', ans?.answers?.[0]?.selected?.[0] === 'B', JSON.stringify(ans).slice(0, 80))
  check('手机收到"已在电脑端答复"', sent.some((s) => s.includes('已在电脑端答复')))
}

// 3) GUI 返回空 answers → 视为没答，继续等 QQ
{
  const b = mk(); await b.start()
  const p = b.handleQuestion(question('s3'), { next: () => Promise.resolve({ answers: [] }) })
  await new Promise((r) => setTimeout(r, 20))
  const wp = b.points.list().at(-1)
  check('空 answers 后待答点仍 open', wp?.status === 'open', String(wp?.status))
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm2', content: `/ans ${wp.id} 2`, author: { user_openid: 'u1' } } })
  const ans = await p
  check('随后 QQ 答复仍生效', Array.isArray(ans?.answers), JSON.stringify(ans).slice(0, 60))
}

console.log('\n' + (failures.length === 0 ? 'S40 PASS' : 'S40 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
