import './_setup.mjs'
/**
 * N2 的"同时作答"竞态（R5 阻断的锁）
 *
 * 场景：桌面答复已经解析出来，但手机那票在同一/下一个微任务里到达。
 * 要求：恰好一条审计；不得既回"已收到"又回"已在电脑端处理"；返回的结局与生效票一致。
 * 这条用例在 89165be（修 N2 之前）应当变红。
 */
import fs from 'node:fs'
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { Bridge } = await import('../src/app/bridge.js')

const dir = '.tmp/t-race'
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })

function mk(tag) {
  const sent = []
  const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }
  const statePath = `${dir}/state-${tag}.json`
  const b = new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client, statePath, sessionsRoot: dir + '/none', log: { info() {}, error() {} } })
  return { b, sent, auditPath: statePath.replace(/\.json$/, '') + '.audit.jsonl' }
}
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [])
const inbound = (b, content, id) => b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id, content, author: { user_openid: 'u1' } } })

// 1) 审批：GUI 用 queueMicrotask 答复，手机票紧跟着到
{
  const { b, sent, auditPath } = mk('approval')
  await b.start()
  const p = b.handleApproval(
    { agent: { session: { id: 's' } }, toolName: 'fs.read', callId: 'C-race', args: {} },
    { next: () => new Promise((res) => queueMicrotask(() => res('allowed'))) },
  )
  await Promise.resolve()
  const wp = b.points.list().at(-1)
  await inbound(b, `/yes ${wp.id}`, 'm1')   // 同一拍内到达的手机票
  const outcome = await p
  await new Promise((r) => setTimeout(r, 40))
  const rows = read(auditPath)
  check('审批：恰好 1 条审计', rows.length === 1, `audits=${rows.length}`)
  check('审批：结局与生效票一致', outcome === 'allowed', String(outcome))
  const acked = sent.filter((s) => s.includes('已收到')).length
  const notified = sent.filter((s) => s.includes('已在电脑端处理')).length
  check('审批：不同时回两种回执', !(acked > 0 && notified > 0), `已收到=${acked} 已在电脑端=${notified}`)
}

// 2) 提问：同一竞态
{
  const { b, sent, auditPath } = mk('question')
  await b.start()
  const q = { id: 'q1', question: '选哪个', options: [{ label: 'A' }, { label: 'B' }] }
  const p = b.handleQuestion(
    { agent: { session: { id: 's2' } }, questions: [q] },
    { next: () => new Promise((res) => queueMicrotask(() => res({ answers: [{ id: 'q1', selected: ['A'] }] }))) },
  )
  await Promise.resolve()
  const wp = b.points.list().at(-1)
  await inbound(b, `/ans ${wp.id} 2`, 'm1')
  const ans = await p
  await new Promise((r) => setTimeout(r, 40))
  const rows = read(auditPath)
  check('提问：恰好 1 条审计', rows.length === 1, `audits=${rows.length}`)
  check('提问：answers 只反映生效票', Array.isArray(ans?.answers) && ans.answers.length <= 1, JSON.stringify(ans).slice(0, 80))
  const acked = sent.filter((s) => s.includes('已收到')).length
  const notified = sent.filter((s) => s.includes('已在电脑端答复')).length
  check('提问：不同时回两种回执', !(acked > 0 && notified > 0), `已收到=${acked} 已在电脑端=${notified}`)
}


// 3) 反向竞态：手机先结算，桌面答复随后才解析（R5 指出的那一格）
{
  const { b, sent, auditPath } = mk('reverse')
  await b.start()
  let guiResolve
  const gui = new Promise((res) => { guiResolve = res })
  const p = b.handleApproval(
    { agent: { session: { id: 's3' } }, toolName: 'fs.read', callId: 'C-rev', args: {} },
    { next: () => gui },
  )
  await new Promise((r) => setTimeout(r, 20))
  const wp = b.points.list().at(-1)
  await inbound(b, `/yes ${wp.id}`, 'm1')     // 手机先答
  await new Promise((r) => setTimeout(r, 20))
  guiResolve('allowed')                       // 桌面随后才答复
  const outcome = await p
  await new Promise((r) => setTimeout(r, 40))
  const rows = read(auditPath)
  check('反向：恰好 1 条审计', rows.length === 1, `audits=${rows.length}`)
  check('反向：不得回"已在电脑端处理"', !sent.some((x) => x.includes('已在电脑端处理')), sent.slice(-2).join(' | '))
  check('反向：结局与手机票一致', outcome === 'allowed', String(outcome))
}

console.log('\n' + (failures.length === 0 ? 'S42 PASS' : 'S42 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
