import './_setup.mjs'
/**
 * 黑盒执行 · 第一批：命令格式与负例
 * 覆盖 BB-11 / BB-23 / BB-57 / BB-74
 *
 * 只驱动"用户可见的入口"（QQ 入站消息 → 回话），不直接调用内部函数。
 * 传输层用假客户端（手机侧不可脚本化），断言只针对回话文本与状态变化。
 */
import fs from 'node:fs'

const results = []
const check = (id, ok, label, detail = '') => {
  results.push({ id, ok, label, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  — ' + detail : ''}`)
}

const { Bridge } = await import('../src/app/bridge.js')

function makeBridge(opts = {}) {
  const sent = []
  const client = {
    on() {}, async start() {}, async stop() {},
    async sendPassive(a) { sent.push(a.content); return { id: 'p' } },
    async sendProactive(a) { sent.push(a.content); return { id: 'a' } },
  }
  const b = new Bridge({
    appId: 'x', appSecret: 'y', allowlist: ['u1'], client,
    statePath: `.tmp/bb-${Date.now()}-${Math.random()}.json`,
    sessionsRoot: '.tmp/fake-none',
    log: { info() {}, error() {} },
    ...opts,
  })
  const inbound = (content, id) => b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id, content, author: { user_openid: 'u1' } } })
  return { b, sent, inbound }
}

// ---------- BB-11：审批不接受文字答复 ----
{
  const { b, sent, inbound } = makeBridge()
  await b.start()
  const p = b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.write', args: {} }, { timeoutMs: 1500 })
  await new Promise((r) => setTimeout(r, 10))
  const id = b.points.list().at(-1).id
  await inbound(`/ans ${id} 这是自由文本`, 'm1')
  const reply = sent.at(-1) ?? ''
  const hit = /仅限提问|不支持文本答复/.test(reply)
  check('BB-11', hit, '审批收到文字答复时给出固定拒绝语', reply.slice(0, 60))
  check('BB-11', b.points.get(id).status === 'open', 'P3 状态变化 0 次（仍 open）', b.points.get(id).status)
  b.points.drop(id, 'cleanup')
  await p.catch(() => {})
}

// ---------- BB-23：裸数字 / 无斜杠文本一律不生效 ----
{
  const { b, sent, inbound } = makeBridge()
  await b.start()
  const p = b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.write', args: {} }, { timeoutMs: 1500 })
  await new Promise((r) => setTimeout(r, 10))
  const id = b.points.list().at(-1).id
  const before = sent.length
  for (const [i, cmd] of ['1', 'yes P1', '进度', '帮助'].entries()) await inbound(cmd, `n${i}`)
  const replies = sent.slice(before)
  check('BB-23', replies.length === 4, '4/4 收到回话', String(replies.length))
  check('BB-23', b.points.get(id).status === 'open', 'P1 状态变化 0 次', b.points.get(id).status)
  check('BB-23', !replies.some((r) => r.includes('待答请求：')), '未触发进度输出')
  b.points.drop(id, 'cleanup')
  await p.catch(() => {})
}

// ---------- BB-57：6 种未定义形式 ----
{
  const { b, sent, inbound } = makeBridge()
  await b.start()
  const p = b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.write', args: {} }, { timeoutMs: 1500 })
  await new Promise((r) => setTimeout(r, 10))
  const id = b.points.list().at(-1).id
  const before = sent.length
  for (const [i, cmd] of ['1', '2', 'yes P1', '完成了吗', '进度', '/unknown cmd'].entries()) await inbound(cmd, `u${i}`)
  const replies = sent.slice(before)
  check('BB-57', replies.length === 6, '6/6 收到回话', String(replies.length))
  check('BB-57', b.points.get(id).status === 'open', '业务状态变化 0 次', b.points.get(id).status)
  check('BB-57', !replies.some((r) => r.includes('SECRETZ')), 'SECRETZ 出现 0 处')
  b.points.drop(id, 'cleanup')
  await p.catch(() => {})
}

// ---------- BB-74：未识别命令与不存在 id 的披露检查 ----
{
  const { b, sent, inbound } = makeBridge()
  await b.start()
  const before = sent.length
  for (const [i, cmd] of ['help', '/yes 999', '/why 999 q', '/done 999'].entries()) await inbound(cmd, `d${i}`)
  const replies = sent.slice(before)
  check('BB-74', replies.length === 4, '4/4 收到回话', String(replies.length))
  check('BB-74', !replies.some((r) => r.includes('SECRETZ')), 'SECRETZ 泄露 0 处')
  check('BB-74', !replies.some((r) => /[A-Za-z]:\\/.test(r)), '绝对路径 0 处', replies.find((r) => /[A-Za-z]:\\/.test(r)) ?? '')
  check('BB-74', replies.every((r) => r.length <= 200), '每条 ≤200 字', replies.map((r) => r.length).join(','))
}

const fail = results.filter((r) => !r.ok)
console.log(`\n${fail.length === 0 ? 'BATCH-1 PASS' : 'BATCH-1 FAIL'}  (${results.length - fail.length}/${results.length})`)
fs.writeFileSync('.tmp/bb-batch1.json', JSON.stringify(results, null, 2))
process.exit(fail.length === 0 ? 0 : 1)
