import fs from 'node:fs'
const failures = []
const check = (label, ok, detail = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  — ' + detail : '')); if (!ok) failures.push(label) }
const { Bridge } = await import('../src/app/bridge.js')

const root = '.tmp/fake-ws'
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root + '/--C-Project-WatchDog--/sess-aaaa', { recursive: true })
fs.writeFileSync(root + '/--C-Project-WatchDog--/sess-aaaa/session.v4.jsonl', JSON.stringify({ type: 'session', id: 'sess-aaaa', cwd: '.', delegationDepth: 0 }))

const sent = []
const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }

let resumed = null
const agent = { id: 'sess-aaaa', session: { id: 'sess-aaaa', seq: 0, eventAt: () => null } }
const sc = { async resolveAgent(id) { resumed = id; return { agent } } }

const b = new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client, statePath: '.tmp/t-wake-' + Date.now() + '.json', sessionsRoot: root, getSessionController: () => sc, log: { info() {}, error() {} } })
await b.start()

await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: '/wake 1', author: { user_openid: 'u1' } } })
check('调用了 sessionController.resolveAgent(sessionId)', resumed === 'sess-aaaa', String(resumed))
check('回话说明已唤醒', sent.at(-1).includes('已唤醒'), sent.at(-1))
check('唤醒后自动绑定', b.boundAgent?.id === 'sess-aaaa')

await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm2', content: '/wake 1', author: { user_openid: 'u1' } } })
check('重复唤醒被拦', sent.at(-1).includes('已经加载着'), sent.at(-1))

const b2 = new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client, statePath: '.tmp/t-wake2-' + Date.now() + '.json', sessionsRoot: root, getSessionController: () => null, log: { info() {}, error() {} } })
await b2.start()
await b2.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm3', content: '/wake 1', author: { user_openid: 'u1' } } })
check('没有服务时明确报错', sent.at(-1).includes('拿不到会话服务'), sent.at(-1))

console.log('\n' + (failures.length === 0 ? 'S10 PASS' : 'S10 FAIL') + '  (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
