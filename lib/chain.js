/**
 * 共鸣链图（#XX共鸣链）
 *
 * 数据：data/chains.json —— 由库街区 wiki 的「共鸣链」页解析而来，
 *   每个角色 6 个节点：名称 + 效果描述（保留 <b> 高亮）+ 图标。
 * 图片：resources/img/chain/ —— 节点图标，抓取时已本地化。
 *
 * 和 #XX天赋 分家：天赋是同名指令的另一个页面，这里只出共鸣链。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findTalentRole, loadTalent, loadHeads } from './talent.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let CACHE = null

export function loadChains() {
  if (CACHE) return CACHE
  try {
    CACHE = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', 'chains.json'), 'utf8'))
  } catch {
    CACHE = {}
  }
  return CACHE
}

/** 六属性主题色（同 talent.js，共鸣链页面跟着角色属性走） */
const ELEM_COLOR = {
  冷凝: '#7fd8ff',
  热熔: '#ff8a5c',
  导电: '#c3a6ff',
  气动: '#6ee7d7',
  衍射: '#ffd76e',
  湮灭: '#f27fc4'
}

/** 鸣潮六属性 → miao 的元素底图类名 */
const ELEM_CLASS = {
  冷凝: 'cryo',
  热熔: 'pyro',
  气动: 'anemo',
  导电: 'electro',
  衍射: 'geo',
  湮灭: 'quantum'
}

const ELEM_CARD = {
  冷凝: 'img/card/T_Card10.webp',
  热熔: 'img/card/T_Card16.webp',
  气动: 'img/card/T_Card12.webp',
  导电: 'img/card/T_Card19.webp',
  衍射: 'img/card/T_Card5.webp',
  湮灭: 'img/card/T_Card17.webp'
}

function hexA(hex, a) {
  const n = parseInt(String(hex).replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/**
 * 按用户输入找角色 key（复用天赋的匹配器，数据 key 两边完全一致）
 * @returns {string|null}
 */
export function findChainRole(want) {
  const data = loadChains()
  const key = findTalentRole(want)
  if (!key) return null
  return data[key] ? key : null
}

/** 图鉴数据 → 渲染数据 */
export function buildChainData(key) {
  const r = loadChains()[key]
  if (!r) return null
  const t = loadTalent()[key] || {}
  const elem = t.info?.['属性'] || ''
  const accent = ELEM_COLOR[elem] || '#8fb6ff'

  const chains = (r.chains || []).map((c, i) => ({
    no: String(i + 1).padStart(2, '0'),
    name: c.name || '',
    desc: c.desc || '',
    iconPath: c.iconPath || '',
    // 每条链的图标圈跟属性同色，序号越靠后光晕越亮（无实际含义，纯视觉）
    iconCss: [
      `background: radial-gradient(circle at 50% 45%, ${hexA(accent, 0.34)}, ${hexA(accent, 0.20)} 62%, rgba(8,14,28,.94) 100%)`,
      `border: 2px solid ${hexA(accent, 0.48)}`,
      `box-shadow: 0 0 20px ${hexA(accent, 0.28)}, inset 0 0 14px ${hexA(accent, 0.30)}`
    ].join('; ')
  }))

  return {
    key,
    name: r.name || t.name || key,
    subtitle: r.subtitle || t.subtitle || '',
    head: loadHeads()[key] || '',
    accent,
    accentSoft: hexA(accent, 0.16),
    accentLine: hexA(accent, 0.34),
    accentNo: hexA(accent, 0.26),
    title: '共鸣链',
    elem,
    bgImg: 'img/bg/bg-' + (ELEM_CLASS[elem] || 'cryo') + '.webp',
    card: ELEM_CARD[elem] || 'img/card/T_Card1.webp',
    chains,
    count: chains.length,
    watermark: '小蓝 · wuwa-panel'
  }
}

/** 出图：走 TRSS 的 runtime.render（图片用相对路径，理由见 talent.js 注释） */
export async function renderChain(e, key, cfg = {}) {
  const data = buildChainData(key)
  if (!data) throw new Error('no chain data: ' + key)
  return await e.runtime.render('wuwa-panel', 'chain', data, {
    retType: 'base64',
    ...cfg
  })
}
