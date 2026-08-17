'use strict'

// Proxy HLS: el addon descarga el m3u8 y cada segmento desde su propia IP
// (la que coincide con el token generado), y se los sirve al reproductor.
// Esto resuelve el bloqueo por IP de datacenter en deploy serverless.
//
// Para fuentes tipo canal.php (fubo18), el token del segmento queda ligado a
// la IP que pidio la playlist. En serverless cada peticion puede caer en una
// instancia con distinta IP egress, asi que un segmento pedido por una
// instancia distinta a la que genero la playlist da 403. Para evitarlo, los
// segmentos de esas fuentes se reescriben a /proxy/seg.<ext>?page=<canal>:
// cada peticion re-extrae la playlist DENTRO de la misma invocacion, con la
// misma IP que descarga el segmento -> el token siempre coincide.

const { DEFAULT_HEADERS } = require('./common')
const { extractPlaybackUrl } = require('./extractor')

const UA = DEFAULT_HEADERS['User-Agent']

// Cache en memoria por instancia. Cada instancia serverless tiene una IP
// egress fija, asi que los tokens de una playlist cacheada por esa instancia
// siempre coinciden con la IP que la sirve. Si una peticion cae en otra
// instancia (sin cache), se re-extrae con su propia IP: igual de valido.
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

// Reintentos ante fallos transitorios de red/upstream (fubo18 suele dar timeouts
// intermitentes). El token es el mismo, asi que reintentar no regenera nada.
async function fetchBuffer(url, referer, tries = 3) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    try {
      const headers = { 'User-Agent': UA, 'Accept': '*/*' }
      if (referer) headers['Referer'] = referer
      const res = await fetch(url, { headers, redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      lastErr = err
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)))
    }
  }
  throw lastErr
}

// Convierte una URL relativa en absoluta respecto a la playlist
function resolveUrl(line, baseUrl) {
  try {
    return new URL(line.trim(), baseUrl).toString()
  } catch (_) {
    return null
  }
}

// Extension de archivo del recurso (segmento/variante/clave) segun su path
function extOf(target) {
  try {
    const m = /\.([a-zA-Z0-9]+)$/.exec(new URL(target).pathname)
    return m ? m[1].toLowerCase() : 'ts'
  } catch (_) {
    return 'ts'
  }
}

// Nombre de archivo del recurso (sin path ni query), para identificarlo
// dentro de la playlist re-extraida
function basenameOf(target) {
  try {
    return decodeURIComponent(new URL(target).pathname.split('/').pop())
  } catch (_) {
    return target
  }
}

// URL del proxy con extension correcta para que players estrictos (ffmpeg/libvlc)
// acepten el segmento. El target real viaja en el query param ?url=
function proxiedUrl(publicBase, target, forcedExt) {
  const ext = forcedExt || extOf(target)
  return `${publicBase}/proxy/seg.${ext}?url=${encodeURIComponent(target)}`
}

// URL del proxy para un recurso de una fuente tipo canal.php. Lleva la URL
// tokenizada (atajo directo: funciona si esta instancia coincide con la IP que
// genero el token) Y el contexto de re-extraccion (page + idx [+ v]) para
// re-extraer la playlist en la misma invocacion si el atajo falla por IP.
// Se usa idx (y no nombre) porque la pagina alterna entre nodos CDN con
// ventanas de segmentos ligeramente distintas: por idx siempre hay un
// segmento valido.
function pageSegUrl(publicBase, pageUrl, absUrl, idx, v) {
  const ext = extOf(absUrl)
  const vPart = v !== undefined && v !== null && v >= 0 ? `&v=${v}` : ''
  return `${publicBase}/proxy/seg.${ext}?url=${encodeURIComponent(absUrl)}&page=${encodeURIComponent(pageUrl)}${vPart}&idx=${idx}`
}

// Variante con nombre (para recursos estables que no rotan: claves EXT-X-KEY)
function pageSegNameUrl(publicBase, pageUrl, absUrl, forcedExt) {
  const ext = forcedExt || extOf(absUrl)
  return `${publicBase}/proxy/seg.${ext}?url=${encodeURIComponent(absUrl)}&page=${encodeURIComponent(pageUrl)}&name=${encodeURIComponent(basenameOf(absUrl))}`
}

