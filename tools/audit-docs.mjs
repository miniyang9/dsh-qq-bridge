/**
 * 文档回溯：把「已签 frame」与「当前实现」对一遍，找出需求级偏差。
 * 只读，不改任何文件。
 */
import fs from 'node:fs'
import { parseCommand } from '../src/transport/envelope.js'

const frame = fs.readFileSync('docs/frame/qq-bridge.md', 'utf8')
const env = fs.readFileSync('src/transport/envelope.js', 'utf8')
const findings = []
const note = (level, text) => findings.push({ level, text })

// 1) 命令集：frame 里 D21 表列出的命令 vs 解析器支持的
const cmds = ['/list', '/progress', '/new', '/use', '/wake', '/say', '/why', '/done', '/ans', '/yes', '/no', '/doctor']
for (const c of cmds) {
  const inFrame = frame.includes(`\`${c}`) || frame.includes(`${c} <`) || frame.includes(`${c}\``)
  const parsed = parseCommand(`${c} 1 x`).kind !== 'unknown' || parseCommand(c).kind !== 'unknown'
  if (parsed && !inFrame) note('REQ', `${c} 已实现但 frame 未列（封闭命令集被扩展）`)
  if (!parsed && c !== '/doctor') note('BUG', `${c} frame 里有但解析器不认`)
}

// 2) A1 时延 vs 合并窗口
const m = /合并窗口|mergeMs\s*=\s*(\d+)|mergeMs: config\.mergeMs \?\? (\d+)/.exec(fs.readFileSync('lib/index.js', 'utf8'))
const mergeMs = m ? Number(m[2] ?? m[1]) : 0
if (mergeMs > 0) note('INFO', `卡片合并窗口 ${mergeMs}ms：A1 要求热路径 ≤10s，仍满足；但通知会比逐条发送晚 ${mergeMs}ms`)

// 3) A24 通知内容：frame 只规定时延与条数
if (fs.readFileSync('src/app/bridge.js', 'utf8').includes('本轮 ${this.#minutes(st)} 分钟')) {
  note('REQ', '通知正文增加「[标题 · id] + 本轮 N 分钟 + 摘要」：frame A24 未规定文案，属新增内容，需在文档登记')
}

// 4) 短 id 作为参数（frame 的 D20/D21 只写序号）
if (env.includes('use: /^\\/use\\s+(\\S+)') && frame.includes('/use <n>')) {
  note('INFO', '/use、/wake、/progress 等接受短 id：frame 写的是序号，属参数放宽（超集），建议登记')
}

// 5) 架构文档是否提到新增能力
const arch = fs.readFileSync('docs/arch/qq-bridge/01-architecture.md', 'utf8')
for (const k of ['/doctor', 'mergeMs', '合并窗口', 'resolveAgent', '短 id']) {
  if (!arch.includes(k)) note('DOC', `01-architecture 未提及 ${k}`)
}
const contracts = fs.readFileSync('docs/arch/qq-bridge/02-contracts.md', 'utf8')
if (!contracts.includes('/doctor')) note('DOC', '02 的 QqEnvelope 命令集未包含 /doctor（封闭集合已变）')

console.log(findings.map((f) => `[${f.level}] ${f.text}`).join('\n'))
console.log('\n合计', findings.length, '条')
const req = findings.filter((f) => f.level === 'REQ').length
console.log('需求级偏差:', req)
