/**
 * S6 验收：LabelPolicy 三条判据 + 参数反查
 *
 * S6 的实测结论：审批请求**不带工具参数**（`{agent, toolName, callId?, reason?, displayReason?, signal}`），
 * 参数只能从会话的 `tool/call` 事件按 callId 反查。
 */
const failures = []
function check(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) failures.push(label)
}

const { classify, isOutsideWrite, findToolArgs } = await import('../src/core/label.js')

const ROOT = '.'

// 1) 提权信号
check(classify({ toolName: 'fs.write', args: { sandbox_permissions: 'danger-full-access' }, workspaceRoot: ROOT }).reason === 'escalation', '参数含 sandbox_permissions → escalation')

// 2) 白名单
check(classify({ toolName: 'git.push', args: {}, workspaceRoot: ROOT, whitelist: ['git.push'] }).reason === 'whitelist', '命中白名单 → whitelist')

// 3) 工作区外写
const outside = { path: 'C:\\Windows\\x.txt' }
check(isOutsideWrite({ toolName: 'fs.write', args: outside, workspaceRoot: ROOT }) === true, '写工作区外 → true')
check(classify({ toolName: 'fs.write', args: outside, workspaceRoot: ROOT }).reason === 'outside-workspace', '分类为 outside-workspace')
check(isOutsideWrite({ toolName: 'fs.write', args: { path: 'a.txt' }, workspaceRoot: ROOT }) === false, '写工作区内 → false')
check(isOutsideWrite({ toolName: 'fs.read', args: outside, workspaceRoot: ROOT }) === false, '读工具不因路径被判不可逆')
check(isOutsideWrite({ toolName: 'fs.write', args: { content: 'C:\\Windows\\x' }, workspaceRoot: ROOT }) === false, '只看路径键，不扫内容')

// 4) 默认不标
check(classify({ toolName: 'fs.read', args: { path: 'a.txt' }, workspaceRoot: ROOT }).labeled === false, '普通读 → 不标')

// 5) 参数反查（审批请求不带参数，从 tool/call 事件找）
function fakeSession(events) {
  return {
    seq: events.length,
    eventAt: (i) => events[i],
  }
}
const session = fakeSession([
  { type: 'tool/call', data: { callId: 'c1', name: 'fs.write', arguments: '{"path":"C:\\\\Windows\\\\x.txt"}' } },
  { type: 'approval/asked', data: { id: 'a1', callId: 'c1' } },
])
const found = findToolArgs(session, 'c1')
check(found?.path === 'C:\\Windows\\x.txt', '按 callId 反查到参数', JSON.stringify(found))
check(findToolArgs(session, 'nope') === undefined, '查不到返回 undefined（卡片显示"未附"）')
check(findToolArgs(undefined, 'c1') === undefined, '没有 session 也不崩')

// 6) 反查到的参数能驱动标注
check(classify({ toolName: 'fs.write', args: found, workspaceRoot: ROOT }).labeled === true, '反查参数 → 判为需标注')

console.log(`\n${failures.length === 0 ? 'S6 PASS' : 'S6 FAIL'}  (${failures.length} 条失败)`)
process.exit(failures.length === 0 ? 0 : 1)
