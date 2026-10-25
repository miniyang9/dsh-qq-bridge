/**
 * S3 回归：同一条入站消息的多次回复必须递增 msg_seq，用满 4 次转主动消息。
 *
 * 背景：QQ 会把 msg_id + msg_seq 相同的回复当重复丢弃（HTTP 仍可能返回 200），
 * 表现就是"卡片到了、确认没到"。这条测试盯住这个坑。
 */
const failures = []
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures.push(label)
}

const { Bridge } = await import('../src/app/bridge.js')

const calls = []
const fakeClient = {
  started: false,
  on() {},
  async start() { this.started = true },
  async stop() {},
  async sendPassive(args) { calls.push({ kind: 'passive', ...args }); return { id: 'p' } },
  async sendProactive(args) { calls.push({ kind: 'proactive', ...args }); return { id: 'a' } },
}

const bridge = new Bridge({ appId: 'x', appSecret: 'y', allowlist: ['u1'], client: fakeClient, log: { info() {}, error() {} } })
await bridge.start()

await bridge.send('一', 'm1')
await bridge.send('二', 'm1')
await bridge.send('三', 'm1')
await bridge.send('四', 'm1')
await bridge.send('五', 'm1')

check(calls[0].msgSeq === 1, '第一条 msg_seq=1', String(calls[0].msgSeq))
check(calls[1].msgSeq === 2, '第二条 msg_seq=2', String(calls[1].msgSeq))
check(calls[2].msgSeq === 3 && calls[3].msgSeq === 4, '三、四条递增到 4', calls.map((c) => c.msgSeq).join(','))
check(calls[4].kind === 'proactive', '第五条转主动消息（超过 4 次）', calls[4].kind)
check(calls.filter((c) => c.kind === 'passive').length === 4, '被动回复正好 4 条')

// 不同 msg_id 各自计数
await bridge.send('另一条', 'm2')
check(calls.at(-1).msgSeq === 1, '换 msg_id 重新从 1 计数', String(calls.at(-1).msgSeq))

console.log(`\n${failures.length === 0 ? 'S3-seq PASS' : 'S3-seq FAIL'}  (${failures.length} 条失败)`)
process.exit(failures.length === 0 ? 0 : 1)
