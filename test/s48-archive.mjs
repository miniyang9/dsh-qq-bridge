import './_setup.mjs'
/**
 * /done 之后自动归档咨询会话（用户要求）
 *
 * 咨询会话用完不该继续占侧边栏。归档走 workspaceController.archiveSession，
 * 失败时如实回"归档未成功"，不假装成功。
 */
import fs from 'node:fs'
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { Bridge } = await import('../src/app/bridge.js')

const root = '.tmp/t-archive'
fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root, { recursive: true })
const sid = 'session-eeee5555-6666'
fs.mkdirSync(`${root}/--C-Project-WatchDog--/${sid}`, { recursive: true })
fs.writeFileSync(`${root}/--C-Project-WatchDog--/${sid}/session.v4.jsonl`, JSON.stringify({ type: 'session', id: sid, cwd: '.', delegationDepth: 0, agentPreset: 'standard' }))

const sent = []
const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }
let archivedId = null
let createCount = 0
const sc = { async create() { createCount += 1; return { sessionId: 'session-consult-' + createCount } } }
const agents = { get: (id) => ({ id, session: { id, seq: 0, eventAt: () => null }, append() {}, followup() {} }) }
const wc = { async archiveSession(req) { archivedId = req.sessionId } }

const make = (workspaceController) => new Bridge({
  appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
  statePath: root + '/state-' + Date.now() + Math.random() + '.json',
  sessionsRoot: root, workspaceRoot: '.',
  getSessionController: () => sc, getAgents: () => agents,
  getWorkspaceController: () => workspaceController,
  log: { info() {}, error() {} },
})

// 1) 正常归档
{
  const b = make(wc); await b.start()
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: `/why ${sid.slice(8, 14)} 为什么停`, author: { user_openid: 'u1' } } })
  const consultId = [...b.consults.values()][0]?.consultId
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm2', content: `/done ${sid.slice(8, 14)}`, author: { user_openid: 'u1' } } })
  check('/done 触发归档', archivedId === consultId, `${archivedId} vs ${consultId}`)
  check('回话说明已归档', (sent.at(-1) ?? '').includes('已归档'), sent.at(-1))
  check('通道已移除', b.consults.size === 0)
}

// 2) 没有归档服务 → 如实报"归档未成功"，不假装
{
  archivedId = null
  const b = make(null); await b.start()
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm3', content: `/why ${sid.slice(8, 14)} 再看一次`, author: { user_openid: 'u1' } } })
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm4', content: `/done ${sid.slice(8, 14)}`, author: { user_openid: 'u1' } } })
  check('无服务时回话写"归档未成功"', (sent.at(-1) ?? '').includes('归档未成功'), sent.at(-1))
  check('无服务时不谎报已归档', !(sent.at(-1) ?? '').includes('已归档'), sent.at(-1))
}

console.log('\n' + (failures.length === 0 ? 'S48 PASS' : 'S48 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
