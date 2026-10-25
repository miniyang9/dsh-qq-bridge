import './_setup.mjs'
/**
 * 与 DSH 接口词表对齐（真机事故的锁）
 *
 * 事故一：审批结局用了 allowed，DSH 只认 allowed-once → 两条通道的批准都无效。
 * 事故二：消息来源用了 user-say，DSH 的 MessageSource 只有 kind:'user'（还要 rpcId）。
 * 事故三：send 的 InboxTarget 传 undefined，合法值是 next-turn / next-step。
 *
 * 这里逐条钉住，改坏任一处先红。
 */
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const fs = await import('node:fs')
const { userMessage, outcomeFromVote, deliverToAgent } = await import('../src/app/bridge.js')

// 1) 消息来源
const m = userMessage('hi')
check('source.kind 是 user（不是 user-say）', m?.source?.kind === 'user', JSON.stringify(m?.source))
check('source 带 rpcId', typeof m?.source?.rpcId === 'string' && m.source.rpcId.length > 0, JSON.stringify(m?.source))
check('role 是 user', m.role === 'user')
check('带稳定 id', typeof m.id === 'string' && m.id.length > 0)

// 2) 审批结局
check('yes → allowed-once', outcomeFromVote('yes') === 'allowed-once')
check('批准 → allowed-once', outcomeFromVote('批准') === 'allowed-once')
check('拒绝 → rejected', outcomeFromVote('拒绝') === 'rejected')

// 3) InboxTarget：send 兜底必须传合法值
{
  const calls = []
  const agent = { send: (msg, target, wakeup) => calls.push({ target, wakeup }) }
  deliverToAgent(agent, userMessage('x'))
  check('send 的 target 是 next-turn', calls[0]?.target === 'next-turn', JSON.stringify(calls[0]))
  check('send 的 wakeup 为 true', calls[0]?.wakeup === true)
}

// 4) 源码层面：不得再出现 user-say
const src = fs.readFileSync('src/app/bridge.js', 'utf8')
check('源码不再把 user-say 当来源', !src.includes("kind: 'user-say'"))
check('源码不再把 allowed 当结局', !/return 'allowed'/.test(src))

console.log('\n' + (failures.length === 0 ? 'S49 PASS' : 'S49 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
