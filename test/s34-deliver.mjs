import './_setup.mjs'
import fs from 'node:fs'
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }

const { deliverToAgent, userMessage } = await import('../src/app/bridge.js')

// 1) 有 followup 时必须用它（会唤醒），不能用 inject
{
  const calls = []
  const agent = { followup: (m) => calls.push(['followup', m]), inject: (m) => calls.push(['inject', m]) }
  const how = deliverToAgent(agent, userMessage('hi'))
  check('优先 followup', how === 'followup' && calls[0][0] === 'followup', JSON.stringify(calls.map((c) => c[0])))
}

// 2) 没有 followup 时退回 inject
{
  const calls = []
  const agent = { inject: (m) => calls.push(['inject', m]) }
  check('退回 inject', deliverToAgent(agent, userMessage('hi')) === 'inject')
}

// 3) 三者都没有 → 明确抛错
{
  let threw = false
  try { deliverToAgent({}, userMessage('hi')) } catch { threw = true }
  check('无投递方法时抛错', threw)
}

// 4) 消息形状：role + id 必须有
{
  const m = userMessage('x')
  check('消息含 role=user', m.role === 'user', JSON.stringify(m).slice(0, 80))
  check('消息含 id', typeof m.id === 'string' && m.id.length > 0)
  check('内容为 text 块', m.content?.[0]?.type === 'text' && m.content[0].text === 'x')
}

console.log('\n' + (failures.length === 0 ? 'S34 PASS' : 'S34 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