// Reescribe una playlist HLS para que cada segmento/variante pase por /proxy.
// Si se pasa pageUrl (fuente tipo canal.php), los segmentos/variantes se
// reescriben por INDICE (pageSegUrl) para re-extraer la playlist por peticion
// (token/IP consistente) sin depender de nombres que rotan; las claves se
// reescriben por nombre. Si v>=0, esta playlist es la media de la variante v
// del master y sus segmentos lo llevan en el URL para ubicarlos a ese nivel.
function rewritePlaylist(text, playlistUrl, publicBase, pageUrl, v) {
  const base = new URL(playlistUrl)
  let idx = 0
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim()
      if (!t) return line
      if (t.startsWith('#')) {
        // reescribir URI="..." dentro de #EXT-X-KEY / #EXT-X-MAP / #EXT-X-MEDIA
        if (/URI=/.test(t)) {
          return t.replace(/URI="([^"]+)"/g, (m, uri) => {
            const abs = resolveUrl(uri, base)
            if (!abs) return m
            const isKey = /#EXT-X-KEY/.test(t)
            return `URI="${pageUrl ? pageSegNameUrl(publicBase, pageUrl, abs, isKey ? 'key' : null) : proxiedUrl(publicBase, abs, isKey ? 'key' : null)}"`
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

function makeProxyPrefix(baseUrl) {
  return `${baseUrl}/proxy?url=`
}

// En Vercel la base pública viene de la env; en local se deriva del request
function publicBase(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL
  return req.protocol + '://' + req.get('host')
}

// Sirve un recurso (segmento/variante/clave) de una fuente canal.php.
// Flujo:
//   1) Si el URL trae la URL tokenizada (?url=) y NO es una variante m3u8,
//      se intenta descargarla directamente: funciona cuando esta instancia
//      coincide con la IP que genero el token (caso comun en instancias
//      calientes). Es inmune a la rotacion de segmentos.
//   2) Si falla (403/404 por IP distinta o segmento expirado) o es una
//      variante, se RE-EXTRAE la playlist dentro de la misma invocacion
//      (token consistente con la IP) y se sirve el recurso por idx, con
//      fallback al segmento mas nuevo si el pedido ya expiro.
async function handlePageSegment(req, res) {
  const directUrl = req.query.url
  const pageUrl = req.query.page
  const name = req.query.name
  const idxRaw = req.query.idx
  const vRaw = req.query.v
  const idx = idxRaw === undefined ? -1 : parseInt(idxRaw, 10)
  const vIdx = vRaw === undefined ? -1 : parseInt(vRaw, 10)
  if (!pageUrl || typeof pageUrl !== 'string' || !/^https?:\/\//.test(pageUrl) || (idx < 0 && !name)) {
    return res.status(400).json({ err: 'faltan page/idx o page/name' })
  }
  const referer = new URL(pageUrl).origin + '/'

  try {
    // 1) atajo directo: solo para recursos binarios (no variantes m3u8)
    if (directUrl && /^https?:\/\//.test(directUrl) && extOf(directUrl) !== 'm3u8') {
      try {
        const buf = await fetchBuffer(directUrl, referer)
        res.setHeader('Content-Type', extOf(directUrl) === 'key' ? 'application/octet-stream' : 'video/mp2t')
        res.setHeader('Content-Length', buf.length)
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Access-Control-Allow-Origin', '*')
        return res.end(buf)
      } catch (_) {
        // IP distinta o segmento expirado: seguir con re-extraccion
      }
    }

    // 2) pagina del canal (cache corta por instancia)
    const pageKey = 'page:' + pageUrl
    let html = cacheGet(pageKey)
    if (!html) {
      html = (await fetchBuffer(pageUrl, referer)).toString('utf8')
      cacheSet(pageKey, html, 10_000)
    }
    const embedded = extractPlaybackUrl(html)
    if (!embedded) throw new Error('sin URL de playback en ' + pageUrl)

    // 3) playlist que contiene el recurso. Si v>=0 el recurso vive dentro de
    // la media playlist de una variante: primero bajamos master -> variante.
    // La media playlist se fetchea SIEMPRE fresca: en live sus segmentos rotan
    // y una copia cacheada apuntaria a segmentos ya expirados (404).
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

    // 4) elegir el recurso: por indice (con fallback al mas nuevo) o nombre
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

    // 5) si es una variante m3u8: reescribir sus segmentos contra la misma
    // pagina (con v=<posicion de esta variante>) y devolver la media playlist
    const abs0 = resolveUrl(line, base)
    if (extOf(abs0) === 'm3u8') {
      const vText = (await fetchBuffer(abs0, referer)).toString('utf8')
      if (!vText.includes('#EXTM3U')) throw new Error('variante no valida')
      const vPos = vIdx >= 0 ? vIdx : idx
      const rewritten = rewritePlaylist(vText, abs0, publicBase(req), pageUrl, vPos)
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8')
      res.setHeader('Access-Control-Allow-Origin', '*')
      return res.end(rewritten)
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
    res.setHeader('Content-Type', mime)
    res.setHeader('Content-Length', buf.length)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.end(buf)
  } catch (err) {
    return res.status(502).json({ err: err.message })
  }
}

// Express handler para GET /proxy?url=<url> y /proxy/seg.<ext>?page=<canal>
async function proxyHandler(req, res) {
  if (req.query.page && (req.query.name || req.query.idx !== undefined)) {
    return handlePageSegment(req, res)
  }

  const target = req.query.url
  if (!target || typeof target !== 'string' || !/^https?:\/\//.test(target)) {
    return res.status(400).json({ err: 'url invalida' })
  }

  const referer = new URL(target).origin + '/'
  try {
    const buf = await fetchBuffer(target, referer)
    const text = buf.toString('utf8')

    if (text.includes('#EXTM3U')) {
      // playlist: reescribir y devolver como m3u8
      const rewritten = rewritePlaylist(text, target, publicBase(req))
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8')
      res.setHeader('Access-Control-Allow-Origin', '*')
      return res.end(rewritten)
    }

    // Si el target no es un m3u8 (ej. canal.php de la18hd), puede ser la
    // pagina del reproductor: extraer el m3u8 real y servirlo reescrito.
    // Se reescriben los segmentos contra la pagina (pageUrl) para que cada
    // peticion re-extraiga la playlist con su propia IP (token consistente).
    const embedded = extractPlaybackUrl(text)
    if (embedded) {
      const sub = await fetchBuffer(embedded, referer)
      const subText = sub.toString('utf8')
      if (subText.includes('#EXTM3U')) {
        const rewritten = rewritePlaylist(subText, embedded, publicBase(req), target)
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8')
        res.setHeader('Access-Control-Allow-Origin', '*')
        return res.end(rewritten)
      }
    }

    // segmento o archivo binario: servirlo tal cual
    const mime = req.query.type || 'video/mp2t'
    res.setHeader('Content-Type', mime)
    res.setHeader('Content-Length', buf.length)
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.end(buf)
  } catch (err) {
    return res.status(502).json({ err: err.message })
  }
}

module.exports = {
  fetchBuffer,
  rewritePlaylist,
  makeProxyPrefix,
  publicBase,
  proxiedUrl,
  proxyHandler
}