/**
 * 咨询会话不该以"未命名 + 未分组"出现（真机反馈）
 *
 * 要求：
 *   1) 目标会话在工作区里 → 咨询会话也按 workspaceId 创建（否则 GUI 归"未分组"）
 *   2) 咨询会话要有标题（QQ 咨询 · <目标>），不能是"未命名"
 *   3) 它仍然不进 /list（A36），且不影响普通 /why 的工作
 */
import fs from 'node:fs'
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { Bridge } = await import('../src/app/bridge.js')

const root = '.tmp/t-consult-ws'
fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root, { recursive: true })
const sessionId = 'session-cccc3333-4444'
fs.mkdirSync(`${root}/--C-Project-WatchDog--/${sessionId}`, { recursive: true })
fs.writeFileSync(`${root}/--C-Project-WatchDog--/${sessionId}/session.v4.jsonl`, JSON.stringify({ type: 'session', id: sessionId, cwd: '.', delegationDepth: 0, agentPreset: 'standard' }))

const idx = '.tmp/t-consult-ws.json'
fs.writeFileSync(idx, JSON.stringify({ tables: { workspaces: { 'ws-watchdog': { path: '.' } } } }))

const sent = []
const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }
let createReq = null
const titles = []
const consultSession = { id: 'session-consult-9', seq: 0, eventAt: () => null, append: (t, d) => { if (t === 'session/title') titles.push(d.title) } }
const sc = {
  async create(req) { createReq = req; return { sessionId: consultSession.id } },
}
const agents = { get: (id) => ({ id, session: id === consultSession.id ? consultSession : { id, seq: 0, eventAt: () => null }, inject() {}, followup() {} }) }

const b = new Bridge({
  appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
  statePath: '.tmp/t-consult-ws-state-' + Date.now() + '.json',
  sessionsRoot: root, workspaceIndex: idx, workspaceRoot: '.',
  getSessionController: () => sc, getAgents: () => agents,
  log: { info() {}, error() {} },
})
await b.start()
await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: `/why ${sessionId.slice(8, 14)} 它为什么停`, author: { user_openid: 'u1' } } })

check('咨询会话按 workspaceId 创建（不进"未分组"）', createReq?.workspaceId === 'ws-watchdog', JSON.stringify(createReq))
check('咨询会话不使用裸 cwd', createReq?.cwd === undefined, JSON.stringify(createReq))
check('咨询会话有标题', String(titles.at(-1) ?? '').startsWith('QQ 咨询 · '), titles.at(-1))
check('标题事件字段完整', titles.length > 0)

// 仍然不进 /list
await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm2', content: '/list', author: { user_openid: 'u1' } } })
const list = sent.at(-1) ?? ''
check('/list 不显示咨询会话', !list.includes(consultSession.id.slice(8, 14)), list.split('\n').slice(0, 2).join(' | '))

console.log('\n' + (failures.length === 0 ? 'S47 PASS' : 'S47 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
