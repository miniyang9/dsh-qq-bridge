import './_setup.mjs'
/**
 * 卡片字段（A1/W5、A27b）+ 进度 id（A18）+ 审计裁剪（A26）
 */
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const fs = await import('node:fs')
const { renderCard } = await import('../src/transport/envelope.js')
const { Bridge } = await import('../src/app/bridge.js')

// A1/W5 + A27b：字段齐备
{
  const plain = renderCard({
    id: 'wp-1', title: '需要你批准：fs.read', toolName: 'fs.read', reason: '读一个文件',
    args: '{}', target: '工作区/沙箱范围内', evidenceViewed: false, options: ['批准', '拒绝'],
  })
  check('普通卡片有"影响范围"', plain.text.includes('影响范围：工作区/沙箱范围内'), plain.text.split('\n')[2])
  check('普通卡片有"现场：未查看"', plain.text.includes('现场：未查看'), plain.text.split('\n').find((l) => l.includes('现场')))

  const viewed = renderCard({
    id: 'wp-2', title: '需要你批准：fs.write', toolName: 'fs.write', reason: '写文件',
    args: '{}', evidenceViewed: true, options: ['批准', '拒绝'],
  })
  check('已查看时写"现场：已查看"', viewed.text.includes('现场：已查看'), viewed.text.split('\n').find((l) => l.includes('现场')))

  const missing = renderCard({
    id: 'wp-3', title: '需要你批准：fs.write', toolName: 'fs.write', evidenceMissing: true,
    options: ['批准', '拒绝'],
  })
  check('咨询不可用时写"暂不可查"', missing.text.includes('现场：暂不可查'), missing.text.split('\n').find((l) => l.includes('现场')))
}

// A18：/progress 带事件 id 与待答点 id
{
  const dir = '.tmp/t-a18'; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
  const sent = []
  const client = { on() {}, async start() {}, async stop() {}, async sendPassive(a) { sent.push(a.content); return { id: 'p' } }, async sendProactive(a) { sent.push(a.content); return { id: 'a' } } }
  const events = [{ type: 'turn/start' }, { type: 'tool/call', data: { name: 'fs.read' } }]
  const session = { id: 'session-a18', seq: events.length, eventAt: (i) => events[i] }
  const b = new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client, statePath: `${dir}/state.json`, sessionsRoot: dir + '/none', log: { info() {}, error() {} } })
  await b.start()
  b.bindAgent({ id: 'session-a18', session })
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: '/progress session-a18', author: { user_openid: 'u1' } } })
  const txt = sent.at(-1) ?? ''
  check('事件行带 ev-N', /ev-\d+ turn\/start/.test(txt), txt.split('\n').find((l) => l.includes('ev-')))
}

// A26：start 时会裁剪审计（用假审计器验证被调用）
{
  const dir = '.tmp/t-a26'; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
  let pruned = 0
  const client = { on() {}, async start() {}, async stop() {}, async sendPassive() { return { id: 'p' } }, async sendProactive() { return { id: 'a' } } }
  const b = new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client, statePath: `${dir}/state.json`, sessionsRoot: dir + '/none', log: { info() {}, error() {} } })
  b.audit.prune = async () => { pruned += 1; return 0 }
  await b.start()
  await new Promise((r) => setTimeout(r, 20))
  check('启动时调用审计裁剪', pruned >= 1, String(pruned))
}

console.log('\n' + (failures.length === 0 ? 'S51 PASS' : 'S51 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
