/**
 * QqEnvelope（契约 7）· 卡片渲染与命令解析
 *
 * 两条铁律：
 *   1. 入站解析失败**不得推定 approve** —— 返回 { kind: 'unknown' }，由上层回提示，状态一律不动。
 *   2. 卡片只陈述事实，不许出现风险评级词（frame A25 的五词表）。
 */

const FORBIDDEN_WORDS = ['危险', '谨慎', '注意', '不建议', '风险']
const MAX_CARD_CHARS = 800

const COMMANDS = {
  yes: /^\/yes\s+(\S+)\s*$/i,
  no: /^\/no\s+(\S+)\s*$/i,
  ans: /^\/ans\s+(\S+)\s+([\s\S]+)$/i,
  why: /^\/why(?:\s+(\S+))?(?:\s+([\s\S]+))?\s*$/i,
  say: /^\/say(?:\s+(\S+))?\s+([\s\S]+)$/i,
  done: /^\/done(?:\s+(\S+))?\s*$/i,
  use: /^\/use\s+(\S+)\s*$/i,
  wake: /^\/wake(?:\s+(\S+))?\s*$/i,
  new: /^\/new(?:\s+(\S+))?\s*$/i,
  list: /^\/list\s*$/i,
  mode: /^\/mode\s*$/i,
  pc: /^\/pc(?:\s+(\d+))?\s*$/i,
  away: /^\/away\s*$/i,
  auto: /^\/auto\s*$/i,
  more: /^\/more(?:\s+(\S+))?\s*$/i,
  progress: /^\/progress(?:\s+(\S+))?\s*$/i,
}

/** 提问型卡片：问题 + 选项 + 回答命令。 */
export function renderQuestionCard(waitPoint) {
  const wp = waitPoint ?? {}
  const q = wp.question ?? {}
  const id = wp.id ?? '<id>'
  const lines = [`[${id}] 需要你回答：${q.question ?? ''}`]
  if (q.detail) lines.push(`背景：${q.detail}`)
  const options = (q.options ?? []).map((o, i) => `${i + 1}) ${o.label}`)
  if (options.length > 0) lines.push('选项：' + options.join('  '))
  lines.push(options.length > 0 ? `改：/ans ${id} <序号>，或 /ans ${id} <你的回答>` : `改：/ans ${id} <你的回答>`)
  const text = lines.join('\n')
  return {
    text: text.length > MAX_CARD_CHARS ? text.slice(0, MAX_CARD_CHARS - 1) + '…' : text,
    truncated: text.length > MAX_CARD_CHARS,
    leakedRating: FORBIDDEN_WORDS.filter((w) => text.includes(w)),
  }
}

/** 出站卡片：只有事实字段，没有评级。 */
export function renderCard(waitPoint) {
  const wp = waitPoint ?? {}
  const id = wp.id ?? '<id>'
  const facts = []
  if (wp.toolName) facts.push(`工具：${wp.toolName}`)
  if (wp.reason) facts.push(`理由：${wp.reason}`)
  facts.push(`参数：${wp.args === undefined || wp.args === null || wp.args === '' ? '未附' : String(wp.args)}`)
  facts.push(`影响范围：${wp.target ?? '未判定'}`)
  facts.push(`可撤回：${wp.reversible === false ? '否' : wp.reversible === true ? '是' : '未判定'}`)

  const options = Array.isArray(wp.options) && wp.options.length > 0
    ? '选项：' + wp.options.map((o, i) => `${i + 1}) ${o}`).join('  ')
    : ''

  const labeled = wp.labeled === true
  const missing = wp.evidenceMissing === true
const viewed = wp.evidenceViewed === true
facts.push(`现场：${missing ? '暂不可查（咨询不可用）' : viewed ? '已查看' : '未查看（可发 /why 查看）'}`)
  const hint = labeled && missing
    ? `改：/yes ${id} 批准 ｜ /no ${id} 拒绝（此请求不可逆，只认 /yes；现场暂不可查：咨询不可用）`
    : labeled
    ? `改：/yes ${id} 批准 ｜ /no ${id} 拒绝 ｜ /why ${wp.whyTarget ?? id} 看现场（此请求不可逆，只认 /yes）`
    : wp.evidenceMissing
      ? `改：/ans ${id} 1 批准 ｜ /ans ${id} 2 拒绝 ｜ /why ${wp.whyTarget ?? id} 看现场（现场暂不可查）`
      : `改：/ans ${id} 1 批准 ｜ /ans ${id} 2 拒绝 ｜ /why ${wp.whyTarget ?? id} 看现场`

  const text = [`[${id}] ${wp.title ?? wp.toolName ?? '待答'}`, ...facts, options, hint].filter(Boolean).join('\n')
  return {
    text: text.length > MAX_CARD_CHARS ? text.slice(0, MAX_CARD_CHARS - 1) + '…' : text,
    truncated: text.length > MAX_CARD_CHARS,
    leakedRating: FORBIDDEN_WORDS.filter((w) => text.includes(w)),
  }
}

