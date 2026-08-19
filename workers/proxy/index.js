// Cloudflare Worker: proxy HLS de MeteGol.
// Port de lib/proxy.js + lib/extractor.js del addon (sin express).
// En cada peticion re-extrae la playlist desde la IP del Worker, asi el token
// del playback coincide con la IP que descarga los segmentos (bloqueo fubo18).

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

const M3U8_CT = 'application/vnd.apple.mpegurl; charset=utf-8'
const CORS = { 'Access-Control-Allow-Origin': '*' }

// ================= extractor (lib/extractor.js) =================

function extractObfuscatedPlaybackUrl(html) {
  const pairsRe = /\[(\d+),"([A-Za-z0-9+/=]+)"\]/g
  const pairs = []
  let m
  while ((m = pairsRe.exec(html))) {
    pairs.push([parseInt(m[1], 10), m[2]])
  }
  if (!pairs.length) return null

  const kRe = /var\s+k\s*=\s*(\w+)\(\)\s*\+\s*(\w+)\(\);[\s\S]*?function\s+\1\(\)\s*\{\s*return\s+(\d+);\}[\s\S]*?function\s+\2\(\)\s*\{\s*return\s+(\d+);\}/
  const km = html.match(kRe)
  if (!km) return null
  const k = parseInt(km[3], 10) + parseInt(km[4], 10)

  pairs.sort((a, b) => a[0] - b[0])

  let url = ''
  for (const [, b64] of pairs) {
    try {
      const binary = Buffer.from(b64, 'base64').toString('latin1')
      const digits = binary.replace(/\D/g, '')
      if (!digits) continue
      url += String.fromCharCode(parseInt(digits, 10) - k)
    } catch (e) {
      return null
    }
  }
  return url || null
}

function extractPlaybackUrl(html) {
  const re = /(?:playbackURL|playbackUrl|playback_url|playbackurl|var\s+url)\s*=\s*"([^"]+)"/i
  const m = html.match(re)
  if (m && m[1]) return m[1].replace(/\\\//g, '/').replace(/\\/g, '')

  const obf = extractObfuscatedPlaybackUrl(html)
  if (obf) return obf

  const m3u8 = html.match(/https?:\\?\/\\?\/[^"'\s\\]+\.m3u8[^"'\s]*/i)
  if (m3u8) return m3u8[0].replace(/\\\//g, '/')

  return null
}

// ================= proxy (lib/proxy.js) =================

const CACHE = new Map()
function cacheGet(key) {
  const e = CACHE.get(key)
  if (e && Date.now() - e.ts < e.ttl) return e.value
  return undefined
}
function cacheSet(key, value, ttl) {
  CACHE.set(key, { value, ts: Date.now(), ttl })
  if (CACHE.size > 200) {
    const first = CACHE.keys().next().value
    if (first) CACHE.delete(first)
  }
}

async function fetchBuffer(url, referer, tries = 3) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      const headers = { 'User-Agent': UA, 'Accept': '*/*' }
      if (referer) headers['Referer'] = referer
      const res = await fetch(url, { headers, redirect: 'follow' })
      if (!res.ok) throw new Error('HTTP ' + res.status + ' en ' + url)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      lastErr = err
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)))
    }
  }
  throw lastErr
}

function resolveUrl(line, baseUrl) {
  try {
    return new URL(line.trim(), baseUrl).toString()
  } catch (_) {
    return null
  }
}

function extOf(target) {
  try {
    const m = /\.([a-zA-Z0-9]+)$/.exec(new URL(target).pathname)
    return m ? m[1].toLowerCase() : 'ts'
  } catch (_) {
    return 'ts'
  }
}

function basenameOf(target) {
  try {
    return decodeURIComponent(new URL(target).pathname.split('/').pop())
  } catch (_) {
    return target
  }
}

function proxiedUrl(publicBase, target, forcedExt) {
  const ext = forcedExt || extOf(target)
  return publicBase + '/proxy/seg.' + ext + '?url=' + encodeURIComponent(target)
}

