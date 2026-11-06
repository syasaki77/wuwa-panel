/**
 * 玩家名片（#鸣潮卡片）：把库街区「我的 → 角色卡片」那套数据整理成模板字段。
 *
 * 数据来源（lib/kuro.js getPlayerCard）：
 *   base      /aki/roleBox/akiBox/baseData        —— 昵称/等级/活跃天数/成就/宝箱/波片…
 *   calabash  /aki/roleBox/akiBox/calabashData    —— 数据坞等级/声骸图鉴
 *   explore   /aki/roleBox/akiBox/exploreIndex    —— 各国探索度 + 敌迹探寻
 *   challenge /aki/roleBox/akiBox/challengeDetails—— 挑战玩法解锁状态
 *   tower     /aki/roleBox/akiBox/towerDataDetail —— 逆境深塔
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ICON_BASE = 'https://web-static.kurobbs.com/gamerdata/widget/game3/'
const ELEM_CLASS = {
  冷凝: 'cryo',
  热熔: 'pyro',
  导电: 'electro',
  气动: 'anemo',
  衍射: 'spectro',
  湮灭: 'havoc',
}

/** 属性图标里的单字（圆形小徽记，和库街区一致） */
const ELEM_TEXT = {
  冷凝: '冰',
  热熔: '火',
  导电: '雷',
  气动: '风',
  衍射: '光',
  湮灭: '暗',
}

const CATCH_QUALITY_TEXT = { 1: '一星', 2: '二星', 3: '三星', 4: '四星', 5: '五星' }

/** 挑战玩法的固定展示位（库街区「我的」页面就是这三块） */
const CHALLENGE_SLOTS = [
  { key: 'minge', name: '冥歌海墟' },
  { key: 'zhongyan', name: '终焉矩阵' },
  { key: 'quanxi', name: '全息战略' },
]

/** 更多玩法入口（运营位，与账号数据无关） */
const MORE_PLAY = ['荣耀之丘：激斗重燃', '穗波怪异物语', '潮蚀模拟', '幻梦游园']

const pick = (obj, ...keys) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k]
  }
  return undefined
}

const num = (v, def = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}

/** 百分比统一保留两位小数，和库街区一致（20.87% / 1.00% / 0.00%） */
function pct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

/** resources/img/head 下的官方头像索引：roleId → 文件名（懒加载一次） */
let HEAD_INDEX = null
function headIndex() {
  if (HEAD_INDEX) return HEAD_INDEX
  HEAD_INDEX = {}
  try {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'img', 'head')
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^(\d+)_/)
      if (m) HEAD_INDEX[m[1]] = f
    }
  } catch {}
  return HEAD_INDEX
}

/**
 * 角色头像：优先接口立绘；接口没给就回落到插件内置的官方头像。
 * resPath 是模板里 {{_res_path}} 的等价物，本地头像要拼上它才能被 puppeteer 加载。
 */
function roleHead(role, resPath) {
  const id = String(pick(role, 'roleId') || '')
  const pic = pick(role?.roleSkin, 'picUrl') || pick(role, 'rolePicUrl', 'roleIconUrl') || ''
  if (pic) return String(pic)
  const f = headIndex()[id] || ''
  return f ? `${resPath}img/head/${f}` : ''
}

/**
 * 角色头像图标（正方形），个人主页左上角用这个而不是立绘。
 */
function roleIcon(role, resPath) {
  const id = String(pick(role, 'roleId') || '')
  const icon = pick(role, 'roleIconUrl') || ''
  if (icon) return String(icon)
  const f = headIndex()[id] || ''
  return f ? `${resPath}img/head/${f}` : ''
}

/**
 * @param {object} card getPlayerCard 的返回
 * @param {object} ctx  { roles, uid, serverName, nick, list }
 */
