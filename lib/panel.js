import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * 库街区角色详情 → 面板模板数据
 *
 * 输入是 /aki/roleBox/akiBox/getRoleDetail 的 data（结构见
 * Loping151/XutheringWavesUID 的 utils/api/model.py:RoleDetailData），
 * 输出是 resources/profile-detail.html 需要的字段。
 */

/** 属性 → 面板主题类名（CSS 变量在模板 head 里定义） */
/**
 * 鸣潮六属性 → 原神元素类名。
 * 面板底图直接复用 miao-plugin 的元素背景图：冷凝=冰(cryo)、热熔=火(pyro)、
 * 气动=风(anemo)、导电=雷(electro)、衍射=岩(geo)、湮灭=量子(quantum)。
 */
const ELEM_CLASS = {
  冷凝: 'cryo',
  热熔: 'pyro',
  气动: 'anemo',
  导电: 'electro',
  衍射: 'geo',
  湮灭: 'quantum',
}

/** 游戏数据表 ElementId → 中文属性名（multipliers.json 里存的是这个 id） */
const ELEM_ID_CN = { 1: '冷凝', 2: '热熔', 3: '导电', 4: '气动', 5: '衍射', 6: '湮灭' }

/** 本地素材兜底（页面在 temp/html/wuwa-panel/profile-detail/ 下，反推回插件目录） */
const LOCAL_IMG = '../../../../plugins/wuwa-panel/resources/img/'

/** 面板八项的展示配置：key → [图标类, 标题, 是否百分比] */
const ATTR_ROWS = [
  { key: 'hp', icon: 'i-hp', title: '生命值', pct: false },
  { key: 'atk', icon: 'i-atk', title: '攻击力', pct: false },
  { key: 'def', icon: 'i-def', title: '防御力', pct: false },
  { key: 'cpct', icon: 'i-cpct', title: '暴击率', pct: true },
  { key: 'cdmg', icon: 'i-cdmg', title: '暴击伤害', pct: true },
  { key: 'recharge', icon: 'i-recharge', title: '共鸣效率', pct: true },
  { key: 'dmg', icon: 'i-dmg', title: '属性伤害', pct: true },
  // 伤害加成总称：鸣潮的伤害加成是同一个乘区，属性伤害 + 普攻/重击/共鸣技能/共鸣解放等全部相加
  { key: 'dmgAll', icon: 'i-wuwa-dmg', title: '伤害加成', pct: true, agg: ['dmg', 'na', 'heavy', 'skill', 'lib'] },
]

/**
 * 属性行权重占比（%）：照 miao 原神面板 charWeight 的做法，显示在属性名和数值之间，
 * 权重为 0 的不显示。默认按输出角色通用给，个别角色用 ROLE_WEIGHT 覆盖。
 * 治疗 / 护盾角色不吃暴击爆伤，单独给预设。
 */
const WEIGHT_PRESET = {
  // 通用输出口径（主人 2026-11-02 定）：攻击力一般 75（容易被稀释），暴击爆伤/属性伤害/伤害加成 100，充能 50 起
  dps: { hp: 0, atk: 75, def: 0, cpct: 100, cdmg: 100, recharge: 50, dmg: 100, dmgAll: 100 },
  healer: { hp: 0, atk: 100, def: 0, cpct: 0, cdmg: 0, recharge: 100, dmg: 0, dmgAll: 0 },
  shielder: { hp: 100, atk: 0, def: 100, cpct: 0, cdmg: 0, recharge: 100, dmg: 0, dmgAll: 0 },
}
const DEFAULT_WEIGHT = WEIGHT_PRESET.dps

/** 角色个体权重：按 roleId 单独配（名字只作兜底）。只写和通用口径不同的项。 */
const dpsW = recharge => ({ ...WEIGHT_PRESET.dps, recharge })
const healerW = ({ recharge, main }) => ({
  ...WEIGHT_PRESET.healer,
  atk: main === 'atk' ? 100 : 0,
  hp: main === 'hp' ? 100 : 0,
  recharge,
})
const shielderW = ({ recharge, main }) => ({
  ...WEIGHT_PRESET.shielder,
  atk: main === 'atk' ? 100 : 0,
  hp: main === 'hp' ? 100 : 0,
  def: main === 'def' ? 100 : 0,
  recharge,
})
const ROLE_WEIGHT = {
  // —— 输出 ——
  1102: dpsW(50), // 散华（冷凝·迅刀 4★，副C，延奏给普攻加深）
  1202: dpsW(30), // 炽霞（热熔·佩枪 4★，主C）
  1312: dpsW(30), // 锁暝（导电·迅刀 5★，主C）
  1403: dpsW(30), // 秋水（气动·佩枪 4★，主C）
  1602: dpsW(30), // 丹瑾（湮灭·迅刀 4★，主C，重击流）
  1604: dpsW(30), // 漂泊者（湮灭·迅刀 5★，暗主）
  1402: dpsW(50), // 秧秧（气动·迅刀 4★，副C）
  1504: dpsW(50), // 灯灯（导电·长刃 4★，普攻流输出）
  // —— 治疗 ——
  // 白芷：治疗量不锁生命面板，大招 170+ 能量，核心是充能 + 生存；主人 18:56 定生活权重 75
  1103: { ...WEIGHT_PRESET.healer, hp: 75, atk: 0, recharge: 100 },
  1307: healerW({ recharge: 100, main: 'atk' }), // 卜灵（导电·音感仪 4★，18% 攻击治疗）
  1503: healerW({ recharge: 100, main: 'atk' }), // 维里奈（衍射·音感仪 5★，19% 攻击治疗）
  // —— 护盾 ——
  1303: shielderW({ recharge: 100, main: 'def' }), // 渊武（导电·臂铠 4★，200% 防御护盾）
  1601: shielderW({ recharge: 100, main: 'def' }), // 桃祈（湮灭·长刃 4★，防御型护盾）
}
const ROLE_WEIGHT_BY_NAME = {
  维里奈: ROLE_WEIGHT[1503],
  白芷: ROLE_WEIGHT[1103],
  卜灵: ROLE_WEIGHT[1307],
  桃祈: ROLE_WEIGHT[1601],
  渊武: ROLE_WEIGHT[1303],
}

