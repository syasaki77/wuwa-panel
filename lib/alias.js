/**
 * 角色别名 / 同音错字匹配
 *
 * 数据文件：data/aliases.json
 *   { chars: { 汉字: 无声调拼音 }, roles: [{ name, py, aliases: [] }] }
 * 由 qq-work/_gen_aliases.py 用 pypinyin 生成（角色名用字 + 全部同音字 + 小名别名）。
 *
 * 匹配顺序（越靠前越可信）：
 *   0 标准名 / 别名精确
 *   1 拼音完全相等（输入法选错同音字，如 散花 → 散华）
 *   2 拼音编辑距离 1（少打 / 错一个音）
 *   3 拼音前缀（名字尾巴漏打，如 维里 → 维里奈）
 *   4 汉字编辑距离 1（漏字 / 形近字）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let CACHE = null

export function loadAliases() {
  if (CACHE) return CACHE
  try {
    CACHE = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', 'aliases.json'), 'utf8'))
  } catch {
    CACHE = { chars: {}, roles: [] }
  }
  return CACHE
}

/** 中文串 → 无声调拼音；任一汉字查不到就返回 null */
export function toPinyin(s) {
  const { chars } = loadAliases()
  let out = ''
  for (const ch of String(s)) {
    if (!/[\u4e00-\u9fff]/.test(ch)) continue
    const p = chars[ch]
    if (!p) return null
    out += p
  }
  return out || null
}

/** 编辑距离（带上限，超过 max 直接返回 max+1） */
export function editDistance(a, b, max = 1) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i)
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0]
    dp[0] = j
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i]
      dp[i] = Math.min(
        dp[i] + 1,
        dp[i - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev = tmp
    }
  }
  return dp[a.length]
}

const norm = (s) => String(s).replace(/[·\-—\s]/g, '')

/** 角色名归一化（去掉间隔号 / 连字符 / 空白），供跨数据源比较用 */
export const normName = norm

/**
 * 给出候选项（按可信度从高到低）
 * @returns {{name:string, score:number}[]}
 */
export function lookupRole(want) {
  const { roles } = loadAliases()
  const w = String(want || '').trim()
  if (!w) return []
  const n = norm(w)

  // 0) 标准名 / 别名精确
  const exact = []
  for (const r of roles) {
    if (norm(r.name) === n) return [{ name: r.name, score: 0 }]
    if (r.aliases.some((a) => norm(a) === n)) exact.push({ name: r.name, score: 0 })
  }
  if (exact.length) return dedupe(exact)

  const py = toPinyin(n)
  if (py) {
    // 1) 拼音完全相等（同音错字）
    const same = roles.filter((r) => r.py && r.py === py)
    if (same.length) return dedupe(same.map((r) => ({ name: r.name, score: 1 })))

    // 2) 拼音编辑距离 1
    if (py.length >= 4) {
      const near = roles.filter((r) => r.py && editDistance(py, r.py, 1) <= 1)
      if (near.length) return dedupe(near.map((r) => ({ name: r.name, score: 2 })))
    }

    // 3) 拼音前缀（尾巴漏打）
    if (py.length >= 3) {
      const pre = roles.filter((r) => r.py && r.py.startsWith(py))
      if (pre.length) return dedupe(pre.map((r) => ({ name: r.name, score: 3 })))
    }
  }

  // 4) 汉字编辑距离 1（漏字 / 形近）
  if (n.length >= 2) {
    const near = roles.filter((r) => editDistance(n, norm(r.name), 1) <= 1)
    if (near.length) return dedupe(near.map((r) => ({ name: r.name, score: 4 })))
  }
  return []
}

function dedupe(list) {
  const seen = new Set()
  return list
    .filter((x) => (seen.has(x.name) ? false : (seen.add(x.name), true)))
    .sort((a, b) => a.score - b.score)
}