function pageSegUrl(publicBase, pageUrl, absUrl, idx, v) {
  const ext = extOf(absUrl)
  const vPart = v !== undefined && v !== null && v >= 0 ? '&v=' + v : ''
  return (
    publicBase +
    '/proxy/seg.' +
    ext +
    '?url=' +
    encodeURIComponent(absUrl) +
    '&page=' +
    encodeURIComponent(pageUrl) +
    vPart +
    '&idx=' +
    idx
  )
}

function pageSegNameUrl(publicBase, pageUrl, absUrl, forcedExt) {
  const ext = forcedExt || extOf(absUrl)
  return (
    publicBase +
    '/proxy/seg.' +
    ext +
    '?url=' +
    encodeURIComponent(absUrl) +
    '&page=' +
    encodeURIComponent(pageUrl) +
    '&name=' +
    encodeURIComponent(basenameOf(absUrl))
  )
}

function rewritePlaylist(text, playlistUrl, publicBase, pageUrl, v) {
  const base = new URL(playlistUrl)
  let idx = 0
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim()
      if (!t) return line
      if (t.startsWith('#')) {
        if (/URI=/.test(t)) {
          return t.replace(/URI="([^"]+)"/g, (m, uri) => {
            const abs = resolveUrl(uri, base)
            if (!abs) return m
            const isKey = /#EXT-X-KEY/.test(t)
            return (
              'URI="' +
              (pageUrl
                ? pageSegNameUrl(publicBase, pageUrl, abs, isKey ? 'key' : null)
                : proxiedUrl(publicBase, abs, isKey ? 'key' : null)) +
              '"'
            )
          })
        }
        return line
      }
      const abs = resolveUrl(t, base)
      if (!abs) return line
      if (pageUrl) {
        const out = pageSegUrl(publicBase, pageUrl, abs, idx, v)
        idx++
        return out
      }
      return proxiedUrl(publicBase, abs)
    })
    .join('\n')
}

function jsonResponse(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  })
}

function binaryResponse(buf, mime) {
  return new Response(buf, {
    headers: { 'Content-Type': mime, 'Accept-Ranges': 'bytes', ...CORS }
  })
}