/** 接口里属性名 → 行 key */
const PROP_KEY = {
  生命值: 'hp', 生命: 'hp',
  攻击力: 'atk', 攻击: 'atk',
  防御力: 'def', 防御: 'def',
  暴击率: 'cpct', 暴击: 'cpct',
  暴击伤害: 'cdmg',
  共鸣效率: 'recharge',
  属性伤害加成: 'dmg', 属性伤害: 'dmg',
  普攻伤害加成: 'na', 普攻伤害: 'na',
  重击伤害加成: 'heavy', 重击伤害: 'heavy',
  共鸣技能伤害加成: 'skill', 共鸣技能伤害: 'skill',
  共鸣解放伤害加成: 'lib', 共鸣解放伤害: 'lib',
  冷凝伤害加成: 'dmg', 冷凝伤害: 'dmg',
  热熔伤害加成: 'dmg', 热熔伤害: 'dmg',
  气动伤害加成: 'dmg', 气动伤害: 'dmg',
  导电伤害加成: 'dmg', 导电伤害: 'dmg',
  衍射伤害加成: 'dmg', 衍射伤害: 'dmg',
  湮灭伤害加成: 'dmg', 湮灭伤害: 'dmg',
}

/**
 * 单条词条的「满值」与「均值」——数据来自鸣潮声骸副词条数值表（8 档等概率，固定词条 4 档）：
 *   暴击率 6.3~10.5 / 暴击伤害 12.6~21.0 / 攻击% 6.4~11.6 / 生命% 6.4~11.6
 *   防御% 8.1~14.7 / 充能 6.8~12.4 / 各类伤害加成 6.4~11.6
 *   固定攻击 30~60 / 固定防御 40~70 / 固定生命 320~580
 * 均值取档位中值，音骸卡评分用满值归一。
 */
const PROP_FULL = {
  hp: 580, atk: 60, def: 70,
  cpct: 10.5, cdmg: 21, recharge: 12.4,
  dmg: 11.6, na: 11.6, heavy: 11.6, skill: 11.6, lib: 11.6,
}

