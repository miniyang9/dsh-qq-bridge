/**
 * 会话盘点：直接读 DSH 的会话库（`~/.dsh/sessions/<project>/<id>/session.*.jsonl*`）。
 *
 * 为什么读盘而不是问服务：远程工作时你要的是"**全部任务**"，不是"这次启动活跃过的"。
 * 服务里只有活着的会话；盘上有全部历史。代价：非运行中的会话只能看、不能 `/say`。
 */
import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'

export function defaultSessionsRoot() {
  return path.join(os.homedir(), '.dsh', 'sessions')
}

/** 标题不在会话日志里，而在投影缓存：storages/session_projcache/sessions/<id>.json → record.rows.title.val */
/** 已知工作区清单（`/new` 只允许在这里面选，不接受手打路径）。 */
export async function listKnownWorkspaces(indexFile = defaultWorkspaceIndex()) {
  try {
    const o = JSON.parse(await fsp.readFile(indexFile, 'utf8'))
    return Object.entries(o?.tables?.workspaces ?? {}).map(([id, w]) => ({ id, path: w.path }))
  } catch {
    return []
  }
}

/** 归档判定：workspace.json 里有 archivedSessionIds，这是唯一权威来源（别再靠 agentPreset 猜）。 */
export function defaultWorkspaceIndex() {
  return path.join(os.homedir(), '.dsh', 'storages', 'workspace.json')
}

function readArchived(file) {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8'))
    return new Set(o?.global?.archivedSessionIds ?? [])
  } catch {
    return new Set()
  }
}

export function defaultTitleCacheRoot() {
  return path.join(os.homedir(), '.dsh', 'storages', 'session_projcache', 'sessions')
}

/** 标题清洗：去掉尾部悬空的括号/破折号与多余空白（标题常被截断成 "…机器人 ("）。 */
export function cleanTitle(title) {
  if (typeof title !== 'string') return null
  let t = title.replace(/\s+/g, ' ').trim()
  t = t.replace(/[\s(\[（【<「—–-]+$/g, '').trim()
  return t === '' ? null : t
}

function readCachedTitle(cacheRoot, id, dirName) {
  if (!cacheRoot) return null
  for (const key of [id, dirName]) {
    if (!key) continue
    try {
      const raw = fs.readFileSync(path.join(cacheRoot, `${key}.json`), 'utf8')
      const title = cleanTitle(JSON.parse(raw)?.record?.rows?.title?.val)
      if (title) return title
    } catch {
      /* 试下一个 key */
    }
  }
  return null
}

function decodeProject(dirName) {
  // --C-Project-WatchDog-- → C:\Project\WatchDog（尽力而为，读不懂就原样返回）
  const m = /^--(.+)--$/.exec(dirName)
  return m ? m[1].replace(/-/g, '\\') : dirName
}

/**
 * 读会话头（第一行）。用来剔掉 subagent 会话——它们也在同一个库里，
 * 但不是"任务"，列出来只会把真任务淹掉。
 */
function readMeta(file) {
  try {
    const st = fs.statSync(file)
    if (st.size > 20 * 1024 * 1024) return null
    const buf = fs.readFileSync(file)
    const text = buf[0] === 0x28 ? zlib.zstdDecompressSync(buf).toString('utf8') : buf.toString('utf8')
    const lines = text.split('\n')
    const header = JSON.parse(lines[0])
    // 标题是后追加的事件（session/title），从头扫到找到为止
    let title = null
    for (let i = 1; i < lines.length; i += 1) {
      if (!lines[i]) continue
      if (!lines[i].includes('session/title')) continue
      try {
        const ev = JSON.parse(lines[i])
        if (ev?.type === 'session/title' && typeof ev?.data?.title === 'string') title = ev.data.title
      } catch {
        /* 跳过坏行 */
      }
      if (title !== null) break
    }
    return { header, title }
  } catch {
    return null
  }
}

/** 返回按修改时间倒序的会话列表。默认不含 subagent 会话。fails soft。 */
export async function listStoredSessions(root = defaultSessionsRoot(), now = Date.now(), titleCacheRoot = defaultTitleCacheRoot(), filter = {}, workspaceIndex = defaultWorkspaceIndex()) {
  let projects = []
  try {
    projects = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }

  const archived = readArchived(workspaceIndex)
  const out = []
  for (const proj of projects) {
    if (!proj.isDirectory()) continue
    const projDir = path.join(root, proj.name)
    let sessions = []
    try {
      sessions = await fsp.readdir(projDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const s of sessions) {
      if (!s.isDirectory()) continue
      const dir = path.join(projDir, s.name)
      let files = []
      try {
        files = await fsp.readdir(dir)
      } catch {
        continue
      }
      const log = files.find((f) => f.startsWith('session.') && f.includes('.jsonl'))
      if (!log) continue
      let st = null
      try {
        st = await fsp.stat(path.join(dir, log))
      } catch {
        continue
      }
      const meta = readMeta(path.join(dir, log))
      const header = meta?.header ?? null
      const isSubagent = header?.origin === 'subagent' || (header?.delegationDepth ?? 0) > 0
      if (isSubagent) continue
      // 与 GUI 对齐：只看同一个工作区；没有 agentPreset 的是 headless/脚本跑出来的，不算"任务"
      if (filter.workspaceRoot && header?.cwd !== filter.workspaceRoot) continue
      if (filter.requirePreset && header?.agentPreset == null) continue
      const id = header?.id ?? s.name
      if (filter.excludeArchived !== false && archived.has(id)) continue
      out.push({
        id,
        title: readCachedTitle(titleCacheRoot, header?.id, s.name) ?? meta?.title ?? null,
        cwd: header?.cwd ?? null,
        createdAt: header?.createdAt ?? null,
        project: decodeProject(proj.name),
        mtime: st.mtimeMs,
        ageMs: Math.max(0, now - st.mtimeMs),
        sizeBytes: st.size,
        path: dir,
      })
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

export function humanAge(ms) {
  const min = Math.round(ms / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} 小时前`
  return `${Math.round(h / 24)} 天前`
}
