/**
 * 极验 v4 滑块自动通过（纯 Node，无外部依赖）
 *
 * 流程：load 取图 → Canny 边缘 + 归一化互相关找缺口 → 生成轨迹参数
 *      → AES+RSA 生成 w → verify 换 seccode（JSON 字符串）
 *
 * 算法来源（思路，非代码搬运）：GeekedTest / geetest v4 公开分析
 *  - w = hex(AES-128-CBC(JSON, key=随机16字符, iv='0'x16)) + RSA_PKCS1(key)
 *  - 极验新版还会从 lot_number 里切出几个动态字段，一并塞进 JSON
 */
import crypto from 'node:crypto'
import zlib from 'node:zlib'

const RSA_N_HEX =
  'C1E3934D1614465B33053E7F48EE4EC87B14B95EF88947713D25EECBFF7E74C7977D02DC1D9451F79DD5D1C10C29ACB6A9B4D6FB7D0A0279B6719E1772565F09AF627715919221AEF91899CAE08C0D686D748B20A3603BE2318CA6BC2B59706592A9219D0BF05C9F65023A21D2330807252AE0066D59CEEFA5F2748EA80BAB81'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'
const HOST = 'https://gcaptcha4.geetest.com'
const STATIC = 'https://static.geetest.com/'

/* ---------------- PNG 解码 ---------------- */

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  let palette = null
  let trns = null
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'PLTE') palette = Buffer.from(data)
    else if (type === 'tRNS') trns = Buffer.from(data)
    else if (type === 'IDAT') idat.push(Buffer.from(data))
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error('不支持的 PNG 变体')
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error('不支持的 colorType')
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(width * height * 4)
  const cur = Buffer.alloc(stride)
  const prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const off = y * (stride + 1)
    const filter = raw[off]
    for (let i = 0; i < stride; i++) cur[i] = raw[off + 1 + i]
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v = cur[i]
      if (filter === 1) v = (v + a) & 255
      else if (filter === 2) v = (v + b) & 255
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
      cur[i] = v
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      let r
      let g
      let bb
      let a = 255
      if (colorType === 0) {
        r = g = bb = cur[x]
      } else if (colorType === 2) {
        r = cur[x * 3]
        g = cur[x * 3 + 1]
        bb = cur[x * 3 + 2]
      } else if (colorType === 3) {
        const idx = cur[x]
        r = palette[idx * 3]
        g = palette[idx * 3 + 1]
        bb = palette[idx * 3 + 2]
        if (trns && idx < trns.length) a = trns[idx]
      } else if (colorType === 4) {
        r = g = bb = cur[x * 2]
        a = cur[x * 2 + 1]
      } else {
        r = cur[x * 4]
        g = cur[x * 4 + 1]
        bb = cur[x * 4 + 2]
        a = cur[x * 4 + 3]
      }
      out[o] = r
      out[o + 1] = g
      out[o + 2] = bb
      out[o + 3] = a
    }
    cur.copy(prev)
  }
  return { width, height, data: out }
}

/* ---------------- 灰度 / Canny / 模板匹配 ---------------- */

function toGray(img) {
  const { width, height, data } = img
  const g = new Float32Array(width * height)
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    const a = data[p + 3] / 255
    g[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) * a
  }
  return g
}

function gaussBlur(src, w, h) {
  const k = [1, 4, 6, 4, 1]
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      let sum = 0
      for (let i = -2; i <= 2; i++) {
        const xx = x + i
        if (xx < 0 || xx >= w) continue
        s += src[y * w + xx] * k[i + 2]
        sum += k[i + 2]
      }
      tmp[y * w + x] = s / sum
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      let sum = 0
      for (let i = -2; i <= 2; i++) {
        const yy = y + i
        if (yy < 0 || yy >= h) continue
        s += tmp[yy * w + x] * k[i + 2]
        sum += k[i + 2]
      }
      out[y * w + x] = s / sum
    }
  return out
}

