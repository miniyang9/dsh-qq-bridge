/**
 * 修复被写坏的 session/title 事件（备份 → 就地修 → 校验可解析）。
 *
 * 背景：桥接最初写 session/title 时只给了 {title}，缺 messageSeqs 与 source，
 * 导致整段日志在加载时报 SessionFormatError: title messageSeqs requires an array。
 * 本工具把坏的 title 事件补成合法形状（保留原文 title），其余行一字不改。
 *
 * 用法：
 *   node tools/repair-title.mjs --dry             # 只体检，不写
 *   node tools/repair-title.mjs                   # 备份后修复
 *   node tools/repair-title.mjs --session <id>    # 只修某一个
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'

const dry = process.argv.includes('--dry')
const only = process.argv.indexOf('--session') >= 0 ? process.argv[process.argv.indexOf('--session') + 1] : null
const root = path.join(os.homedir(), '.dsh', 'sessions')

function frames(buf) {
  // 逐个 zstd 帧解压（DSH 的日志是多帧追加写的）
  const out = []
  let off = 0
  while (off < buf.length) {
    const magic = buf.readUInt32LE(off)
    if (magic !== 0xfd2fb528) break
    let end = buf.length
    for (let i = off + 4; i + 3 < buf.length; i += 1) {
      if (buf.readUInt32LE(i) === 0xfd2fb528) { end = i; break }
    }
    const slice = buf.subarray(off, end)
    try {
      out.push(zlib.zstdDecompressSync(slice).toString('utf8'))
      off = end
    } catch {
      break
    }
  }
  return out
}

let scanned = 0
let broken = 0
let fixed = 0

for (const proj of fs.readdirSync(root)) {
  const projDir = path.join(root, proj)
  if (!fs.statSync(projDir).isDirectory()) continue
  for (const sess of fs.readdirSync(projDir)) {
    if (only && !sess.includes(only)) continue
    const file = path.join(projDir, sess, 'session.v4.jsonl.zstd')
    if (!fs.existsSync(file)) continue
    scanned += 1

    const buf = fs.readFileSync(file)
    const parts = frames(buf)
    let text = parts.join('')
    if (!text.includes('session/title')) continue

    const lines = text.split('\n')
    let dirty = false
    const out = lines.map((L) => {
      if (!L.includes('session/title')) return L
      try {
        const ev = JSON.parse(L)
        if (ev?.type !== 'session/title') return L
        const d = ev.data ?? {}
        if (Array.isArray(d.messageSeqs) && d.source) return L
        broken += 1
        dirty = true
        return JSON.stringify({
          ...ev,
          data: {
            title: typeof d.title === 'string' && d.title ? d.title : 'QQ',
            messageSeqs: Array.isArray(d.messageSeqs) ? d.messageSeqs : [],
            source: d.source ?? { kind: 'user' },
          },
        })
      } catch {
        return L
      }
    })

    if (!dirty) continue
    console.log(`${dirty ? '待修' : '正常'}  ${sess}`)
    if (dry) continue

    fs.copyFileSync(file, `${file}.bak-${Date.now()}`)
    const rebuilt = out.join('\n')
    fs.writeFileSync(file, zlib.zstdCompressSync(Buffer.from(rebuilt, 'utf8')))
    fixed += 1
  }
}

console.log(`\n扫描 ${scanned} 个会话；坏 title 事件 ${broken} 处；已修 ${fixed} 个文件${dry ? '（dry-run，未写入）' : ''}`)
