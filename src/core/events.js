/**
 * Event（契约 1）· 跨层唯一形状
 *
 * 只读、由 seam 构造、其余层投影。封闭集合：
 *   kind ∈ { approval, question, turn, notice }
 * approval/question 必带 requestId；turn 必带 turnId。
 */

export const EVENT_KINDS = Object.freeze(['approval', 'question', 'turn', 'notice'])

let seq = 0

export function makeEvent({ kind, requestId, turnId, payload, at = Date.now() }) {
  if (!EVENT_KINDS.includes(kind)) throw new TypeError(`unknown event kind: ${kind}`)
  const event = { id: `ev-${++seq}`, kind, at, payload: payload ?? {} }
  if (kind === 'approval' || kind === 'question') {
    if (requestId === undefined) throw new TypeError(`${kind} event requires requestId`)
    event.requestId = requestId
  }
  if (kind === 'turn') {
    if (turnId === undefined) throw new TypeError('turn event requires turnId')
    event.turnId = turnId
  }
  return event
}

/** 审批请求 → Event（seam 侧唯一入口）。 */
export function approvalEvent(request) {
  return makeEvent({
    kind: 'approval',
    requestId: request?.callId,
    payload: {
      args: request?.args,
      reason: request?.reason ?? request?.displayReason,
      toolName: request?.toolName,
      agent: request?.agent,
    },
  })
}

export function questionEvent(request) {
  return makeEvent({
    kind: 'question',
    requestId: request?.callId,
    payload: { questions: request?.questions, agent: request?.agent },
  })
}

export function isEvent(value) {
  return Boolean(value) && typeof value === 'object' && EVENT_KINDS.includes(value.kind) && typeof value.payload === 'object'
}
