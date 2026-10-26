/**
 * 黑盒执行夹具的复位工具（对应用例集 FQ-0 / FQ-3 / FQ-7）
 *
 * 用法：
 *   node tools/bb-reset.mjs            # 归档现有 state/audit，再从空状态开始
 *   node tools/bb-reset.mjs --keep     # 只备份，不删除
 *
 * 它只动 %LOCALAPPDATA%\qq-bridge\ 下的三样东西：
 *   state.json / state.audit.jsonl
 * 备份目录带时间戳，绝不覆盖既有备份。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const dir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'qq-bridge')
const keep = process.argv.includes('--keep')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = path.join(dir, `backup-${stamp}`)

const files = ['state.json', 'state.audit.jsonl', 'bridge.log', 'bridge.log.1']
fs.mkdirSync(dir, { recursive: true })

let moved = 0
for (const f of files) {
  const src = path.join(dir, f)
  if (!fs.existsSync(src)) continue
  fs.mkdirSync(backup, { recursive: true })
  fs.copyFileSync(src, path.join(backup, f))
  if (!keep) fs.rmSync(src)
  moved += 1
}

console.log(`目录: ${dir}`)
console.log(`已处理文件: ${moved}/${files.length}`)
if (moved > 0) console.log(`备份: ${backup}`)
console.log(keep ? '（--keep：原件保留）' : '（已清空，桥接下次启动从零开始）')
