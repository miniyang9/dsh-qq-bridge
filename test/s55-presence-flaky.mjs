import './_setup.mjs'
/**
 * 探针偶发失败时不应把"在场"打回"离开"（s55）
 */
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { Presence, PRESENCE } = await import('../src/core/presence.js')

// 1) 连续失败 1 次：保持原判（在场不变）
{
  let idle = 60_000
  const p = new Presence({ probe: () => idle })
  p.sample(); p.sample()
  check('先在場', p.state === PRESENCE.PRESENT, p.state)
  idle = null
  const r1 = p.sample()
  check('第 1 次读不到 → 仍按在场', p.state === PRESENCE.PRESENT && r1.unknownHold === true, `${p.state} hold=${r1.unknownHold}`)
}

// 2) 连续失败 2 次：回落离开（宁可多推）
{
  let idle = 60_000
  const p = new Presence({ probe: () => idle })
  p.sample(); p.sample()
  idle = null
  p.sample()
  p.sample()
  check('连续 2 次读不到 → 离开', p.state === PRESENCE.AWAY, p.state)
}

// 3) 中间恢复一次：计数清零，不会误判
{
  let idle = 60_000
  const p = new Presence({ probe: () => idle })
  p.sample(); p.sample()
  idle = null; p.sample()
  idle = 30_000; p.sample()
  idle = null; p.sample()
  check('失败不连续不回落', p.state === PRESENCE.PRESENT, p.state)
}

// 4) 初始无信号 → 离开
{
  const p = new Presence({ probe: () => null })
  p.sample()
  check('启动即无信号 → 离开', p.state === PRESENCE.AWAY, p.state)
}

console.log('\n' + (failures.length === 0 ? 'S55 PASS' : 'S55 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
