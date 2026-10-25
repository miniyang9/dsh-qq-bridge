/**
 * 审计守恒（R4 的 N2 回归测试）
 * 四种时序：QQ 先答 / GUI 先答 / 两边都答 / 都不答
 * 要求：同一请求恰好一条审计，且内容对应真正生效的那一票。
 */
import fs from 'node:fs'
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { Bridge } = await import('../src/app/bridge.js')

const dir = 'C:/Project/WatchDog/.tmp/t-audit-cons'
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
const req = (callId) => ({ agent: { session: { id: 's' } }, toolName: 'fs.read', callId, args: {} })

// 1) 两边都答：GUI 先答，手机后答 → 恰好 1 条，且是 GUI 的那票
{
  const { b, sent, auditPath } = mk('both')
  await b.start()
  const p = b.handleApproval(req('C-both'), { next: () => Promise.resolve('allowed') })
  const outcome = await p
  await new Promise((r) => setTimeout(r, 30))
  const wp = b.points.list().at(-1)
  await inbound(b, `/yes ${wp.id}`, 'm1')   // 迟到的手机票
  await new Promise((r) => setTimeout(r, 30))
  const rows = read(auditPath)
  check('两边都答 → 恰好 1 条审计', rows.length === 1, `audits=${rows.length}`)
  check('审计记录的是 GUI 的票', JSON.parse(rows[0]?.outcome ?? '{}').via === 'gui', rows[0]?.outcome)
  check('迟到的手机票没有回"已收到"', !sent.some((s) => s.includes('已收到')), sent.slice(-2).join(' | '))
  check('迟到的手机票得到"已被处理/作废"', sent.some((s) => s.includes('已被处理') || s.includes('已作废')), sent.slice(-2).join(' | '))
  check('结果仍为 allowed', outcome === 'allowed', String(outcome))
}

// 2) QQ 先答 → 恰好 1 条，且是手机那票
{
  const { b, auditPath } = mk('qq')
  await b.start()
  const p = b.handleApproval(req('C-qq'), { next: () => new Promise(() => {}) })
  await new Promise((r) => setTimeout(r, 20))
  const wp = b.points.list().at(-1)
  await inbound(b, `/yes ${wp.id}`, 'm1')
  await p
  await new Promise((r) => setTimeout(r, 20))
  const rows = read(auditPath)
  check('QQ 先答 → 恰好 1 条审计', rows.length === 1, `audits=${rows.length}`)
  check('审计里 openid 是 u1', rows[0]?.openid === 'u1', rows[0]?.openid)
}

// 3) 都不答 → 0 条
{
  const { b, auditPath } = mk('none')
  await b.start()
  const p = b.handleApproval(req('C-none'), { timeoutMs: 60 })
  await Promise.race([p, new Promise((r) => setTimeout(r, 800))])
  await new Promise((r) => setTimeout(r, 20))
  check('都不答 → 0 条审计', read(auditPath).length === 0, String(read(auditPath).length))
}

// 4) GUI 先答后重启：不得误报"待答请求作废"
{
  const { b, sent } = mk('restart')
  await b.start()
  await b.handleApproval(req('C-restart'), { next: () => Promise.resolve('rejected') })
  const b2 = new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client: { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }, statePath: `${dir}/state-restart.json`, sessionsRoot: dir + '/none', log: { info() {}, error() {} } })
  await b2.start()
  check('GUI 先答后重启不误报作废', !sent.some((s) => s.includes('作废')), sent.slice(-2).join(' | '))
}

console.log('\n' + (failures.length === 0 ? 'S41 PASS' : 'S41 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
