import './_setup.mjs'
import fs from 'node:fs'
const failures = []
const check = (label, ok, detail = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  — ' + detail : '')); if (!ok) failures.push(label) }

const { Bridge } = await import('../src/app/bridge.js')
const root = '.tmp/fake-ws-res'
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root + '/--C-Project--/session-dd94c595-1111', { recursive: true })
fs.writeFileSync(root + '/--C-Project--/session-dd94c595-1111/session.v4.jsonl', JSON.stringify({ type: 'session', id: 'session-dd94c595-1111', cwd: 'C:/Project', delegationDepth: 0 }))

const sent = []
const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }

const agent = { id: 'session-dd94c595-1111', session: { id: 'session-dd94c595-1111', seq: 0, eventAt: () => null } }
let called = null
const sc = {
  async resolveAgent(id) { called = id; return { agent } },
  async list() { return [] },
  async create() { return { sessionId: 'x' } },
}

const b = new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client, statePath: '.tmp/t-res-' + Date.now() + '.json', sessionsRoot: root, getSessionController: () => sc, log: { info() {}, error() {} } })
await b.start()
await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: '/wake dd94c5', author: { user_openid: 'u1' } } })
check('走 resolveAgent 路径', called === 'session-dd94c595-1111', String(called))
check('回话说明已唤醒', (sent.at(-1) ?? '').includes('已唤醒'), sent.at(-1))
check('唤醒后自动绑定', b.boundAgent?.id === 'session-dd94c595-1111')

// resolveAgent 返回 error 时如实报错
const sc2 = { async resolveAgent() { return { error: new Error('boom') } } }
const b2 = new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client, statePath: '.tmp/t-res2-' + Date.now() + '.json', sessionsRoot: root, getSessionController: () => sc2, log: { info() {}, error() {} } })
await b2.start()
await b2.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm2', content: '/wake dd94c5', author: { user_openid: 'u1' } } })
check('error 时回话带原因', (sent.at(-1) ?? '').includes('boom'), sent.at(-1))

console.log('\n' + (failures.length === 0 ? 'S29 PASS' : 'S29 FAIL'))
process.exit(failures.length === 0 ? 0 : 1)
