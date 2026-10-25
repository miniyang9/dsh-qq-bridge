/**
 * 修复被写坏的 session/title 事件（备份 → 逐帧修复 → 校验）。
 *
 * 背景：桥接最初写 session/title 时只给了 {title}，缺 messageSeqs 与 source，
 * 导致整段日志在加载时报 SessionFormatError: title messageSeqs requires an array。
 *
 * 为什么逐帧：DSH 的 .jsonl.zstd 是**多帧追加**写的。把全部帧解压后合并成一个新帧
 * 虽然读得到，但改变了追加结构；这里保持"一帧对一帧"，只重写含坏事件的那一帧。
 *
 * 用法：
 *   node tools/repair-title.mjs --dry
 *   node tools/repair-title.mjs
 *   node tools/repair-title.mjs --session 3789cd
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'

const dry = process.argv.includes('--dry')
const si = process.argv.indexOf('--session')
const only = si >= 0 ? process.argv[si + 1] : null
const root = path.join(os.homedir(), '.dsh', 'sessions')
const MAGIC = 0xfd2fb528

/** 按 zstd magic 切帧；返回原始 buffer 切片，避免解压再压缩的损失。 */
function splitFrames(buf) {
  const starts = []
  for (let i = 0; i + 3 < buf.length; i += 1) {
    if (buf.readUInt32LE(i) === MAGIC) starts.push(i)
  }
  if (starts.length === 0 || starts[0] !== 0) starts.unshift(0)
  const frames = []
  for (let k = 0; k < starts.length; k += 1) {
    const s = starts[k]
    const e = k + 1 < starts.length ? starts[k + 1] : buf.length
    if (e > s) frames.push(buf.subarray(s, e))
  }
  return frames
}

function fixLine(line) {
  if (!line.includes('session/title')) return { line, fixed: false }
  try {
    const ev = JSON.parse(line)
    if (ev?.type !== 'session/title') return { line, fixed: false }
    const d = ev.data ?? {}
    if (Array.isArray(d.messageSeqs) && d.source) return { line, fixed: false }
    const repaired = JSON.stringify({
      ...ev,
      data: {
        title: typeof d.title === 'string' && d.title ? d.title : 'QQ',
        messageSeqs: Array.isArray(d.messageSeqs) ? d.messageSeqs : [],
        source: d.source ?? { kind: 'user' },
      },
    })
    return { line: repaired, fixed: true }
  } catch {
    return { line, fixed: false }
  }
}

let scanned = 0
let files = 0
let badEvents = 0

for (const proj of fs.readdirSync(root)) {
  const projDir = path.join(root, proj)
  if (!fs.statSync(projDir).isDirectory()) continue
  for (const sess of fs.readdirSync(projDir)) {
    if (only && !sess.includes(only)) continue
    const file = path.join(projDir, sess, 'session.v4.jsonl.zstd')
    if (!fs.existsSync(file)) continue
    scanned += 1

    const buf = fs.readFileSync(file)
    let touched = false
    let localBad = 0
    const rebuilt = splitFrames(buf).map((frame) => {
      let text = ''
      try {
        text = zlib.zstdDecompressSync(frame).toString('utf8')
      } catch {
        return frame
      }
      if (!text.includes('session/title')) return frame
      let localFixed = 0
      const outLines = text.split('\n').map((L) => {
        const r = fixLine(L)
        if (r.fixed) localFixed += 1
        return r.line
      })
      if (localFixed === 0) return frame
      touched = true
      localBad += localFixed
      return zlib.zstdCompressSync(Buffer.from(outLines.join('\n'), 'utf8'))
    })

    if (!touched) continue
    files += 1
    badEvents += localBad
    console.log(`${dry ? '待修' : '修复'}  ${sess}（坏事件 ${localBad} 处）`)
    if (dry) continue

    fs.copyFileSync(file, `${file}.bak-${Date.now()}`)
    fs.writeFileSync(file, Buffer.concat(rebuilt))
  }
}

console.log(`\n扫描 ${scanned} 个会话；需修 ${files} 个文件；坏 title 事件 ${badEvents} 处${dry ? '（dry-run，未写入）' : ''}`)
