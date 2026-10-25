import './_setup.mjs'
/**
 * 在场判定（单维：空闲时长）
 * 规则：空闲 < 5 分钟 → 在场；≥5 分钟或拿不到 → 离开（宁可多推）
 * 防抖：变吵立即生效；变安静需连续 2 次
 */
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { Presence, PRESENCE } = await import('../src/core/presence.js')

const mk = (idle) => new Presence({ probe: () => idle })

// 1) 基本判定
{
  const p = mk(60_000)                 // 1 分钟
  p.sample(); p.sample()               // 从 unknown 起需连续两次（与防抖一致）
  check('空闲 1 分钟 → 在场（连续两次确认）', p.state === PRESENCE.PRESENT, p.state)
}
{
  const p = mk(6 * 60_000)             // 6 分钟
  p.sample()
  check('空闲 6 分钟 → 离开', p.state === PRESENCE.AWAY, p.state)
}
{
  const p = new Presence({ probe: () => null })
  p.sample()
  check('拿不到空闲 → 离开（宁可多推）', p.state === PRESENCE.AWAY, p.state)
}

// 2) 防抖：离开 → 在场需要连续 2 次
{
  let idle = 6 * 60_000
  const p = new Presence({ probe: () => idle })
  p.sample()
  check('初始为离开', p.state === PRESENCE.AWAY, p.state)

  idle = 30_000                        // 人回来了
  const first = p.sample()
  check('第 1 次回来不立即切在场', p.state === PRESENCE.AWAY && first.changed === false, `${p.state} changed=${first.changed}`)
  const second = p.sample()
  check('第 2 次连续回来才切在场', p.state === PRESENCE.PRESENT && second.changed === true, `${p.state} changed=${second.changed}`)
}

// 3) 防抖：在场 → 离开立即生效
{
  let idle = 10_000
  const p = new Presence({ probe: () => idle })
  p.sample(); p.sample()
  check('先在場', p.state === PRESENCE.PRESENT, p.state)
  idle = 5 * 60_000
  const r = p.sample()
  check('离开立即生效（不等第 2 次）', p.state === PRESENCE.AWAY && r.direction === 'away', `${p.state} dir=${r.direction}`)
}

// 4) 边界：正好 5 分钟算离开
{
  const p = mk(5 * 60_000)
  p.sample()
  check('正好 5 分钟 → 离开', p.state === PRESENCE.AWAY, p.state)
}

// 5) describe 供 /mode 展示
{
  const p = mk(90_000)
  p.sample(); p.sample()
  const d = p.describe()
  check('describe 给出状态与空闲', d.state === PRESENCE.PRESENT && d.idleText.includes('分钟'), JSON.stringify(d))
}

console.log('\n' + (failures.length === 0 ? 'S52 PASS' : 'S52 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
