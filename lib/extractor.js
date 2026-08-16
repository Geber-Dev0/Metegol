'use strict'

const { fetchText } = require('./scraper')

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8'
}

// Reconstruye la URL de playback ofuscada en el formato:
//   playbackURL=""; kv=[[idx,"base64"],...]; kv.sort(...);
//   var k=fnA()+fnB(); ... playbackURL+=String.fromCharCode(parseInt(atob(v).replace(/\D/g,''))-k)
// Cada par base64 decodifica a una cadena binaria cuyos digitos, menos k, dan un charCode.
function extractObfuscatedPlaybackUrl(html) {
  const pairsRe = /\[(\d+),"([A-Za-z0-9+/=]+)"\]/g
  const pairs = []
  let m
  while ((m = pairsRe.exec(html))) {
    pairs.push([parseInt(m[1], 10), m[2]])
  }
  if (!pairs.length) return null

  // captura "var k=UZwZw()+bBeFW(); ... function UZwZw(){return 76333;} ... function bBeFW(){return 666404;}"
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

// Extrae la URL de playback (m3u8) del HTML del reproductor de terceros.
// Soporta formato "playbackURL = \"...\"" con barras escapadas (\\) y sin escapar.
function extractPlaybackUrl(html) {
  // captura playbackURL, playbackUrl, playback_url, playbackurl, var url etc. entre comillas
  const re = /(?:playbackURL|playbackUrl|playback_url|playbackurl|var\s+url)\s*=\s*"([^"]+)"/i
  const m = html.match(re)
  if (m && m[1]) return m[1].replace(/\\\//g, '/').replace(/\\/g, '')

  // fallback: formato ofuscado (playbackURL="" + array base64 con clave k)
  const obf = extractObfuscatedPlaybackUrl(html)
  if (obf) return obf

  // fallback: buscar la primera URL .m3u8
  const m3u8 = html.match(/https?:\\?\/\\?\/[^"'\s\\]+\.m3u8[^"'\s]*/i)
  if (m3u8) return m3u8[0].replace(/\\\//g, '/')

  return null
}

// Obtiene el m3u8 real a partir de la URL del endpoint de terceros (resultado de decodeStreamUrl)
async function getStreamUrl(thirdPartyUrl, referer) {
  const headers = { ...DEFAULT_HEADERS }
  if (referer) headers['Referer'] = referer

  const html = await fetchText(thirdPartyUrl, headers)
  const url = extractPlaybackUrl(html)
  if (!url) {
    throw new Error('No se encontró URL de playback en: ' + thirdPartyUrl)
  }
  return url
}

module.exports = {
  extractPlaybackUrl,
  getStreamUrl
}
