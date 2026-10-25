/**
 * S8 验收：Event 落地 + 审计（A26）
 */
import fs from 'node:fs'
import path from 'node:path'

const failures = []
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures.push(label)
}

const { makeEvent, approvalEvent, isEvent, EVENT_KINDS } = await import('../src/core/events.js')
const { Audit, RETENTION_DAYS } = await import('../src/app/audit.js')
const { Bridge } = await import('../src/app/bridge.js')

// --- Event ---
check(JSON.stringify(EVENT_KINDS) === '["approval","question","turn","notice"]', 'kind 是封闭四值')
let threw = false
try { makeEvent({ kind: 'nope' }) } catch { threw = true }
check(threw, '未知 kind 抛错')
threw = false
try { makeEvent({ kind: 'approval' }) } catch { threw = true }
check(threw, 'approval 缺 requestId 抛错')
threw = false
try { makeEvent({ kind: 'turn' }) } catch { threw = true }
check(threw, 'turn 缺 turnId 抛错')

const ev = approvalEvent({ callId: 'c1', toolName: 'fs.write', reason: 'r', args: { path: 'x' }, agent: { session: { id: 's' } } })
check(ev.kind === 'approval' && ev.requestId === 'c1', 'approvalEvent 带上 requestId')
check(isEvent(ev) === true, 'isEvent 认可')
check(isEvent({}) === false, 'isEvent 拒绝普通对象')

// --- Audit ---
const TMP = path.join('C:/Project/WatchDog/.tmp/s8')
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })
const file = path.join(TMP, 'audit.jsonl')

const audit = new Audit(file)
await audit.append({ requestId: 'wp-1', openid: 'u1', at: Date.now(), card: { text: '卡片', labeled: true }, outcome: 'approve' })
await audit.append({ requestId: 'wp-2', openid: 'u1', card: null })
const all = await audit.readAll()
check(all.length === 2, '两条记录')
check(all[0].requestId === 'wp-1' && all[0].openid === 'u1', '记录含 requestId/openid')
check(all[0].card?.text === '卡片', '记录含卡片快照')
check(all.every((e) => 'evidenceViewed' in e), '记录含 evidenceViewed 字段')
check(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length === 2, '一行一条 JSONL')

// 保留期
const old = new Audit(file)
await old.append({ requestId: 'wp-old', at: Date.now() - (RETENTION_DAYS + 1) * 86400_000 })
const removed = await old.prune()
const kept = await old.readAll()
check(removed === 1, '过期记录被 prune 掉', String(removed))
check(!kept.some((e) => e.requestId === 'wp-old'), '过期记录不在文件里')

// --- 集成：答复触发审计 ---
{
  const sent = []
  const client = {
    on() {}, async start() {}, async stop() {},
    async sendPassive(a) { sent.push(a.content); return { id: 'p' } },
    async sendProactive(a) { sent.push(a.content); return { id: 'a' } },
  }
  const statePath = path.join(TMP, 'state.json')
  const b = new Bridge({
    appId: 'x', appSecret: 'y', allowlist: ['u1'], client, statePath,
    log: { info() {}, error() {} },
  })
  await b.start()
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm0', content: 'go', author: { user_openid: 'u1' } } })
  const p = b.handleApproval({ agent: { session: { id: 's' } }, toolName: 'fs.read', args: {} }, { timeoutMs: 2000 })
  await new Promise((r) => setTimeout(r, 10))
  await b.onEvent({ type: 'C2C_MESSAGE_CREATE', data: { id: 'm1', content: '1', author: { user_openid: 'u1' } } })
  await p
  const entries = await new Audit(path.join(TMP, 'audit.jsonl')).readAll()
  const last = entries.at(-1)
  check(entries.length >= 1, '答复后写了审计', String(entries.length))
  check(last?.card?.text?.includes('需要你批准'), '审计里有当时的卡片原文', (last?.card?.text ?? '').slice(0, 20))
  check(last?.openid === 'u1', '审计里有 openid')
}

console.log(`\n${failures.length === 0 ? 'S8 PASS' : 'S8 FAIL'}  (${failures.length} 条失败)`)
process.exit(failures.length === 0 ? 0 : 1)