/**
 * 入站命令解析。D21：**不带 `/` 的文本没有路由语义**，一律 unknown。
 * 返回的 kind 是封闭集合；上层据此分派。
 */
export function parseCommand(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return { kind: 'unknown', reason: 'empty' }
  if (!raw.startsWith('/')) return { kind: 'unknown', reason: 'not-a-command' }

  const yes = COMMANDS.yes.exec(raw)
  if (yes) return { kind: 'confirm', id: yes[1] }

  const no = COMMANDS.no.exec(raw)
  if (no) return { kind: 'reject', id: no[1] }

  const ans = COMMANDS.ans.exec(raw)
  if (ans) {
    const body = ans[2].trim()
    // 容忍客服式尾巴："/ans wp-1 1 发送" → 选项 1（多余的字忽略）
    const opt = /^([1-9])(?:\s|$)/.exec(body)
    if (opt) return { kind: 'option', id: ans[1], index: Number(opt[1]) }
    return { kind: 'answerText', id: ans[1], text: body }
  }

  const why = COMMANDS.why.exec(raw)
  if (why) return { kind: 'why', id: why[1] ?? null, question: (why[2] ?? '').trim() || null }

  const say = COMMANDS.say.exec(raw)
  if (say) return { kind: 'say', id: say[1] ?? null, text: say[2].trim() }

  const done = COMMANDS.done.exec(raw)
  if (done) return { kind: 'done', id: done[1] ?? null }

  const use = COMMANDS.use.exec(raw)
  if (use) return { kind: 'use', arg: use[1] }

  const wake = COMMANDS.wake.exec(raw)
  if (wake) return { kind: 'wake', arg: wake[1] ?? null }

  const nw = COMMANDS.new.exec(raw)
  if (nw) return { kind: 'new', arg: nw[1] ?? null }

  if (COMMANDS.mode.test(raw)) return { kind: 'mode' }
  if (COMMANDS.pc.test(raw)) { const m = COMMANDS.pc.exec(raw); return { kind: 'pc', minutes: m[1] ? Number(m[1]) : null } }
  if (COMMANDS.away.test(raw)) return { kind: 'away' }
  if (COMMANDS.auto.test(raw)) return { kind: 'auto' }
  if (COMMANDS.more.test(raw)) { const m = COMMANDS.more.exec(raw); return { kind: 'more', id: m[1] ?? null } }
  if (COMMANDS.list.test(raw)) return { kind: 'list' }
  const prog = COMMANDS.progress.exec(raw)
  if (prog) return { kind: 'progress', id: prog[1] ?? null }

  return { kind: 'unknown', reason: 'unrecognized' }
}

/** 入站去重键：同一条消息最多触发一次状态变更。 */
export function dedupeKey(msgId, msgSeq) {
  return `${msgId ?? 'no-id'}#${msgSeq ?? 0}`
}
