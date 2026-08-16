'use strict'

// Proxy HLS: el addon descarga el m3u8 y cada segmento desde su propia IP
// (la que coincide con el token generado), y se los sirve al reproductor.
// Esto resuelve el bloqueo por IP de datacenter en deploy serverless.

const { DEFAULT_HEADERS } = require('./common')
const { extractPlaybackUrl } = require('./extractor')

const UA = DEFAULT_HEADERS['User-Agent']

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

// URL del proxy con extension correcta para que players estrictos (ffmpeg/libvlc)
// acepten el segmento. El target real viaja en el query param ?url=
function proxiedUrl(publicBase, target, forcedExt) {
  const ext = forcedExt || extOf(target)
  return `${publicBase}/proxy/seg.${ext}?url=${encodeURIComponent(target)}`
}

// Reescribe una playlist HLS para que cada segmento/variante pase por /proxy
function rewritePlaylist(text, playlistUrl, publicBase) {
  const base = new URL(playlistUrl)
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
            return `URI="${proxiedUrl(publicBase, abs, isKey ? 'key' : null)}"`
          })
        }
        return line
      }
      const abs = resolveUrl(t, base)
      if (!abs) return line
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

// Express handler para GET /proxy?url=<url>
async function proxyHandler(req, res) {
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
    // Se hace aqui (misma IP que descargara los segmentos) para que el token
    // quede ligado a la IP del proxy y no de a 403 en serverless.
    const embedded = extractPlaybackUrl(text)
    if (embedded) {
      const sub = await fetchBuffer(embedded, referer)
      const subText = sub.toString('utf8')
      if (subText.includes('#EXTM3U')) {
        const rewritten = rewritePlaylist(subText, embedded, publicBase(req))
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