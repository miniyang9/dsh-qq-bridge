/**
 * LabelPolicy（契约 6）· 只决定"标不标"，不决定"能不能批"（ADR-12/15）
 *
 * 三条判据，顺序即优先级：
 *   1. 调用参数里出现 `sandbox_permissions`   → escalation
 *   2. 工具名命中短白名单（≤5 条）            → whitelist
 *   3. 参数里的目标路径在工作区之外且是写操作  → outside-workspace
 * 其余一律不标（默认 reversible）。
 *
 * 判据 1、3 需要工具参数；审批请求本身**不带参数**（S6 实测），
 * 参数要从会话的 `tool/call` 事件按 callId 反查。
 */
const OUTSIDE_KEYS = ['path', 'filePath', 'file', 'target', 'dest', 'destination', 'cwd', 'dir']
const WRITE_TOOLS = /write|edit|create|delete|remove|move|rename|mkdir|rm|mv|cp|pull|push/i

export function classify({ toolName, args, workspaceRoot, whitelist = [] } = {}) {
  if (args && typeof args === 'object' && args.sandbox_permissions !== undefined) {
    return { labeled: true, reason: 'escalation' }
  }
  if (whitelist.includes(toolName)) return { labeled: true, reason: 'whitelist' }
  if (isOutsideWrite({ toolName, args, workspaceRoot })) return { labeled: true, reason: 'outside-workspace' }
  return { labeled: false, reason: null }
}

/** 只看"参数里明确指向的路径"，不做内容扫描——避免把普通文本误判成路径。 */
export function isOutsideWrite({ toolName, args, workspaceRoot } = {}) {
  if (!args || typeof args !== 'object' || !workspaceRoot) return false
  if (!WRITE_TOOLS.test(String(toolName ?? ''))) return false
  const root = normalize(workspaceRoot)
  for (const key of OUTSIDE_KEYS) {
    const v = args[key]
    if (typeof v !== 'string' || v.length === 0) continue
    const p = normalize(v)
    if (!isAbsolute(p)) continue
    if (!p.startsWith(root)) return true
  }
  return false
}

function normalize(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function isAbsolute(p) {
  return /^[a-z]:\//i.test(p) || p.startsWith('/')
}

/**
 * 从会话事件里按 callId 反查工具参数（S6 实测：审批请求不带参数）。
 * session 需要支持 eventAt(seq) 与 seq；拿不到就返回 undefined（上层按"未附"渲染）。
 */
export function findToolArgs(session, callId) {
  if (!session || callId === undefined || typeof session.eventAt !== 'function') return undefined
  const end = Number(session.seq ?? 0)
  for (let i = end - 1; i >= 0 && i >= end - 200; i -= 1) {
    const ev = session.eventAt(i)
    if (ev?.type === 'tool/call' && ev?.data?.callId === callId) {
      const raw = ev.data.arguments
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw)
        } catch {
          return { _raw: raw }
        }
      }
      return raw
    }
  }
  return undefined
}