async function handlePageSegment(u, base) {
  const directUrl = u.searchParams.get('url')
  const pageUrl = u.searchParams.get('page')
  const name = u.searchParams.get('name')
  const idxRaw = u.searchParams.get('idx')
  const vRaw = u.searchParams.get('v')
  const idx = idxRaw === null ? -1 : parseInt(idxRaw, 10)
  const vIdx = vRaw === null ? -1 : parseInt(vRaw, 10)
  if (!pageUrl || !/^https?:\/\//.test(pageUrl) || (idx < 0 && !name)) {
    return jsonResponse(400, { err: 'faltan page/idx o page/name' })
  }
  const referer = new URL(pageUrl).origin + '/'

  try {
    // 1) atajo directo: solo para recursos binarios (no variantes m3u8)
    if (directUrl && /^https?:\/\//.test(directUrl) && extOf(directUrl) !== 'm3u8') {
      try {
        const buf = await fetchBuffer(directUrl, referer)
        return binaryResponse(buf, extOf(directUrl) === 'key' ? 'application/octet-stream' : 'video/mp2t')
      } catch (_) {
        // IP distinta o segmento expirado: seguir con re-extraccion
      }
    }

    // 2) pagina del canal (cache corta por instancia)
    const pageKey = 'page:' + pageUrl
    let html = cacheGet(pageKey)
    if (!html) {
      html = (await fetchBuffer(pageUrl, referer)).toString('utf8')
      cacheSet(pageKey, html, 10000)
    }
    const embedded = extractPlaybackUrl(html)
    if (!embedded) throw new Error('sin URL de playback en ' + pageUrl)

    // 3) playlist que contiene el recurso (siempre fresca en live)
    let containerUrl = embedded
    let containerText = null
    if (vIdx >= 0) {
      const masterText = (await fetchBuffer(embedded, referer)).toString('utf8')
      if (!masterText.includes('#EXTM3U')) throw new Error('master no valido')
      const mLines = masterText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      const baseM = new URL(embedded)
      if (!mLines.length) throw new Error('master sin variantes')
      const pick = Math.min(vIdx, mLines.length - 1)
      const variantAbs = resolveUrl(mLines[pick], baseM)
      if (!variantAbs || extOf(variantAbs) !== 'm3u8') throw new Error('variante invalida')
      containerUrl = variantAbs
      containerText = (await fetchBuffer(variantAbs, referer)).toString('utf8')
    } else {
      containerText = (await fetchBuffer(embedded, referer)).toString('utf8')
    }
    if (!containerText.includes('#EXTM3U')) throw new Error('playlist no valida')

    // 4) elegir el recurso: por indice (fallback al mas nuevo) o nombre
    const lines = containerText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    const base = new URL(containerUrl)
    if (!lines.length) throw new Error('playlist sin recursos')

    let line = null
    if (idx >= 0) {
      line = lines[Math.min(idx, lines.length - 1)]
    } else {
      line = lines.find((l) => {
        const abs = resolveUrl(l, base)
        return abs && basenameOf(abs) === name
      }) || null
    }
    if (!line) throw new Error('recurso no encontrado')

    // 5) variante m3u8: reescribir sus segmentos contra la misma pagina
    const abs0 = resolveUrl(line, base)
    if (extOf(abs0) === 'm3u8') {
      const vText = (await fetchBuffer(abs0, referer)).toString('utf8')
      if (!vText.includes('#EXTM3U')) throw new Error('variante no valida')
      const vPos = vIdx >= 0 ? vIdx : idx
      const rewritten = rewritePlaylist(vText, abs0, base, pageUrl, vPos)
      return new Response(rewritten, { headers: { 'Content-Type': M3U8_CT, ...CORS } })
    }

    // 6) segmento/clave: intentar el pedido y, si expiro (404) o la IP no
    // coincide (403), ir hacia atras desde el mas nuevo hasta conseguir uno
    const order = [Math.min(idx >= 0 ? idx : lines.length - 1, lines.length - 1)]
    for (let i = lines.length - 1; i >= 0 && order.length < 4; i--) {
      if (!order.includes(i)) order.push(i)
    }
    let buf = null
    let lastErr = null
    for (const i of order) {
      const abs = resolveUrl(lines[i], base)
      if (!abs) continue
      try {
        buf = await fetchBuffer(abs, referer)
        lastErr = null
        break
      } catch (err) {
        lastErr = err
      }
    }
    if (!buf) throw (lastErr || new Error('sin segmento disponible'))
    const mime = extOf(abs0) === 'key' ? 'application/octet-stream' : 'video/mp2t'
    return binaryResponse(buf, mime)
  } catch (err) {
    return jsonResponse(502, { err: err.message })
  }
}

async function proxyHandler(request) {
  const u = new URL(request.url)
  const base = u.origin

  if (u.searchParams.get('page') && (u.searchParams.get('name') || u.searchParams.get('idx') !== null)) {
    return handlePageSegment(u, base)
  }

  const target = u.searchParams.get('url')
  if (!target || !/^https?:\/\//.test(target)) {
    return jsonResponse(400, { err: 'url invalida' })
  }

  const referer = new URL(target).origin + '/'
  try {
    const buf = await fetchBuffer(target, referer)
    const text = buf.toString('utf8')

    if (text.includes('#EXTM3U')) {
      const rewritten = rewritePlaylist(text, target, base)
      return new Response(rewritten, { headers: { 'Content-Type': M3U8_CT, ...CORS } })
    }

    // canal.php: extraer el m3u8 real y reescribirlo contra la pagina (pageUrl)
    const embedded = extractPlaybackUrl(text)
    if (embedded) {
      const sub = await fetchBuffer(embedded, referer)
      const subText = sub.toString('utf8')
      if (subText.includes('#EXTM3U')) {
        const rewritten = rewritePlaylist(subText, embedded, base, target)
        return new Response(rewritten, { headers: { 'Content-Type': M3U8_CT, ...CORS } })
      }
    }

    // segmento o archivo binario
    const mime = u.searchParams.get('type') || 'video/mp2t'
    return binaryResponse(buf, mime)
  } catch (err) {
    return jsonResponse(502, { err: err.message })
  }
}

export default {
  async fetch(request) {
    const u = new URL(request.url)
    if (u.pathname === '/proxy' || u.pathname.startsWith('/proxy/')) {
      return proxyHandler(request)
    }
    return jsonResponse(404, { err: 'not found' })
  }
}