/**
 * 角色天赋图（#XX天赋）
 *
 * 数据：data/talent.json —— 由库街区 wiki 的「技能介绍」页解析而来，
 *   每个角色含：共鸣能力称号、角色介绍、90 级基础面板、六大技能（描述 + Lv1-10 倍率表）。
 * 图片：resources/img/talent/ —— 技能图标 / 角色立绘 / 头部背景，抓取时已本地化。
 *
 * 和 miao-plugin 的 #XX天赋 分家：那边是原神/星铁，这边只认鸣潮角色名。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lookupRole, normName } from './alias.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
let CACHE = null

export function loadTalent() {
  if (CACHE) return CACHE
  try {
    CACHE = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', 'talent.json'), 'utf8'))
  } catch {
    CACHE = {}
  }
  return CACHE
}

/** 角色头像（游戏内解包头像，152x152 webp）→ 角色 key 到 resources 相对路径的映射 */
let HEADS = null
export function loadHeads() {
  if (HEADS) return HEADS
  try {
    HEADS = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', 'heads.json'), 'utf8'))
  } catch {
    HEADS = {}
  }
  return HEADS
}

/** 六属性主题色（技能名 / 描边 / 图标光晕都跟属性走） */
const ELEM_COLOR = {
  冷凝: '#7fd8ff',
  热熔: '#ff8a5c',
  导电: '#c3a6ff',
  气动: '#6ee7d7',
  衍射: '#ffd76e',
  湮灭: '#f27fc4'
}

