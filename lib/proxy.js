'use strict'

// Proxy HLS: el addon descarga el m3u8 y cada segmento desde su propia IP
// (la que coincide con el token generado), y se los sirve al reproductor.
// Esto resuelve el bloqueo por IP de datacenter en deploy serverless.

const { DEFAULT_HEADERS } = require('./common')

const UA = DEFAULT_HEADERS['User-Agent']

async function fetchBuffer(url, referer) {
  const headers = { 'User-Agent': UA, 'Accept': '*/*' }
  if (referer) headers['Referer'] = referer
  const res = await fetch(url, { headers, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

// Convierte una URL relativa en absoluta respecto a la playlist
function resolveUrl(line, baseUrl) {
  try {
    return new URL(line.trim(), baseUrl).toString()
  } catch (_) {
    return null
  }
}

// Reescribe una playlist HLS para que cada segmento/variante pase por /proxy
function rewritePlaylist(text, playlistUrl, proxyPrefix) {
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
            return `URI="${proxyPrefix}${encodeURIComponent(abs)}"`
          })
        }
        return line
      }
      const abs = resolveUrl(t, base)
      if (!abs) return line
      return proxyPrefix + encodeURIComponent(abs)
    })
    .join('\n')
}

function makeProxyPrefix(baseUrl) {
  return `${baseUrl}/proxy?url=`
}

// En Vercel la base pública viene de la env; en local se deriva del request
function publicPrefix(req) {
  if (process.env.PUBLIC_BASE_URL) return makeProxyPrefix(process.env.PUBLIC_BASE_URL)
  return makeProxyPrefix(req.protocol + '://' + req.get('host'))
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
      const prefix = publicPrefix(req)
      const rewritten = rewritePlaylist(text, target, prefix)
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8')
      res.setHeader('Access-Control-Allow-Origin', '*')
      return res.end(rewritten)
    }

    // segmento o archivo binario: servirlo tal cual
    res.setHeader('Content-Type', req.query.type || 'video/mp2t')
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
  proxyHandler
}