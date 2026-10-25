/**
 * S3 验收：Bridge → QQ 卡片 → 你的回复 → outcome
 *
 * 说明：本脚本直接驱动 Bridge（不经过 cordis），因为要用普通 node 跑才能在后台
 * 抓到输出。"插件 handler 注册并委托给 Bridge" 已由 S1 的 tester 覆盖，这里不重复。
 *
 * 步骤：
 *   1. 你在 QQ 里发一句 `go`（给自己一个被动窗口）
 *   2. 脚本把审批卡片作为被动回复发给你
 *   3. 你回 `1`（批准）→ 打印 outcome 与耗时
 */
import fs from 'node:fs'

const kv = {}
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
  if (m) kv[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const { Bridge } = await import('file:///src/app/bridge.js')

const bridge = new Bridge({
  appId: kv.AppID,
  appSecret: kv.AppSecret,
  allowlist: [kv.QQ_ALLOWLIST],
  log: console,
})

const waitFor = async (pred, ms) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (pred()) return true
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

await bridge.start()
console.log('等待通道 ready …')
if (!(await waitFor(() => bridge.client.state === 'ready', 30_000))) {
  console.error('通道没 ready，状态 = ' + bridge.client.state)
  process.exit(1)
}
console.log('ready。请在 QQ 里给机器人发一句：go')

if (!(await waitFor(() => bridge.lastMsgId !== null, 180_000))) {
  console.error('等了 3 分钟没收到你的消息')
  process.exit(1)
}
console.log('收到你的消息，发起一次合成审批 …')

const t0 = Date.now()
const outcome = await bridge.handleApproval(
  {
    agent: { session: { id: 's3-synthetic' } },
    toolName: 'fs.write',
    callId: 's3-call-1',
    reason: 'S3 合成审批：写工作区外文件',
    args: 'C:\\Windows\\s3-demo.txt',
    target: '工作区外',
    reversible: false,
  },
  { timeoutMs: 180_000 },
)
const ms = Date.now() - t0

const wp = bridge.points.list().at(-1)
console.log(`\noutcome = ${outcome}   耗时 = ${ms}ms`)
console.log(`waitpoint = ${JSON.stringify({ id: wp?.id, status: wp?.status, answer: wp?.answer?.text })}`)

const ok = outcome === 'allowed'
console.log(ok ? '\nS3 PASS' : '\nS3 FAIL（期望 allowed）')
await bridge.client.stop()
process.exit(ok ? 0 : 1)
