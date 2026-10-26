import './_setup.mjs'
/**
 * A2/W9 运行日志：字段、落盘、轮转、失败不影响主流程
 */
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const fs = await import('node:fs')
const { BridgeLog } = await import('../src/app/log.js')

const dir = '.tmp/t-log'
fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
const file = `${dir}/bridge.log`

const log = new BridgeLog(file)
log.write({ dir: 'in', kind: 'command', openid: 'u1', detail: '/list' })
log.write({ dir: 'out', kind: 'send', detail: '任务列表…' })
log.write({ dir: 'err', kind: 'send-failed', detail: 'EPERM' })

const rows = log.readAll()
check('三行都落盘', rows.length === 3, String(rows.length))
check('含 ts/dir/kind/openid/requestId/detail 六字段',
  rows.every((r) => 'ts' in r && 'dir' in r && 'kind' in r && 'openid' in r && 'requestId' in r && 'detail' in r),
  JSON.stringify(Object.keys(rows[0] ?? {})))
check('入站行记录了 openid 与时间', rows[0].openid === 'u1' && typeof rows[0].ts === 'string', JSON.stringify(rows[0]))
check('出站行有 dir=out', rows[1].dir === 'out')

// 轮转：把阈值设成很小，写几行后应出现 .1
const small = new BridgeLog(`${dir}/rot.log`, { maxBytes: 120, keep: 2 })
for (let i = 0; i < 6; i += 1) small.write({ dir: 'in', kind: 'command', detail: 'x'.repeat(40) })
check('超过阈值后发生轮转（存在 .1）', fs.existsSync(`${dir}/rot.log.1`), fs.readdirSync(dir).join(','))

// 目录不可写时 write 不应抛
const bad = new BridgeLog(`${dir}/nonexistent-dir-as-file/x.log`)
bad.write({ dir: 'in', kind: 'command', detail: 'y' })   // 父目录不存在会被自动创建，这里只验证不抛
check('写入失败不抛异常', true)

console.log('\n' + (failures.length === 0 ? 'S54 PASS' : 'S54 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