/** #rrggbb + alpha → rgba() 字符串（shotium 对 color-mix()/嵌套 var() 支持不稳，颜色直接算好最保险） */
function hexA(hex, a) {
  const n = parseInt(String(hex).replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** 鸣潮六属性 → miao 的元素底图类名（和面板 profile-detail 同一套背景图） */
const ELEM_CLASS = {
  冷凝: 'cryo',
  热熔: 'pyro',
  气动: 'anemo',
  导电: 'electro',
  衍射: 'geo',
  湮灭: 'quantum'
}

/**
 * 头部背景：用游戏名片的原图（resources/img/card/T_Card*.webp，728x360）
 * 游戏里名片是按角色/活动发的一整套，没有「角色→名片」的官方一一映射，
 * 这里按属性挑气质最贴的一张当头部底图（想给某个角色单独换，改这张表即可）。
 */
const ELEM_CARD = {
  冷凝: 'img/card/T_Card10.webp',  // 落雪（Falling Snow）
  热熔: 'img/card/T_Card16.webp',  // 炽舞（Fiery Dance）
  气动: 'img/card/T_Card12.webp',  // 微风（Breeze）
  导电: 'img/card/T_Card19.webp',  // 悬丝（Zapstring）
  衍射: 'img/card/T_Card5.webp',   // 青龙（Qingloong）
  湮灭: 'img/card/T_Card17.webp'   // 绯红怒（Crimson Fury）
}

/** 头部名片底色的明暗：左侧文字区亮度 > 0.5 的名片（冷凝/热熔）用深色字，其余用浅色字 */
const ELEM_HEAD_LIGHT = {
  冷凝: true,
  热熔: true,
  气动: false,
  导电: false,
  衍射: false,
  湮灭: false
}

/** 上图的技能顺序：主动 → 回路 → 变奏 → 延奏 */
const SKILL_ORDER = ['常态攻击', '共鸣技能', '共鸣回路', '共鸣解放', '变奏技能', '延奏技能']

/** 主角默认展示属性 */
const TRAVELER_DEFAULT = '漂泊者·湮灭'

/**
 * 按用户输入找角色 key
 * @returns {string|null}
 */
export function findTalentRole(want) {
  const data = loadTalent()
  const keys = Object.keys(data)
  if (!keys.length) return null
  const w = String(want || '').trim()
  if (!w) return null

  // 1) 直接对上 key（含「漂泊者·湮灭」这种带属性的写法）
  if (data[w]) return w
  const nw = normName(w)
  for (const k of keys) {
    if (normName(k) === nw) return k
  }

  // 2) 归一化后包含：只唯一命中才算（「玄翎」→ 秧秧·玄翎）
  if (nw.length >= 2) {
    const inc = keys.filter(k => normName(k).includes(nw))
    if (inc.length === 1) return inc[0]
  }

  // 3) 主角属性别名：光主/暗主/风主/雷主 → 对应属性（要放在别名表前面，否则会被「漂泊者」兜走）
  const TRAVELER_ATTR = { 光主: '衍射', 暗主: '湮灭', 风主: '气动', 雷主: '导电' }
  for (const [alias, attr] of Object.entries(TRAVELER_ATTR)) {
    if (w === alias && data['漂泊者·' + attr]) return '漂泊者·' + attr
  }

  // 4) 走别名表 → 标准角色名
  const hit = lookupRole(w)[0]
  if (hit) {
    if (data[hit.name]) return hit.name
    const nh = normName(hit.name)
    for (const k of keys) if (normName(k) === nh) return k
    // 别名指向「漂泊者」但数据里只有全名「漂泊者·XX」
    if (/漂泊者/.test(hit.name) && data[TRAVELER_DEFAULT]) return TRAVELER_DEFAULT
  }

  // 5) 主角：其余说法给默认属性
  if (/漂泊者|主角|阿漂|漂子|哈基漂/.test(w)) {
    if (data[TRAVELER_DEFAULT]) return TRAVELER_DEFAULT
    const any = keys.find(k => k.startsWith('漂泊者'))
    if (any) return any
  }

  // 5) 反向包含（输入比角色名更长时）
  if (nw.length >= 2) {
    const loose = keys.filter(k => nw.includes(normName(k)))
    if (loose.length === 1) return loose[0]
  }
  return null
}

/** 图鉴数据 → 渲染数据 */
export function buildTalentData(key) {
  const data = loadTalent()
  const r = data[key]
  if (!r) return null

  const elem = r.info?.['属性'] || ''
  const st = r.stats90 || {}
  const num = (v) => {
    const s = String(v ?? '').trim()
    if (!s) return '-'
    const n = parseFloat(s.replace(/[^\d.]/g, ''))
    return Number.isFinite(n) ? n.toLocaleString('en-US') : s
  }

  const stats = [
    { num: num(st['基础生命']), label: '基础生命' },
    { num: num(st['基础攻击']), label: '基础攻击' },
    { num: num(st['基础防御']), label: '基础防御' },
    { num: st['最大共鸣能量'] || '-', label: '共鸣能量' }
  ]

  const tags = []
  if (elem) tags.push({ k: '属性', v: elem })
  if (r.info?.['武器']) tags.push({ k: '武器', v: r.info['武器'] })
  if (r.info?.['出生'] && r.info['出生'] !== '未知') tags.push({ k: '出生', v: r.info['出生'] })

  const skills = []
  for (const type of SKILL_ORDER) {
    const s = (r.skills || []).find(x => x.type === type)
    if (!s) continue
    // 谐度破坏是通用机制，不进天赋图
    if (!s.name && !s.table && !(s.desc || []).length) continue
    skills.push({
      type: s.type,
      name: s.name || s.type,
      icon: s.icon || '',
      desc: (s.desc || []).filter(d => d.label || d.text),
      table: s.table || null
    })
  }

  const accent = ELEM_COLOR[elem] || '#8fb6ff'

  return {
    key,
    name: r.name || key,
    subtitle: r.subtitle || '',
    title: r.title || '共鸣能力',
    desc: r.desc || '',
    bg: r.bg || '',
    figure: r.figure || '',
    head: loadHeads()[key] || '',
    accent,
    // 技能图标圈 / 被动图标圈：底色和光晕跟属性走
    siconCss: [
      `background: radial-gradient(circle at 50% 42%, ${hexA(accent, 0.40)}, ${hexA(accent, 0.26)} 58%, rgba(10,18,34,.92) 100%)`,
      `border: 2px solid ${hexA(accent, 0.55)}`,
      `box-shadow: 0 0 26px ${hexA(accent, 0.34)}, inset 0 0 18px ${hexA(accent, 0.38)}`
    ].join('; '),
    piconCss: [
      `background: radial-gradient(circle, ${hexA(accent, 0.22)}, rgba(10,18,34,.9) 72%)`,
      `border: 1px solid ${hexA(accent, 0.30)}`
    ].join('; '),
    elemClass: ELEM_CLASS[elem] || 'cryo',
    bgImg: 'img/bg/bg-' + (ELEM_CLASS[elem] || 'cryo') + '.webp',
    headLight: !!ELEM_HEAD_LIGHT[elem],
    card: ELEM_CARD[elem] || 'img/card/T_Card1.webp',
    tags,
    stats,
    skills,
    watermark: '小蓝 · wuwa-panel',
    elem
  }
}

/** 出图：走 TRSS 的 runtime.render */
export async function renderTalent(e, key, cfg = {}) {
  const data = buildTalentData(key)
  if (!data) throw new Error('no talent data: ' + key)
  // 图片走 TRSS 注入的 _res_path（相对路径，页面在 temp/html/wuwa-panel/talent/ 下）。
  // 2026-11-03：之前覆盖成 file:/// 绝对路径，shotium 不加载带空格的 file URL，
  // 线上图里的头像 / 技能图标 / 头部图全空；相对路径和面板一致，实测正常。
  return await e.runtime.render('wuwa-panel', 'talent', data, {
    retType: 'base64',
    ...cfg,
  })
}

/** 插件 resources 目录的 file:// 路径（talent.json 里的图都是相对这个目录的） */
const RES_PATH = 'file:///' + path.join(HERE, '..', 'resources').replace(/\\/g, '/') + '/'
export { RES_PATH }