export function buildPlayerCardData(card = {}, ctx = {}) {
  const base = card.base || {}
  const calabash = card.calabash && !card.calabash.__error ? card.calabash : null
  const explore = card.explore && !card.explore.__error ? card.explore : null
  const tower = card.tower && !card.tower.__error ? card.tower : null
  const challenge = card.challenge && !card.challenge.__error ? card.challenge : null

  const resPath = String(ctx.resPath || '../../../plugins/wuwa-panel/resources/')

  // ---------- 日常数据 ----------
  const daily = {
    energy: { cur: num(base.energy), max: num(base.maxEnergy) },
    storeEnergy: {
      cur: num(base.storeEnergy),
      max: num(base.storeEnergyLimit),
      label: String(pick(base, 'storeEnergyTitle') || '结晶单质'),
      icon: String(pick(base, 'storeEnergyIconUrl') || ICON_BASE + 'storeEnergy.png'),
    },
    liveness: { cur: num(base.liveness), max: num(base.livenessMaxCount) },
    weekly: {
      cur: num(base.weeklyInstCount),
      max: num(base.weeklyInstCountLimit),
      label: String(pick(base, 'weeklyInstTitle') || '战歌重奏').replace(/收取次数$/, ''),
      icon: String(pick(base, 'weeklyInstIconUrl') || ICON_BASE + 'weeklyInst.png'),
    },
    // 周度游历 / 先约电台：库街区接口没给，接口回来就填，回不来就显示「暂无数据」
    // rougeScore 是「千道门扉的异想」周本分数，不是游历值，别拿来顶
    rouge: {
      score: 0,
      limit: 0,
      has: false,
    },
    radio: {
      level: num(pick(base, 'radioLevel', 'bossLevel')),
      exp: num(pick(base, 'radioExp')),
      expMax: num(pick(base, 'radioExpMax')),
      has: pick(base, 'radioLevel') !== undefined,
    },
  }

  // ---------- 我的资料 ----------
  const treasure = Array.isArray(base.treasureBoxList) ? base.treasureBoxList : []
  const treasureName = ['朴素奇藏箱', '基准奇藏箱', '精密奇藏箱', '辉光奇藏箱']
  const boxes = treasureName.map((name, i) => ({
    name,
    num: num((treasure.find(t => num(t.id) === i + 1) || {}).num),
  }))
  const phantomList = Array.isArray(base.phantomBoxList) ? base.phantomBoxList : []
  const phantomTone = ['green', 'purple', 'gold']
  const phantomName = ['潮汐之遗·绿', '潮汐之遗·紫', '潮汐之遗·金']
  const phantoms = phantomName.map((name, i) => ({
    name,
    tone: phantomTone[i],
    num: num((phantomList.find(t => num(t.id) === i + 1) || {}).num),
  }))

  const stats = {
    big: [
      { value: num(base.activeDays), label: '游戏天数' },
      { value: num(base.level), label: '联觉等级' },
      { value: num(base.worldLevel), label: '索拉等级' },
      { value: num(base.roleNum), label: '解锁角色' },
    ],
    mid: [
      { icon: 'achievement', value: num(base.achievementCount), label: '已达成成就' },
      { icon: 'star', value: num(base.achievementStar), label: '成就星数' },
      { icon: 'smallBeacon', value: num(base.smallCount), label: '小型信标解锁数' },
      { icon: 'bigBeacon', value: num(base.bigCount), label: '中枢信标解锁数' },
    ],
    boxes,
    phantoms,
  }

  // ---------- 共鸣者 ----------
  // ctx.roles 可以传 roleData 整体（{roleList, showRoleIdList, showToGuest}），也可以只传角色数组。
  // 排序跟 #更新鸣潮面板 保持一致：用 compareRoles 那套规则重排（见下方 sort），不按 showRoleIdList 重排。
  const roleCtx = Array.isArray(ctx.roles) ? null : (ctx.roles || null)
  const roleSrc = Array.isArray(ctx.roles)
    ? ctx.roles
    : Array.isArray(roleCtx?.roleList) ? roleCtx.roleList : []
  const roles = roleSrc.map((r) => {
    const elemName = String(pick(r, 'attributeName') || '')
    return {
      name: String(pick(r, 'roleName', 'name') || '未知角色'),
      level: num(pick(r, 'level')),
      star: num(pick(r, 'starLevel')),
      chain: num(pick(r, 'chainUnlockNum')),
      elem: ELEM_CLASS[elemName] || 'spectro',
      elemName,
      elemText: ELEM_TEXT[elemName] || '·',
      // 真机「共鸣者」卡片用的是方形头像（roleIconUrl），不是半身立绘
      pic: roleIcon(r, resPath),
      icon: roleIcon(r, resPath),
      isMain: !!pick(r, 'isMainRole'),
    }
  })
  // 排序与 #更新鸣潮面板（lib/panel.js 的 compareRoles）保持一致：
  // 星级分组（五星在前）→ 主角垫五星组最后 → 等级降序 → 限定先于常驻 → 链数降序
  const STANDARD_5 = new Set(['凌阳', '卡卡罗', '维里奈', '安可', '鉴心'])
  roles.sort((a, b) => {
    const ga = a.star >= 5 ? 0 : 1
    const gb = b.star >= 5 ? 0 : 1
    if (ga !== gb) return ga - gb
    if (a.isMain !== b.isMain) return a.isMain ? 1 : -1
    if (a.level !== b.level) return b.level - a.level
    if (a.star >= 5) {
      const pa = STANDARD_5.has(a.name) ? 1 : 0
      const pb = STANDARD_5.has(b.name) ? 1 : 0
      if (pa !== pb) return pa - pb
    }
    return b.chain - a.chain
  })

  // ---------- 挑战数据：逆境深塔 ----------
  let towerView = null
  if (tower && tower.isUnlock !== false && Array.isArray(tower.difficultyList) && tower.difficultyList.length) {
    const diff = tower.difficultyList[0]
    const area = (diff.towerAreaList || [])[0] || {}
    const floors = Array.isArray(area.floorList) ? area.floorList : []
    // 取打过的最高层（星级最高的那层），库街区首页就是展示这一层
    const best = floors.slice().sort((a, b) => num(b.star) - num(a.star) || num(b.floor) - num(a.floor))[0]
    towerView = {
      difficultyName: String(diff.difficultyName || '稳定区'),
      areaName: String(area.areaName || '残响之塔'),
      star: num(area.star),
      maxStar: num(area.maxStar),
      floor: best && best.floor ? num(best.floor) : 0,
      floorStar: best ? num(best.star) : 0,
      // 三颗星：模板不支持 Array.from，这里直接算好布尔数组
      stars: [1, 2, 3].map(i => i <= (best ? num(best.star) : 0)),
      pic: best ? String(best.picUrl || '') : '',
      roles: (best?.roleList || []).slice(0, 3).map(r => String(pick(r, 'iconUrl') || '')),
    }
  }

  const challenges = CHALLENGE_SLOTS.map((s) => {
    // challengeDetails 目前只回 isUnlock，没解锁就是三块「暂未解锁」
    const unlocked = !!(challenge && challenge.isUnlock)
    return { name: s.name, unlocked }
  })

  // ---------- 探索数据 ----------
  let countries = []
  let detections = []
  if (explore) {
    countries = (Array.isArray(explore.exploreList) ? explore.exploreList : []).map((it) => {
      const c = it.country || {}
      return {
        name: String(c.countryName || '未知区域'),
        progress: pct(it.countryProgress),
        icon: String(pick(c, 'detailPageImage', 'homePageIcon', 'detailPagePic') || ''),
        color: String(c.detailPageProgressColor || '#C9A227'),
      }
    })
    detections = (Array.isArray(explore.detectionInfoList) ? explore.detectionInfoList : [])
      .filter(Boolean)
      .slice()
      .sort((a, b) => num(a.level) - num(b.level))
      .slice(0, 8)
      .map(d => ({
        name: String(d.detectionName || ''),
        icon: String(d.detectionIcon || ''),
        levelName: String(d.levelName || ''),
        level: num(d.level),
      }))
  }

  // ---------- 数据坞 ----------
  let calabashView = null
  if (calabash) {
    calabashView = {
      level: num(calabash.level),
      curExp: num(calabash.curExp),
      target: num(calabash.target),
      maxCount: num(calabash.maxCount),
      unlockCount: num(calabash.unlockCount),
      baseCatch: String(calabash.baseCatch || '0%'),
      strengthenCatch: String(calabash.strengthenCatch || '0%'),
      qualityText: CATCH_QUALITY_TEXT[num(calabash.catchQuality)] || '—',
      cost: num(calabash.cost),
      phantoms: (Array.isArray(calabash.phantomList) ? calabash.phantomList : []).slice(0, 8).map(p => ({
        name: String(pick(p?.phantom, 'name') || ''),
        icon: String(pick(p?.phantom, 'iconUrl') || ''),
        star: num(p.star),
        maxStar: num(p.maxStar),
        starsText: '★'.repeat(Math.max(0, Math.min(5, num(p.star)))),
      })),
    }
  }

  // 左上头像：优先用库街区账号资料里的 headUrl（就是 App 里显示的那个角色头像，
  // 由玩家自己在库街区挑的角色/上传图决定）；拿不到才退回游戏内主角色图标。
  const mainRole = roles.find((r) => r.isMain) || roles[0] || null
  const kuroAvatar = String(ctx.avatar || '')

  return {
    name: String(pick(base, 'name', 'roleName') || ctx.nick || '未命名'),
    uid: String(pick(base, 'id') || ctx.uid || ''),
    serverName: String(ctx.serverName || ''),
    avatar: kuroAvatar || (mainRole && (mainRole.icon || mainRole.pic)) || '',
    headFrame: String(ctx.headFrame || ''),
    daily,
    stats,
    roles,
    tower: towerView,
    challenges,
    morePlays: MORE_PLAY,
    countries,
    detections,
    calabash: calabashView,
    time: ctx.time || new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'),
  }
}