/** Canny 边缘（二值 0/1），返回 Float32Array */
function canny(gray, w, h, low = 100, high = 200) {
  const g = gaussBlur(gray, w, h)
  const mag = new Float32Array(w * h)
  const ang = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const p = (yy, xx) => g[yy * w + xx]
      const gx =
        -p(y - 1, x - 1) + p(y - 1, x + 1) - 2 * p(y, x - 1) + 2 * p(y, x + 1) - p(y + 1, x - 1) + p(y + 1, x + 1)
      const gy =
        -p(y - 1, x - 1) - 2 * p(y - 1, x) - p(y - 1, x + 1) + p(y + 1, x - 1) + 2 * p(y + 1, x) + p(y + 1, x + 1)
      mag[i] = Math.hypot(gx, gy)
      ang[i] = Math.atan2(gy, gx)
    }
  const nms = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const a = ((ang[i] * 180) / Math.PI + 180) % 180
      let dx
      let dy
      if (a < 22.5 || a >= 157.5) {
        dx = 1
        dy = 0
      } else if (a < 67.5) {
        dx = 1
        dy = -1
      } else if (a < 112.5) {
        dx = 0
        dy = 1
      } else {
        dx = -1
        dy = -1
      }
      const m = mag[i]
      if (m >= mag[(y + dy) * w + (x + dx)] && m >= mag[(y - dy) * w + (x - dx)]) nms[i] = m
    }
  const edge = new Float32Array(w * h)
  const stack = []
  for (let i = 0; i < w * h; i++)
    if (nms[i] >= high) {
      edge[i] = 1
      stack.push(i)
    }
  while (stack.length) {
    const i = stack.pop()
    const y = (i / w) | 0
    const x = i % w
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy
        const xx = x + dx
        if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue
        const j = yy * w + xx
        if (!edge[j] && nms[j] >= low) {
          edge[j] = 1
          stack.push(j)
        }
      }
  }
  return edge
}

/** 归一化互相关，返回最佳位置 */
function nccBest(bgArr, bgW, bgH, tplArr, tw, th) {
  let sumT = 0
  for (let i = 0; i < tplArr.length; i++) sumT += tplArr[i]
  const mT = sumT / tplArr.length
  let vT = 0
  for (let i = 0; i < tplArr.length; i++) {
    const d = tplArr[i] - mT
    vT += d * d
  }
  const sT = Math.sqrt(vT) || 1e-9
  let best = -Infinity
  let bestX = 0
  let bestY = 0
  for (let y = 0; y <= bgH - th; y++)
    for (let x = 0; x <= bgW - tw; x++) {
      let sum = 0
      let sum2 = 0
      let cross = 0
      for (let ty = 0; ty < th; ty++) {
        const br = (y + ty) * bgW + x
        const tr = ty * tw
        for (let tx = 0; tx < tw; tx++) {
          const v = bgArr[br + tx]
          sum += v
          sum2 += v * v
          cross += v * tplArr[tr + tx]
        }
      }
      const n = tw * th
      const m = sum / n
      const variance = sum2 - sum * m
      if (variance <= 1e-6) continue
      const score = (cross - m * mT * n) / (Math.sqrt(variance) * sT)
      if (score > best) {
        best = score
        bestX = x
        bestY = y
      }
    }
  return { score: best, x: bestX, y: bestY }
}

/* ---------------- w 生成 ---------------- */

const PUBLIC_KEY = crypto.createPublicKey({
  key: {
    kty: 'RSA',
    n: Buffer.from(RSA_N_HEX, 'hex').toString('base64url'),
    e: Buffer.from('010001', 'hex').toString('base64url'),
  },
  format: 'jwk',
})

function randUid() {
  let s = ''
  for (let i = 0; i < 4; i++) s += (Math.floor(65536 * (1 + Math.random())) & 0xffff).toString(16).padStart(4, '0').slice(-4)
  return s
}

function encryptW(raw, pt) {
  if (!pt || pt === '0') return encodeURIComponent(raw)
  const key = randUid()
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), Buffer.from('0000000000000000'))
  const enc = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]).toString('hex')
  const encKey = crypto
    .publicEncrypt({ key: PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(key, 'utf8'))
    .toString('hex')
  return enc + encKey
}

/** 极验新版防逆向字段：从 lot_number 里按固定下标切出来 */
function lotDict(lot) {
  const seg = (s, e) => lot.slice(s, e + 1)
  const k1 = seg(28, 28) + seg(17, 17)
  const k2 = seg(5, 9)
  const k3 = seg(0, 0) + seg(15, 15) + seg(25, 25) + seg(30, 30)
  return { [k1]: { [k2]: { [k3]: seg(22, 26) } } }
}

function generatePow(lotNumber, captchaId, powDetail) {
  const { hashfunc = 'md5', version = '1', bits = 0, datetime } = powDetail || {}
  const base = `${version}|${bits}|${hashfunc}|${datetime}|${captchaId}|${lotNumber}||`
  const zeros = '0'.repeat(bits >> 2)
  const extra = bits % 4
  const maxChar = extra === 1 ? '7' : extra === 2 ? '3' : extra === 3 ? '1' : ''
  for (let i = 0; i < 200000; i++) {
    const msg = base + randUid()
    const sign = crypto.createHash('md5').update(msg).digest('hex')
    if (sign.startsWith(zeros) && (!maxChar || sign[bits >> 2] <= maxChar)) return { pow_msg: msg, pow_sign: sign }
  }
  throw new Error('pow 生成失败')
}

