/**
 * 运行日志（A2 / W9）
 *
 * 为什么单独一个文件而不是只靠审计：
 *   - 审计（audit.jsonl）只记"决定"，且 180 天保留；
 *   - 运行日志要能回答"这条消息什么时候进来、什么时候出去、发给谁"，用于排查
 *     "手机没收到""消息串台"这类问题，黑盒用例的 L 证据也指向它。
 *
 * 格式：每行一个 JSON：{ ts, dir, kind, openid, requestId, detail }
 *   dir=in  入站命令；dir=out 出站消息；dir=err 异常
 * 轮转：单文件超过 maxBytes 就改名为 .1/.2…（保留 keep 份）。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export function defaultLogPath() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  return path.join(base, 'qq-bridge', 'bridge.log')
}

export class BridgeLog {
  constructor(file = defaultLogPath(), { maxBytes = 5 * 1024 * 1024, keep = 3 } = {}) {
    this.file = file
    this.maxBytes = maxBytes
    this.keep = keep
  }

  #rotateIfNeeded() {
    try {
      const st = fs.statSync(this.file)
      if (st.size < this.maxBytes) return
    } catch {
      return // 文件不存在，无需轮转
    }
    try {
      for (let i = this.keep - 1; i >= 1; i -= 1) {
        const from = `${this.file}.${i}`
        const to = `${this.file}.${i + 1}`
        if (fs.existsSync(from)) fs.renameSync(from, to)
      }
      fs.renameSync(this.file, `${this.file}.1`)
    } catch {
      /* 轮转失败不影响写日志 */
    }
  }

  /** 同步追加一行；失败静默（日志不能反过来搞崩主流程）。 */
  write({ dir, kind, openid = null, requestId = null, detail = null }) {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      dir,
      kind,
      openid,
      requestId,
      detail,
    })
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      this.#rotateIfNeeded()
      fs.appendFileSync(this.file, line + '\n', 'utf8')
    } catch {
      /* ignore */
    }
  }

  readAll() {
    try {
      return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    } catch {
      return []
    }
  }
}
