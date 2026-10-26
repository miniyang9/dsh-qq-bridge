import './_setup.mjs'
/**
 * S1 证据（审计 P0-2）：接缝工厂在"有桥接/无桥接"下的行为可离线证明
 */
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { makeApprovalHandler, makeQuestionHandler } = await import('../lib/seams.js')

// 1) 无桥接：必须让行（返回 undefined → 下一个 answerer 接手），且不消费 next()
{
  let nextCalls = 0
  const h = makeApprovalHandler({ getBridge: () => null })
  const out = await h({ agent: {}, toolName: 'fs.read', callId: 'c1' }, () => { nextCalls += 1; return 'gui' })
  check('无桥接时返回 undefined（不吞审批）', out === undefined, String(out))
}

// 2) 有桥接：必须委托给 bridge.handleApproval，并把 next 透传
{
  let seenNext = null
  const fake = {
    async handleApproval(request, opts) { seenNext = typeof opts?.next; return 'allowed-once' },
  }
  const h = makeApprovalHandler({ getBridge: () => fake })
  const out = await h({ agent: {}, toolName: 'fs.write', callId: 'c2' }, () => 'gui')
  check('有桥接时采用 bridge 的返回值', out === 'allowed-once', String(out))
  check('把 next 透传给 bridge', seenNext === 'function', String(seenNext))
}

// 3) 无 agent 的请求直接让行（不是我们的审批）
{
  const h = makeApprovalHandler({ getBridge: () => ({ async handleApproval() { return 'rejected' } }) })
  let called = 0
  const out = await h(undefined, () => { called += 1; return 'gui' })
  check('无 agent 的请求直接让行', out === 'gui' && called === 1, `${out}/${called}`)
}

// 4) 提问：无桥接 → next；有桥接 → 用返回值；已中止 → undefined
{
  let nextCalls = 0
  const h0 = makeQuestionHandler({ getBridge: () => null })
  const o0 = await h0({ id: 'q1' }, () => { nextCalls += 1; return 'gui' })
  check('提问无桥接时让行', o0 === 'gui' && nextCalls === 1, `${o0}/${nextCalls}`)

  const h1 = makeQuestionHandler({ getBridge: () => ({ async handleQuestion() { return { answers: [] } } }) })
  const o1 = await h1({ id: 'q2' }, () => 'gui')
  check('提问有桥接时用 bridge 结果', o1 && Array.isArray(o1.answers), JSON.stringify(o1))

  const h2 = makeQuestionHandler({ getBridge: () => ({ async handleQuestion() { return undefined } }) })
  const o2 = await h2({ id: 'q3', signal: { aborted: true } }, () => 'gui')
  check('已中止的提问不再二次让行', o2 === undefined, String(o2))
}

console.log('\n' + (failures.length === 0 ? 'S56 PASS' : 'S56 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