const pick = (obj, ...keys) => {
  for (const k of keys) {
    const v = obj?.[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

const num = v => {
  if (typeof v === 'number') return v
  const n = parseFloat(String(v ?? '').replace(/[^\d.+-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

const fmtPct = v => `${v.toFixed(1)}%`
const fmtInt = v => String(Math.round(v))

/** 把 "22.0%" / "470" 解析成数值 */
function parseProp(prop) {
  const raw = String(pick(prop, 'attributeValue', 'value') ?? '')
  const key = PROP_KEY[String(pick(prop, 'attributeName', 'name') ?? '').trim()]
  return { key, value: num(raw), pct: raw.includes('%') }
}

/**
 * 五件声骸的词条汇总。
 * - main / sub：逐件主副词条求和（声骸卡评分、单件展示用）
 * - total：声骸提供的全部加成总量。接口的 equipPhantomAddPropList 就是权威合计
 *          （= 主词条 + 副词条 + 套装效果），有它直接用，没有才退回 main+sub。
 */
function collectProps(detail) {
  const main = {}
  const sub = {}
  const pct = {}
  const bump = (map, p, raw) => {
    const { key, value } = parseProp(p)
    if (!key) return
    map[key] = (map[key] || 0) + value
    if (raw.includes('%')) pct[key] = (pct[key] || 0) + value
  }
  const list = detail?.phantomData?.equipPhantomList || []
  for (const ph of list) {
    if (!ph) continue
    for (const p of ph.mainProps || []) bump(main, p, String(p?.attributeValue ?? ''))
    for (const p of ph.subProps || []) bump(sub, p, String(p?.attributeValue ?? ''))
  }
  const addList = detail?.equipPhantomAddPropList || []
  const total = {}
  if (addList.length) {
    for (const p of addList) {
      const { key, value } = parseProp(p)
      if (key) total[key] = (total[key] || 0) + value
    }
  } else {
    for (const k of new Set([...Object.keys(main), ...Object.keys(sub)])) {
      total[k] = (main[k] || 0) + (sub[k] || 0)
    }
  }
  return { main, sub, total, pct }
}

/**
 * 面板属性。
 * 库街区接口的 roleAttributeList 就是游戏内角色面板总值（含声骸/武器/套装加成），
 * 有就直接用；没有才退回「声骸词条求和」兜底。
 */
/** 当前角色的权重表：个体配置 > 名字兜底 > 输出通用 */
function roleWeights(detail) {
  const role = detail?.role || {}
  const roleName = String(pick(role, 'roleName') || '')
  return {
    ...DEFAULT_WEIGHT,
    ...(ROLE_WEIGHT[role.roleId] || ROLE_WEIGHT_BY_NAME[roleName] || {}),
  }
}

function buildAttrs(detail) {
  const role = detail?.role || {}
  const weights = roleWeights(detail)
  const direct = pick(detail, 'roleAttributeList', 'panel', 'props', 'attrList', 'propertyList', 'rolePropList')
  const source = {}
  if (Array.isArray(direct)) {
    for (const p of direct) {
      const { key, value } = parseProp(p)
      if (key) source[key] = value
    }
  }
  // 接口没给就找角色对象上的同名字段
  for (const [k, alias] of Object.entries({
    hp: ['hp', 'maxHp', 'life'],
    atk: ['atk', 'attack'],
    def: ['def', 'defense'],
    cpct: ['critRate', 'cpct'],
    cdmg: ['critDmg', 'cdmg'],
    recharge: ['energyRecharge', 'recharge'],
  })) {
    if (source[k] === undefined) {
      const v = pick(role, ...alias)
      if (v !== undefined) source[k] = num(v)
    }
  }

  const { total: bonusAll } = collectProps(detail)
  /** 单项的面板值 / 声骸加成 / 基础值 */
  const rawOf = key => {
    const bonus = bonusAll[key] || 0
    const total = source[key]
    return {
      bonus,
      value: total !== undefined ? total : bonus,
      base: total !== undefined ? Math.max(0, total - bonus) : 0,
    }
  }
  return ATTR_ROWS.map(row => {
    let { bonus, value, base } = rawOf(row.key)
    // 聚合行：同一乘区的多个来源相加（属性伤害 + 各技能类型伤害）
    if (row.agg) {
      bonus = 0
      value = 0
      base = 0
      for (const k of row.agg) {
        const r = rawOf(k)
        bonus += r.bonus
        value += r.value
        base += r.base
      }
    }
    const weight = weights[row.key]
    return {
      icon: row.icon,
      title: row.title,
      pct: row.pct,
      value: row.pct ? fmtPct(value) : fmtInt(value),
      base: row.pct ? fmtPct(base) : fmtInt(base),
      plus: bonus ? `+${row.pct ? bonus.toFixed(1) : Math.round(bonus)}${row.pct ? '%' : ''}` : '',
      cls: weight >= 80 ? 'great' : weight ? 'useful' : 'nouse',
      weight: weight ? String(weight) : '',
      gold: weight >= 80,
      zero: base === 0,
    }
  })
}

/**
 * 声骸评分。
 * 规则（可校准）：每条副词条按「当前值 / 该词条满值」归一，五件合计。
 * 单件满分 50，评级按分数分档。
 */
function scoreEcho(mainProps, subProps) {
  let score = 0
  for (const p of subProps || []) {
    const { key, value } = parseProp(p)
    if (!key || !PROP_FULL[key]) continue
    score += Math.min(1, value / PROP_FULL[key]) * 9
  }
  // 主词条只认有效的两条（cost4 双词条 / 低位单条）
  return Math.round(score * 10) / 10
}

const MARK_OF = score => {
  if (score >= 45) return 'SSS'
  if (score >= 40) return 'SS'
  if (score >= 33) return 'S'
  if (score >= 25) return 'A'
  if (score >= 15) return 'B'
  return 'C'
}

/** 声骸卡 */
function buildEchoes(detail) {
  const weights = roleWeights(detail)
  const list = detail?.phantomData?.equipPhantomList || []
  return list.filter(Boolean).map((ph, idx) => {
    const prop = ph.phantomProp || {}
    const mainProps = ph.mainProps || []
    const subProps = ph.subProps || []
    const score = scoreEcho(mainProps, subProps)
    const main = mainProps[0]
    return {
      name: pick(prop, 'name') || '未知声骸',
      icon: pick(prop, 'iconUrl') || LOCAL_IMG + `echo${idx + 1}.png`,
      level: pick(ph, 'level') ?? 0,
      score: score.toFixed(1),
      mark: MARK_OF(score),
      main: {
        title: main ? String(pick(main, 'attributeName') || '').replace(/加成$/, '') : '',
        val: main ? String(pick(main, 'attributeValue') || '') : '',
      },
      attrs: subProps.map(p => {
        const { key, value } = parseProp(p)
        const avg = PROP_AVG[key]
        const weight = weights[ECHO_WEIGHT_KEY[key] || key] || 0
        return {
          cls: weight >= 80 ? 'great' : weight ? 'useful' : 'nouse',
          eff: avg && value ? (value / avg).toFixed(1) : '',
          title: String(pick(p, 'attributeName') || '').replace(/加成$/, ''),
          val: String(pick(p, 'attributeValue') || ''),
        }
      }),
    }
  })
}

/** 武器描述里的百分比数值高亮：先转义再包 span（模板用 {{@}} 原样输出） */
function hlPct(text) {
  const esc = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return esc.replace(/(\d+(?:\.\d+)?%)/g, '<span class="wval">$1</span>')
}

/**
 * 已装备武器卡（详情页第一格）。
 * 接口结构：detail.weaponData = { level, resonLevel, mainPropList[2], weapon:{...} }
 * mainPropList[0] 是主属性（基础攻击），[1] 是副属性。
 */
function buildWeapon(detail) {
  const wd = detail?.weaponData
  const w = wd?.weapon
  if (!w) return null
  const props = (wd.mainPropList || []).map(p => ({
    title: String(pick(p, 'attributeName') || '').replace(/加成$/, ''),
    val: String(pick(p, 'attributeValue') || ''),
  }))
  const star = Math.max(0, Math.min(5, num(pick(w, 'weaponStarLevel'))))
  return {
    name: pick(w, 'weaponName') || '',
    icon: pick(w, 'weaponIcon') || '',
    star,
    stars: '★'.repeat(star),
    level: num(wd.level),
    reson: num(wd.resonLevel),
    main: props[0] || { title: '', val: '' },
    sub: props[1] || { title: '', val: '' },
    effectName: pick(w, 'weaponEffectName') || '',
    effect: hlPct(pick(w, 'effectDescription') || ''),
  }
}

/** 声骸总览：总分 = 五件平均分 × 5（满 250） */
function buildEchoSummary(echoes) {
  const total = echoes.reduce((s, e) => s + parseFloat(e.score || 0), 0)
  // 五件满分 250 → 改成百分制更直观
  const pct = total / 2.5
  return {
    score: total.toFixed(1),
    mark: MARK_OF(pct / 5),
  }
}

/** 技能图标：接口给的那张，兜底用本地素材 */
const SKILL_LOCAL = {
  常态攻击: 'skill_atk.png',
  共鸣技能: 'skill_e.png',
  共鸣解放: 'skill_q.png',
}

function buildTalents(detail) {
  const wanted = ['常态攻击', '共鸣技能', '共鸣解放']
  const byType = {}
  for (const s of detail?.skillList || []) {
    const type = pick(s?.skill, 'type')
    if (!type) continue
    if (!byType[type] || (s.level || 0) > (byType[type].level || 0)) byType[type] = s
  }
  return wanted.map((type, i) => {
    const item = byType[type]
    // 接口里满级技能给 11，面板显示 10
    const lv = item?.level ? Math.max(1, item.level - 1) : 1
    return {
      icon: SKILL_LOCAL[type] || `skill_${i}.png`,
      url: pick(item?.skill, 'iconUrl') || LOCAL_IMG + (SKILL_LOCAL[type] || ''),
      lv,
    }
  })
}

function buildCons(detail) {
  const chains = detail?.chainList || []
  return chains.map((c, i) => ({
    icon: pick(c, 'iconUrl') || LOCAL_IMG + `cons${i + 1}.png`,
    on: !!pick(c, 'unlocked'),
  }))
}

/** 单条词条均值——把总值换算成「几条词条」（档位中值，见 PROP_FULL 注释） */
const PROP_AVG = { cpct: 8.4, cdmg: 16.8, atk: 9.0, recharge: 9.6, hp: 450, def: 55, dmg: 9.0, na: 9.0, heavy: 9.0, skill: 9.0, lib: 9.0 }

/** 声骸词条 → 面板权重表的 key：伤种（普攻/重击/技能/解放）都归到「伤害加成」总权重 */
const ECHO_WEIGHT_KEY = { na: 'dmgAll', heavy: 'dmgAll', skill: 'dmgAll', lib: 'dmgAll', dmg: 'dmg' }

/** 声骸总览那 7 格（词条数 + 合计加成） */
const ECHO_ATTR_ROWS = [
  { key: 'cpct', title: '暴击' },
  { key: 'cdmg', title: '爆伤' },
  { key: 'atk', title: '攻击' },
  { key: 'recharge', title: '充能' },
  { key: 'hp', title: '生命' },
  { key: 'def', title: '防御' },
  { key: 'na', title: '普攻' },
]

function buildEchoAttrs(detail) {
  const weights = roleWeights(detail)
  const { total, pct } = collectProps(detail)
  const rows = ECHO_ATTR_ROWS.map(({ key, title }) => {
    const value = total[key] || 0
    if (!value) return null
    const avg = PROP_AVG[key] || 1
    // 攻击是「固定值 + 百分比」混在一起的，词条数只能按百分比那一截折算
    const effVal = key === 'atk' ? (pct[key] || 0) : value
    const isPct = key !== 'hp' && key !== 'atk' && key !== 'def'
    const weight = weights[ECHO_WEIGHT_KEY[key] || key] || 0
    return {
      cls: weight >= 80 ? 'great' : weight ? 'useful' : 'nouse',
      weight,
      effNum: effVal / avg,
      eff: effVal ? (effVal / avg).toFixed(1) : '',
      title,
      val: `+${isPct ? value.toFixed(1) + '%' : Math.round(value)}`,
    }
  }).filter(Boolean)
  // 按权重排队：满权重在前，同权重里词条数多的在前；不补空位，有几条排几条
  rows.sort((a, b) => (b.weight - a.weight) || (b.effNum - a.effNum))
  return rows
}

/** 主入口 */

/* ───────────────────────── 伤害计算 ───────────────────────── */

/** 全角色技能倍率表：由游戏数据表生成（roleinfo.SkillId → skill.SkillGroupId → DamageList → damage.RateLv[0..9]） */
let MULT_CACHE = null
function loadMults () {
  if (MULT_CACHE) return MULT_CACHE
  try {
    MULT_CACHE = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'multipliers.json'), 'utf8'))
  } catch {
    MULT_CACHE = {}
  }
  return MULT_CACHE
}

/** 面板总属性：优先 detail.panel.props 数组，其次 role 上的同名字段 */
function panelSource (detail) {
  let direct = pick(detail, 'roleAttributeList', 'panel', 'props', 'attrList', 'propertyList', 'rolePropList')
  if (direct && !Array.isArray(direct)) direct = direct.props || direct.attrList || direct.propertyList || direct.rolePropList
  if (!Array.isArray(direct) && Array.isArray(detail?.panel?.props)) direct = detail.panel.props
  const source = {}
  if (Array.isArray(direct)) {
    for (const p of direct) {
      const { key, value } = parseProp(p)
      if (key) source[key] = value
    }
  }
  const role = detail?.role || {}
  for (const [k, alias] of Object.entries({
    hp: ['hp', 'maxHp', 'life'],
    atk: ['atk', 'attack'],
    def: ['def', 'defense'],
    cpct: ['critRate', 'cpct'],
    cdmg: ['critDmg', 'cdmg'],
    dmg: ['dmgBonus', 'dmg', 'attributeDmg'],
    na: ['naBonus', 'na'],
  })) {
    if (source[k] === undefined) {
      const v = pick(role, ...alias)
      if (v !== undefined) source[k] = num(v)
    }
  }
  return source
}

/** 技能类型 → 接口里 skillList 的 type 名（接口只给常驻攻击/共鸣技能/共鸣解放） */
const SKILL_LV_TYPE = { 1: ['常态攻击', '常驻攻击'], 2: ['共鸣技能'], 3: ['共鸣解放'] }

/** 技能等级：接口给 11 表示满级，面板按 10 算；变奏/延奏跟角色等级走，统一按 10 */
function skillLevelOf (detail, type) {
  const names = SKILL_LV_TYPE[type]
  if (!names) return 10
  const list = Array.isArray(names) ? names : [names]
  const item = (detail?.skillList || []).find(s => list.includes(pick(s?.skill, 'type')))
  const lv = item ? num(pick(item.skill, 'level')) : 0
  return lv ? Math.max(1, Math.min(10, lv - 1)) : 10
}

/** 接口给的常态攻击描述里解析普攻段数（「进行最多N段连续攻击」） */
function normalAttackCount (detail) {
  const list = detail?.skillList || []
  const item = list.find(x => String(pick(x?.skill, 'type') || '').includes('常态攻击')) ||
    list.find(x => String(pick(x?.skill, 'name') || '').includes('普攻'))
  const desc = String(pick(item?.skill, 'description') || '')
  const m = desc.match(/最多\s*(\d+)\s*段/)
  const n = m ? +m[1] : 4
  return Math.max(1, Math.min(9, n))
}

/** 技能类型数字 → 接口里的中文类型名（用来取官方技能全名） */
const TYPE_KEY = { 1: '常态攻击', 2: '共鸣技能', 3: '共鸣解放', 4: '共鸣回路', 5: '变奏技能', 6: '延奏技能' }

/** 伤害表里的技能类型简称（与游戏/攻略站的写法一致：普攻·寒光 第一段） */
const TYPE_LABEL = { 1: '普攻', 2: '共鸣技能', 3: '共鸣解放', 4: '共鸣回路', 5: '变奏技能', 6: '延奏技能' }
const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

/** 接口各技能的官方全名：{ 常态攻击: '寒光', 共鸣技能: '朔雪永冻', ... } */
function skillNameMap (detail) {
  const map = {}
  for (const s of detail?.skillList || []) {
    const type = String(pick(s?.skill, 'type') || '')
    const name = String(pick(s?.skill, 'name') || '')
    if (type && name) map[type] = name
  }
  return map
}

/** 主声骸技能：从装备的 cost4 声骸描述里解析「基于自身攻击力/防御力/生命值 X%」 */
function mainEchoSkill (detail) {
  const list = (detail?.phantomData?.equipPhantomList || []).filter(Boolean)
  const main = list.find(p => num(p.cost) >= 4) || list[0]
  const prop = main?.phantomProp || {}
  const name = String(prop.name || '')
  const desc = String(prop.skillDescription || '')
  if (!name || !desc) return null
  const m = desc.match(/基于自身\s*(攻击力|防御力|生命值|最大生命值)[^0-9%]{0,10}?(\d+(?:\.\d+)?)\s*%/)
  if (!m) return null
  const attr = { 攻击力: 'atk', 防御力: 'def', 生命值: 'hp', 最大生命值: 'hp' }[m[1]] || 'atk'
  return { name, attr, pct: parseFloat(m[2]) }
}

/**
 * 共鸣回路拆行：游戏数据把共鸣回路的伤害挂在 SkillType 6（延奏技能 skill）下面，
 * type 4 的节点没有 DamageList，直接按类型过滤会整块漏掉。
 * 默认取回路里单段最高的一段；个别机制多的角色按 group 拆成多行。
 * groups 对应 multipliers 里各段的 group（damageId 的第 4~6 位）。
 *   散华 无明心音：011 重击·爆裂 / 020 冰棱 / 030 冰川 / 040 冰棘
 *   冰绽 = 引爆遗留物，标准循环按「冰棱 + 冰棘」两道计（先 Q 留冰川则是三道全炸）
 */
const CIRCUIT_SPLIT = {
  1102: [
    { label: '重击·爆裂', groups: ['011'] },
    { label: '冰绽', groups: ['020', '040'], note: '冰绽按标准循环两道（冰棱 + 冰棘）计' },
  ],
}

/* ── 主角（漂泊者）多属性倍率：来自库街区 wiki（data/traveler-elements.json） ──
 * 游戏数据表里 1604 只有湮灭一套，气动/衍射/导电的倍率在 multipliers.json 里根本不存在；
 * wiki 角色页有官方「技能数据」表（Lv1-10），这里按当前属性取对应那一套。
 */
let TRAV_CACHE = null
function loadTravelerSets () {
  if (TRAV_CACHE) return TRAV_CACHE
  try {
    TRAV_CACHE = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'traveler-elements.json'), 'utf8')).sets || {}
  } catch {
    TRAV_CACHE = {}
  }
  return TRAV_CACHE
}

/** 各属性共鸣回路的代表行（wiki 行名，去掉末尾「伤害」后展示） */
const CIRCUIT_PICK = {
  导电: '超负荷伤害',
  气动: '缥缈无相第二段伤害',
  衍射: '浮声千斩·旋音伤害',
  湮灭: '灭音伤害',
}

/** wiki 行名 → 普攻段序：普攻第一段伤害 / 第一段伤害 */
const NA_SEG_RE = /^(?:普攻)?第([一二三四五六七八九])段伤害$/
const CN_NUM_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** 主角伤害表：用 wiki 属性套数据推 7 行（声骸技能共用原逻辑，这里只推到回路） */
function travelerDamageRows (detail, ctx) {
  const role = detail?.role || {}
  const elem = String(pick(role, 'attributeName') || '')
  const set = loadTravelerSets()[elem]
  if (!set) return 0
  const { pushRow, names } = ctx
  const wNames = set.names || {}
  const naName = wNames.na || ctx.naName
  const before = ctx.count()

  // 普攻第一段 / 终结段（wiki 行名带序号；空中攻击·X第一段之类不匹配）
  const naRows = []
  for (const r of set.na || []) {
    const m = String(r.name || '').match(NA_SEG_RE)
    if (m) naRows.push({ ...r, seg: CN_NUM_MAP[m[1]] })
  }
  naRows.sort((a, b) => a.seg - b.seg)
  if (naRows.length) {
    pushRow(`普攻·${naName} 第一段`, 1, naRows[0].rate / 100)
    const last = naRows[naRows.length - 1]
    if (last.seg > naRows[0].seg) pushRow(`普攻·${naName} 终结段`, 1, last.rate / 100)
  }

  // 共鸣技能 / 共鸣解放 / 变奏技能（wiki 首行即主伤害行，冷却/能量行已被过滤）
  for (const [type, key] of [[2, 'skill'], [3, 'lib'], [5, 'vari']]) {
    const row = (set[key] || [])[0]
    if (!row) continue
    const label = TYPE_LABEL[type] || ''
    const full = wNames[key] || names[TYPE_KEY[type]] || ''
    pushRow(full && full !== label ? `${label}·${full}` : label, type, row.rate / 100)
  }

  // 共鸣回路：按属性挑代表行
  const cir = set.circuit || []
  if (cir.length) {
    const want = CIRCUIT_PICK[elem]
    const hit = cir.find(r => r.name === want) ||
      cir.reduce((a, b) => (b.rate || 0) > (a?.rate || 0) ? b : a, null)
    if (hit) {
      const full = wNames.circuit || names['共鸣回路'] || ''
      const head = full ? `共鸣回路·${full}` : '共鸣回路'
      const label = String(hit.name).replace(/伤害$/, '')
      pushRow(`${head} ${label}`, 6, hit.rate / 100)
    }
  }
  return ctx.count() - before
}

/** 伤害表：普攻第一段 + 终结段、共鸣技能、共鸣解放、变奏技能、共鸣回路、声骸技能 */
function buildDamageRows (detail, enemyLevel) {
  const role = detail?.role || {}
  const roleId = num(pick(role, 'roleId', 'id', 'roleIdNum') ?? pick(detail, 'roleId', 'id'))
  const mult = loadMults()[roleId]
  if (!mult) return []

  const src = panelSource(detail)
  const atk = src.atk || 0
  if (!atk) return []

  const cpct = (src.cpct || 0) / 100
  const cdmg = Math.max(1, (src.cdmg || 150) / 100)
  const dmgBonus = (src.dmg || 0) / 100
  const naBonus = (src.na || 0) / 100

  const charLv = num(detail?.level) || 90
  const eLv = num(enemyLevel) || 90
  // 防御乘区：鸣潮 (角色等级+100) / [(角色等级+100) + (敌人等级+100)]
  const defFac = (charLv + 100) / ((charLv + 100) + (eLv + 100))
  const resFac = 0.9 // 默认 10% 抗性

  const fmt = n => (n >= 100000 ? `${(n / 10000).toFixed(1)}万` : String(Math.round(n)))

  const naCount = normalAttackCount(detail)
  const names = skillNameMap(detail)
  const naName = names['常态攻击'] || '普攻'

  const rows = []
  // base 可选：不吃攻击力的声骸技能传面板值进来
  const pushRow = (title, type, rate, base = atk) => {
    const bonus = type === 1 ? naBonus : 0
    const dmg = base * rate * (1 + dmgBonus + bonus) * defFac * resFac
    rows.push({
      title,
      crit: fmt(dmg * cdmg),
      expect: fmt(dmg * (1 + cpct * (cdmg - 1))),
      rate: +(rate * 100).toFixed(1)
    })
  }
  const rateOf = (segs, lv) => (segs.length > 1
    ? segs.reduce((a, s) => a + (s.rates[lv - 1] || s.rates[0]), 0)
    : (segs[0].rates[lv - 1] || segs[0].rates[0]) * (segs[0].hits || 1)) / 100

  // 主角（漂泊者）多属性：wiki 套数据优先（游戏数据表只有湮灭一套）
  const travelerHandled = role?.isMainRole
    ? travelerDamageRows(detail, { pushRow, names, naName, count: () => rows.length })
    : 0
  if (!travelerHandled) {
  // 1. 普攻第一段 + 终结段
  const naSkill = (mult.skills || []).find(s => s.type === 1)
  if (naSkill) {
    const lv = skillLevelOf(detail, 1)
    const byOrder = new Map()
    for (const seg of naSkill.segs) {
      if (seg.order == null) continue
      if (!byOrder.has(seg.order)) byOrder.set(seg.order, [])
      byOrder.get(seg.order).push(seg)
    }
    if (byOrder.size) {
      const first = byOrder.get(1)
      const last = byOrder.get(naCount) || byOrder.get(Math.max(...byOrder.keys()))
      if (first) pushRow(`普攻·${naName} 第一段`, 1, rateOf(first, lv))
      if (last && last !== first) pushRow(`普攻·${naName} 终结段`, 1, rateOf(last, lv))
    }
  }

  // 2. 共鸣技能 / 共鸣解放 / 变奏技能
  for (const type of [2, 3, 5]) {
    const sk = (mult.skills || []).find(s => s.type === type)
    if (!sk || !sk.segs.length) continue
    const lv = skillLevelOf(detail, type)
    const rate = sk.segs.reduce((a, s) => a + ((s.rates[lv - 1] || s.rates[0]) * (s.hits || 1)), 0) / 100
    if (rate <= 0) continue
    const label = TYPE_LABEL[type] || sk.typeCn
    const full = names[TYPE_KEY[type]] || ''
    pushRow(full && full !== label ? `${label}·${full}` : label, type, rate)
  }

  // 2.5 共鸣回路（数据表挂在 SkillType 6 下）
  const circ = (mult.skills || []).find(s => s.type === 6)
  if (circ && circ.segs.length) {
    const lv = 10
    const full = names['共鸣回路'] || ''
    const head = full ? `共鸣回路·${full}` : '共鸣回路'
    const rateOne = seg => (seg.rates[lv - 1] || seg.rates[0]) * (seg.hits || 1) / 100
    const split = CIRCUIT_SPLIT[roleId]
    if (split) {
      for (const item of split) {
        const rate = circ.segs
          .filter(s => item.groups.includes(String(s.group)))
          .reduce((a, s) => a + rateOne(s), 0)
        if (rate <= 0) continue
        const row = { title: `${head} ${item.label}`, rate: +(rate * 100).toFixed(1) }
        pushRow(row.title, 6, rate)
        if (item.note) rows[rows.length - 1].note = item.note
      }
    } else {
      const best = circ.segs.reduce((a, s) => Math.max(a, rateOne(s)), 0)
      if (best > 0) pushRow(head, 6, best)
    }
  }

  }

  // 3. 声骸技能（主声骸）
  const echo = mainEchoSkill(detail)
  if (echo) {
    const base = num(src[echo.attr]) || 0
    if (base > 0) pushRow(`声骸技能·${echo.name}`, 9, echo.pct / 100, base)
  }

  return rows
}

/**
 * 立绘水平偏移（px）：让角色本体落在六个共鸣链图标正中上方。
 * 默认 207 = 按「人物躯干重心在立绘图宽 65%」推算；构图不同的角色单独调。
 * 算式：bgPosX = 共鸣链中心(198.8/1.4) - 立绘宽(520×1029/720)×0.65 + 548(立绘框 margin-left)
 */
const PIC_POS_X = {
  1102: 207,
}

/** 主角（漂泊者）可切换属性，显示名按当前属性区分：漂泊者·湮灭 / 漂泊者·气动 */
function displayRoleName (role) {
  const name = String(pick(role, 'roleName') || '未知角色')
  const elem = String(pick(role, 'attributeName') || '')
  if (role?.isMainRole && elem && !name.includes(elem)) return `${name}·${elem}`
  return name
}

export function buildPanelData(detail, ctx = {}) {
  const role = detail?.role || {}
  const elemName = String(pick(role, 'attributeName') || '')
  const roleDisplay = displayRoleName(role)
  const echoes = buildEchoes(detail)
  const echoAttrs = buildEchoAttrs(detail)
  const summary = buildEchoSummary(echoes)
  const consList = buildCons(detail)
  const consNum = consList.filter(c => c.on).length
  const roleId = num(pick(role, 'roleId', 'id', 'roleIdNum') ?? pick(detail, 'roleId', 'id'))

  const dmgRows = buildDamageRows(detail)
  const dmgNotes = [...new Set(dmgRows.map(r => r.note).filter(Boolean))]
  const multElemName = ELEM_ID_CN[loadMults()[roleId]?.element] || ''
  const elemMismatch = !!(multElemName && elemName && multElemName !== elemName && !role?.isMainRole)

  return {
    elem: ELEM_CLASS[elemName] || 'spectro',
    elemName,
    mainPic: pick(detail?.roleSkin, 'picUrl') || pick(role, 'rolePicUrl') || LOCAL_IMG + 'chun.png',
    skinName: pick(detail?.roleSkin, 'skinName') || '',
    picPosX: PIC_POS_X[roleId] ?? 207,
    charName: roleDisplay,
    uid: ctx.uid || pick(role, 'uid') || '',
    level: detail?.level ?? pick(role, 'level') ?? 0,
    consNum,
    consText: consNum ? `${consNum}链` : '',
    talents: buildTalents(detail),
    attrs: buildAttrs(detail),
    consList,
    dataSource: ctx.dataSource || '库街区',
    time: ctx.time || new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'),
    echoScore: summary.score,
    echoMark: summary.mark,
    echoRule: `评分规则：${roleDisplay}-通用`,
    echoAttrs,
    // 词条区固定 3 行、列优先填充（miao 原版：一列填满 3 条再换列，列宽恒 1/3，不足 3 条右边留空）
    echoAttrRows: 3,
    echoNotice: '声骸评分规则：副词条按「实际值 / 单条满值」归一后累加',
    echoes,
    weapon: buildWeapon(detail),
    dmgTitle: '伤害计算',
    dmgHint: `按角色技能等级 · 敌人90级 · 面板暴击${elemName ? ` · ${elemName}属性` : ''}`,
    dmgRows,
    dmgFooter: [
      ...(elemMismatch ? [`倍率表为${multElemName}版（${elemName}倍率未收录）`] : []),
      role?.isMainRole && loadTravelerSets()[elemName] ? '主角倍率来自库街区 wiki' : '倍率来自游戏数据表',
      ...dmgNotes, '面板来自库街区',
    ].join(' · '),
    copyright: 'Xiazhi-鸣潮面板',
    __local: LOCAL_IMG,
  }
}

/**
 * 立绘横向定位（%）。
 * 库街区立绘统一 1029x720 横版，人物本体普遍偏右；默认 78% 让本体落在卡片正中。
 * 个别被大件装饰带偏的（大伞 / 大披风）单独调。
 */
const PIC_POS = {
  锁暝: 93,
}

/** 武器类型 → 图标文件名（resources/img/wt_*.png，取自灰机 wiki 常态攻击图标） */
const WTYPE_ICON = {
  迅刀: 'xundao',
  长刃: 'changren',
  音感仪: 'yinzhi',
  佩枪: 'peiqiang',
  臂铠: 'bikai',
}

/** 鸣潮常驻池五星（开服至今没有新增，其余五星都是限定） */
const STANDARD_5 = new Set(['凌阳', '卡卡罗', '维里奈', '安可', '鉴心'])

/**
 * 排序权重：星级分组（五星组在前）→ 组内按主人定的优先级：
 * 等级降序 → 限定在常驻前（四星不区分）→ 链数降序；主角固定垫在五星组最后。
 */
const compareRoles = (a, b) => {
  const ga = a.starLevel >= 5 ? 0 : 1
  const gb = b.starLevel >= 5 ? 0 : 1
  if (ga !== gb) return ga - gb

  // 主角永远排在五星组最后一个
  if (a.isMain !== b.isMain) return a.isMain ? 1 : -1

  // 第一优先级：等级
  if (a.level !== b.level) return b.level - a.level

  // 第二优先级：限定 → 常驻（四星无视）
  if (a.starLevel >= 5) {
    const pa = STANDARD_5.has(a.name) ? 1 : 0
    const pb = STANDARD_5.has(b.name) ? 1 : 0
    if (pa !== pb) return pa - pb
  }

  // 第三优先级：链数高的优先
  return b.chain - a.chain
}

/**
 * 角色一览（缩略图墙）。
 * 输入是 /aki/roleBox/akiBox/roleData 的 roleList，输出 profile-list.html 的字段。
 * 按等级从高到低排，和游戏里日常看的顺序一致。
 */
export function buildListData(roleList, ctx = {}) {
  const weapons = ctx.weapons || {}
  const roles = (roleList || [])
    .map(r => {
      const elemName = String(pick(r, 'attributeName') || '')
      const starLevel = Math.max(0, Math.min(5, num(pick(r, 'starLevel'))))
      const rawName = String(pick(r, 'roleName', 'name') || '未知角色')
      const name = displayRoleName(r)
      const w = weapons[String(pick(r, 'roleId'))] || null
      return {
        name,
        level: num(pick(r, 'level')),
        elem: ELEM_CLASS[elemName] || 'spectro',
        elemName: elemName || '未知',
        // 用户当前穿戴的皮肤立绘优先（roleData 自带 roleSkin；无皮肤时回落到默认立绘）
        pic: pick(r?.roleSkin, 'picUrl') || pick(r, 'rolePicUrl') || pick(r, 'roleIconUrl') || '',
        skinName: String(pick(r?.roleSkin, 'skinName') || ''),
        picPos: PIC_POS[rawName] ?? 78,
        starLevel,
        stars: '★'.repeat(starLevel),
        // 星星改用 PNG 图（★ 字形太小，inline SVG 在 shotium 引擎下整块不渲染）
        starList: Array.from({ length: starLevel }, (_, i) => i),
        starImg: starLevel >= 5 ? 'gold' : 'purple',
        chain: num(pick(r, 'chainUnlockNum')),
        isMain: !!pick(r, 'isMainRole'),
        weapon: pick(r, 'weaponTypeName') || '',
        wtype: WTYPE_ICON[pick(r, 'weaponTypeName')] || '',
        equipName: w?.name || '',
        equipIcon: w?.icon || '',
        equipStar: Number(w?.star || 0),
        equipReson: Number(w?.reson || 0),
      }
    })
    // 排序：五星组 → 四星组；组内 等级降序 → 限定/常驻 → 链数降序；主角垫五星组最后
    .sort(compareRoles)

  return {
    roles,
    count: roles.length,
    uid: ctx.uid || '',
    serverName: ctx.serverName || '',
    dataSource: ctx.dataSource || '库街区',
    time: ctx.time || new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-'),
    copyright: 'Xiazhi-鸣潮面板',
  }
}

export { ELEM_CLASS, ATTR_ROWS, PROP_KEY }
