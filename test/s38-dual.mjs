import fs from 'node:fs'
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { Bridge } = await import('../src/app/bridge.js')

const sent = []
const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }
const mk = (opts = {}) => new Bridge({
  appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
  statePath: '.tmp/t-dual-' + Date.now() + Math.random() + '.json',
  sessionsRoot: '.tmp/fake-none',
  log: { info() {}, error() {} }, ...opts,
})
const req = { agent: { session: { id: 's' } }, toolName: 'fs.read', callId: 'c', args: {} }

// 1) QQ 先答 → 采用 QQ；GUI 之后 reject 不得炸
{
  const b = mk(); await b.start()
  let guiResolve, guiReject
  const gui = new Promise((res, rej) => { guiResolve = res; guiReject = rej })
  const p = b.handleApproval(req, { next: () => gui })
  await new Promise((r) => setTimeout(r, 20))
  const id = b.points.list().at(-1).id
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: `/yes ${id}`, author: { user_openid: 'u1' } } })
  const outcome = await p
  check('QQ 先答 → allowed', outcome === 'allowed' || outcome === 'allowed-once', String(outcome))
  // GUI 后来点“关闭”→ reject；必须被吞掉
  guiReject(new Error('approval request was aborted'))
  await new Promise((r) => setTimeout(r, 20))
  check('GUI 之后 reject 不影响结果且不崩', true)
}

// 2) GUI 先答 → 采用 GUI，待答点被清理并告知手机
{
  const b = mk(); await b.start()
  const gui = Promise.resolve('rejected')
  const p = b.handleApproval(req, { next: () => gui })
  const outcome = await p
  check('GUI 先答 → 用 GUI 的 rejected', outcome === 'rejected', String(outcome))
  check('待答点已清理', b.points.list().filter((x) => x.status === 'open').length === 0)
  check('手机收到“已在电脑端处理”', sent.some((s) => s.includes('已在电脑端处理')))
}

// 3) next 抛错 → 退回纯 QQ 路径，不炸
{
  const b = mk(); await b.start()
  const p = b.handleApproval(req, { next: () => { throw new Error('no gui') } })
  await new Promise((r) => setTimeout(r, 20))
  const id = b.points.list().at(-1).id
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm2', content: `/no ${id}`, author: { user_openid: 'u1' } } })
  const outcome = await p
  check('next 抛错仍可用 QQ 决策', outcome === 'rejected', String(outcome))
}

// 4) 没有 next（旧调用）→ 行为不变
{
  const b = mk(); await b.start()
  const p = b.handleApproval(req)
  await new Promise((r) => setTimeout(r, 20))
  const id = b.points.list().at(-1).id
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm3', content: `/yes ${id}`, author: { user_openid: 'u1' } } })
  const outcome = await p
  check('无 next 时行为不变', outcome === 'allowed' || outcome === 'allowed-once', String(outcome))
}

console.log('\n' + (failures.length === 0 ? 'S38 PASS' : 'S38 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
