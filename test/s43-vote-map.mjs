/**
 * N2 的锁（R6 指出 s42 没锁住 GUI 分支）
 *
 * 核心缺陷有两处，各自可独立验证：
 *   1) 票→结局映射漏了 'yes'（/yes 是标注请求唯一受理形式）
 *   2) GUI 想写结果时若手机已结算，必须以已生效那票为准，而不是重写一条
 * 这两个决策函数都是导出的纯函数，可直接断言；改坏任一处，这里先红。
 */
import fs from 'node:fs'
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }

const { outcomeFromVote, decisionFromOther, Bridge } = await import('../src/app/bridge.js')

// ---------- 1) 票 → 结局 ----------
check('yes → allowed', outcomeFromVote('yes') === 'allowed')
check('批准 → allowed', outcomeFromVote('批准') === 'allowed')
check('拒绝 → rejected', outcomeFromVote('拒绝') === 'rejected')
check('no → rejected', outcomeFromVote('no') === 'rejected')

// ---------- 2) 迟到方服从已生效票 ----------
check('手机已 yes → allowed', decisionFromOther({ status: 'resolved', text: 'yes' }) === 'allowed')
check('手机已 拒绝 → rejected', decisionFromOther({ status: 'resolved', text: '拒绝' }) === 'rejected')
check('对方未结算 → cancelled', decisionFromOther({ status: 'dropped' }) === 'cancelled')
check('对方为 null → cancelled', decisionFromOther(null) === 'cancelled')

// ---------- 3) 端到端：/yes 与 /ans 1 应得到同一结局 ----------
const dir = 'C:/Project/WatchDog/.tmp/t-lock2'
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
const mk = (tag) => {
  const sent = []
  const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }
  const statePath = `${dir}/state-${tag}.json`
  const b = new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client, statePath, sessionsRoot: dir + '/none', log: { info() {}, error() {} } })
  return { b, auditPath: statePath.replace(/\.json$/, '') + '.audit.jsonl' }
}
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [])
const inbound = (b, content, id) => b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id, content, author: { user_openid: 'u1' } } })

for (const [cmd, label] of [['/yes', 'yes'], ['/ans', 'ans1']]) {
  const { b, auditPath } = mk(label)
  await b.start()
  const p = b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.read', callId: `C-${label}`, args: {} }, { timeoutMs: 2000 })
  await new Promise((r) => setTimeout(r, 10))
  const wp = b.points.list().at(-1)
  await inbound(b, cmd === '/yes' ? `/yes ${wp.id}` : `/ans ${wp.id} 1`, 'm1')
  const outcome = await p
  const rows = read(auditPath)
  const vote = rows[0] ? JSON.parse(rows[0].outcome) : null
  check(`${cmd} → allowed`, outcome === 'allowed', String(outcome))
  check(`${cmd} 审计 1 条`, rows.length === 1, `audits=${rows.length}`)
  check(`${cmd} 审计票与结局一致`, outcomeFromVote(vote?.text) === outcome, `vote=${vote?.text}`)
}

console.log('\n' + (failures.length === 0 ? 'S43 PASS' : 'S43 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