/* ---------------- HTTP ---------------- */

function callbackName() {
  return `geetest_${Math.floor(Math.random() * 10000) + Date.now()}`
}

async function fetchText(url, params) {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(url + '?' + qs, {
    headers: { 'User-Agent': UA, Referer: 'https://www.geetest.com/' },
    signal: AbortSignal.timeout(20000),
  })
  return res.text()
}

function parseCallback(text, name) {
  const i = text.indexOf(name + '(')
  const j = text.lastIndexOf(')')
  if (i < 0 || j < 0) throw new Error('极验响应格式异常')
  return JSON.parse(text.slice(i + name.length + 1, j))
}

/* ---------------- 求解 ---------------- */

/**
 * 过极验 v4 滑块，返回 seccode 的 JSON 字符串（直接给库街区 geeTestData 用）
 * @param {string} captchaId
 * @param {{retries?: number}} opts
 */
export async function solveGeetest(captchaId = '3f7e2d848ce0cb7e7d019d621e556ce2', opts = {}) {
  const retries = opts.retries ?? 3
  let lastErr = null
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const seccode = await solveOnce(captchaId)
      return seccode
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error('极验求解失败')
}

async function solveOnce(captchaId) {
  const c1 = callbackName()
  const loadText = await fetchText(`${HOST}/load`, {
    callback: c1,
    captcha_id: captchaId,
    client_type: 'web',
    pt: '1',
    lang: 'zho',
  })
  const loadJson = parseCallback(loadText, c1)
  const data = loadJson.data
  if (!data || !data.bg) throw new Error('极验 load 没给图')

  const [bgBuf, slBuf] = await Promise.all([
    fetch(STATIC + data.bg, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }).then(r =>
      r.arrayBuffer(),
    ),
    fetch(STATIC + data.slice, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }).then(r =>
      r.arrayBuffer(),
    ),
  ])
  const bg = decodePng(Buffer.from(bgBuf))
  const sl = decodePng(Buffer.from(slBuf))

  // 拼图块：透明通道之外置 0，避免透明区影响边缘
  const slGray = toGray(sl)
  const tplGray = new Float32Array(sl.width * sl.height)
  for (let i = 0; i < sl.width * sl.height; i++) {
    tplGray[i] = sl.data[i * 4 + 3] > 128 ? slGray[i] : 0
  }
  const bgEdge = canny(toGray(bg), bg.width, bg.height)
  const tplEdge = canny(tplGray, sl.width, sl.height)
  const best = nccBest(bgEdge, bg.width, bg.height, tplEdge, sl.width, sl.height)
  if (best.score < 0.05) throw new Error('缺口没找到（score ' + best.score.toFixed(3) + '）')

  const left = best.x + sl.width / 2 - 41
  const base = {
    bzj5: 'MoPY',
    ...generatePow(data.lot_number, captchaId, data.pow_detail),
    ...lotDict(data.lot_number),
    biht: '1426265548',
    device_id: '',
    em: { cp: 0, ek: '11', nt: 0, ph: 0, sc: 0, si: 0, wd: 1 },
    gee_guard: { roe: { auh: '3', aup: '3', cdc: '3', egp: '3', res: '3', rew: '3', sep: '3', snh: '3' } },
    ep: '123',
    geetest: 'captcha',
    lang: 'zh',
    lot_number: data.lot_number,
    passtime: 600 + Math.floor(Math.random() * 600),
    setLeft: left,
    userresponse: left / 1.0059466666666665 + 2,
  }
  const w = encryptW(JSON.stringify(base), data.pt)

  const c2 = callbackName()
  const verifyText = await fetchText(`${HOST}/verify`, {
    callback: c2,
    captcha_id: captchaId,
    client_type: 'web',
    lot_number: data.lot_number,
    payload: data.payload,
    process_token: data.process_token,
    payload_protocol: '1',
    pt: '1',
    w,
  })
  const verifyJson = parseCallback(verifyText, c2)
  const d = verifyJson.data || {}
  if (d.result !== 'success' || !d.seccode) throw new Error('极验验证未通过：' + (d.result || verifyJson.status))
  return JSON.stringify(d.seccode)
}
