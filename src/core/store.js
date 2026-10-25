/**
 * 落盘：单个 JSON 文件 + 原子写（写临时文件再 rename）。
 *
 * 为什么不用数据库：单用户、数据量几十条；换来的复杂度不值得（ADR-05）。
 * 读坏文件不许崩：把它改名成 `.bad-<ts>` 继续跑——丢历史好过起不来。
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export const EMPTY_STATE = {
  version: 1,
  waitPoints: [],
  deliveries: {},
  interruption: null,
}

export class JsonStore {
  constructor(file) {
    this.file = file
    this.dir = path.dirname(file)
  }

  async load() {
    try {
      const raw = await fsp.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      return { ...EMPTY_STATE, ...parsed }
    } catch (err) {
      if (err?.code === 'ENOENT') return { ...EMPTY_STATE }
      // 坏文件：留证据、重置
      try {
        await fsp.rename(this.file, `${this.file}.bad-${Date.now()}`)
      } catch {
        /* ignore */
      }
      return { ...EMPTY_STATE, corrupt: String(err?.message ?? err) }
    }
  }

  async save(state) {
    await fsp.mkdir(this.dir, { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`
    const body = JSON.stringify(state, null, 2)
    await fsp.writeFile(tmp, body, 'utf8')
    await fsp.rename(tmp, this.file)
    return this.file
  }
}

/** 默认位置：%LOCALAPPDATA%\qq-bridge\state.json（可被配置覆盖）。 */
export function defaultStatePath() {
  const base = process.env.LOCALAPPDATA || process.env.TMPDIR || process.cwd()
  return path.join(base, 'qq-bridge', 'state.json')
}

export function ensureSyncDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}
