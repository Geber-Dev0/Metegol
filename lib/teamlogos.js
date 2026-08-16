'use strict'

// Portadas de eventos: genera un PNG real (sharp) combinando escudos de los dos
// equipos (TheSportsDB), bandera del pais (agenda18) y textos con una fuente
// embebida (DejaVu Sans Bold, libre). Se sirve desde /poster/:id porque Stremio
// en Android no renderiza SVG data URI como posters.
// Vercel no tiene fuentes instaladas en su Linux, por eso se embebe la fuente
// como base64 dentro del SVG (librsvg la lee y no dibuja cajas vacias).

const sharp = require('sharp')
const fs = require('fs')
const path = require('path')
const { fetchText, fetchJson, isLiveNow } = require('./common')

const TSDB_SEARCH = 'https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t='

// Caché en memoria: nombre de equipo -> { badge, name } | null
const teamCache = new Map()
const TEAM_TTL_MS = 6 * 60 * 60 * 1000

// Caché de PNG ya generados: id -> buffer
const posterCache = new Map()
const POSTER_TTL_MS = 30 * 60 * 1000

// Fuente embebida (base64) cacheada; se lee una vez del archivo del proyecto
let fontFaceSvg = null
function getFontFace() {
  if (fontFaceSvg) return fontFaceSvg
  try {
    const fontPath = path.join(__dirname, '..', 'assets', 'DejaVuSans-Bold.ttf')
    const b64 = fs.readFileSync(fontPath).toString('base64')
    fontFaceSvg =
      `<style>@font-face { font-family: 'PosterFont'; src: url(data:font/ttf;base64,${b64}) format('truetype'); font-weight: bold; }</style>`
    return fontFaceSvg
  } catch (_) {
    return ''
  }
}

// Extrae hasta dos equipos de un titulo ("Liga: A vs B")
function parseTeams(title) {
  if (!title) return []
  let rest = title
  // quita el prefijo de liga antes del primer ":" si existe
  const colonIdx = title.indexOf(':')
  if (colonIdx !== -1 && colonIdx < title.length - 1) {
    rest = title.slice(colonIdx + 1).trim()
  }
  // separa por "vs" / "vs." / "v." (inglés y español)
  const parts = rest.split(/\s+v(?:s|s\.)?\.?\s+|@|–|—|-/i).map((s) => s.trim()).filter(Boolean)
  const teams = parts.slice(0, 2).map((t) => t.replace(/\(.*?\)/g, '').trim()).filter(Boolean)
  return teams
}

// Limpia el nombre para buscar en TheSportsDB
function cleanTeamName(name) {
  return name
    .replace(/ FC$/i, '')
    .replace(/\bFC\b/i, '')
    .replace(/^CF\s+/i, '')
    .replace(/[·–—()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Mapeo espanol -> ingles de paises para filtrar el escudo correcto en TheSportsDB
const COUNTRY_ES_EN = {
  'argentina': 'Argentina',
  'brasil': 'Brazil',
  'chile': 'Chile',
  'colombia': 'Colombia',
  'ecuador': 'Ecuador',
  'estados unidos': 'USA',
  'mexico': 'Mexico',
  'peru': 'Peru',
  'paraguay': 'Paraguay',
  'uruguay': 'Uruguay',
  'venezuela': 'Venezuela',
  'bolivia': 'Bolivia',
  'bolivia (estado plurinacional de)': 'Bolivia',
  'espana': 'Spain',
  'españa': 'Spain',
  'inglaterra': 'England',
  'alemania': 'Germany',
  'francia': 'France',
  'italia': 'Italy',
  'holanda': 'Netherlands',
  'paises bajos': 'Netherlands',
  'paises bajos (los)': 'Netherlands',
  'portugal': 'Portugal',
  'belgica': 'Belgium',
  'arabia saudita': 'Saudi Arabia',
  'turquia': 'Turkey',
  'japon': 'Japan',
  'corea del sur': 'South Korea'
}

function countryToEn(country) {
  if (!country) return null
  const c = String(country).toLowerCase().trim()
  return COUNTRY_ES_EN[c] || null
}

// Elige entre varios equipos devueltos por TheSportsDB el que coincide con el
// pais/liga del evento (los nombres de equipos se repiten entre paises)
function pickTeamByCountry(teams, country) {
  if (!Array.isArray(teams) || !teams.length) return null
  const en = countryToEn(country)
  if (en) {
    const match = teams.find((t) => (t.strCountry || '').toLowerCase() === en.toLowerCase())
    if (match) return match
  }
  // fallback: el primero con badge
  return teams.find((t) => t.strBadge) || teams[0]
}

async function searchTeam(team, country) {
  const cacheKey = team.toLowerCase() + '|' + (country || '').toLowerCase()
  const cached = teamCache.get(cacheKey)
  if (cached && Date.now() - cached.time < TEAM_TTL_MS) return cached.result

  let result = null
  try {
    const json = await fetchJson(TSDB_SEARCH + encodeURIComponent(team), {}, 10000)
    const teams = json && json.teams
    if (Array.isArray(teams) && teams.length) {
      const chosen = pickTeamByCountry(teams, country)
      if (chosen && chosen.strBadge) {
        result = { badge: chosen.strBadge, name: chosen.strTeam }
      }
    }
  } catch (_) {
    result = null
  }
  teamCache.set(cacheKey, { time: Date.now(), result })
  return result
}

// Descarga una imagen y la devuelve como data URI base64 (para embeber en el SVG)
async function loadImageAsDataUri(url, timeoutMs = 8000) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res
    try {
      res = await fetch(url, { signal: controller.signal })
      if (!res.ok) throw new Error('HTTP ' + res.status)
    } finally {
      clearTimeout(timer)
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    return 'data:image/png;base64,' + buffer.toString('base64')
  } catch (_) {
    return null
  }
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Ajusta el ancho de un texto para que no se desborde del poster
function fitTextSize(text, maxWidthPx, baseSize, minSize = 16) {
  // estimacion gruesa: ~0.55 * fontsize por caracter en sans bold
  const est = (s, sz) => s.length * sz * 0.55
  let size = baseSize
  while (size > minSize && est(text, size) > maxWidthPx) size -= 2
  return size
}

// Genera el SVG completo del poster y lo rasteriza a PNG
async function composePoster(event, teamsInfo) {
  const W = 500
  const H = 280
  const [a, b] = teamsInfo || []
  const hasBadges = !!(a && a.badge && b && b.badge)
  const live = isLiveNow(event.startUtc, Date.now(), event.sport)
  const font = getFontFace()

  const parts = []
  parts.push(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`)
  if (font) parts.push(`<defs>${font}</defs>`)

  // fondo con degradado
  parts.push(
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d1340"/><stop offset="1" stop-color="#0c0a1e"/></linearGradient></defs>`
  )
  parts.push(`<rect width="${W}" height="${H}" fill="url(#g)"/>`)

  if (hasBadges) {
    // escudos de ambos equipos
    const bSize = 90
    const [aUri, bUri] = await Promise.all([loadImageAsDataUri(a.badge), loadImageAsDataUri(b.badge)])
    if (aUri) parts.push(`<image x="${Math.round(W / 2 - bSize - 40)}" y="60" width="${bSize}" height="${bSize}" href="${aUri}"/>`)
    if (bUri) parts.push(`<image x="${Math.round(W / 2 + 40)}" y="60" width="${bSize}" height="${bSize}" href="${bUri}"/>`)
    if (aUri && bUri) {
      parts.push(`<text x="${W / 2}" y="${Math.round(H / 2)}" font-size="30" text-anchor="middle" dominant-baseline="middle" fill="#ffd700" font-family="PosterFont,sans-serif" font-weight="bold">VS</text>`)
    }
  } else {
    // sin escudos: nombre del deporte en grande como protagonista
    const fallbackText = (event.sport || 'DEPORTE').toUpperCase()
    const size = fitTextSize(fallbackText, W - 80, 64, 28)
    parts.push(`<text x="${W / 2}" y="${H * 0.5}" font-size="${size}" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-family="PosterFont,sans-serif" font-weight="bold">${esc(fallbackText)}</text>`)
  }

  // bandera del pais (esquina superior izquierda)
  if (event.flagUrl) {
    const flagUri = await loadImageAsDataUri(event.flagUrl)
    if (flagUri) parts.push(`<image x="18" y="16" width="46" height="30" href="${flagUri}"/>`)
  }

  // etiquetas: deporte (arriba) y nombres de equipos (abajo)
  if (event.sport) {
    const sportTxt = esc(event.sport.toUpperCase())
    parts.push(`<text x="${W / 2}" y="30" font-size="22" text-anchor="middle" fill="#ffd700" font-family="PosterFont,sans-serif" font-weight="bold">${sportTxt}</text>`)
  }
  if (hasBadges) {
    const nameSize = fitTextSize(a.name || '', W / 2 - 70, 24)
    const nameSizeB = fitTextSize(b.name || '', W / 2 - 70, 24)
    if (a && a.name) parts.push(`<text x="${W / 2}" y="232" font-size="${nameSize}" text-anchor="middle" fill="#ffffff" font-family="PosterFont,sans-serif" font-weight="bold">${esc(a.name)}</text>`)
    if (b && b.name) parts.push(`<text x="${W / 2}" y="262" font-size="${nameSizeB}" text-anchor="middle" fill="#ffffff" font-family="PosterFont,sans-serif" font-weight="bold">${esc(b.name)}</text>`)
  }

  // badge "EN VIVO" (rojo) en la esquina superior derecha cuando esta en vivo
  if (live) {
    const bw = 104
    const bh = 34
    const bx = W - bw - 12
    const by = 12
    parts.push(
      `<g>` +
      `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="17" fill="#e02424"/>` +
      `<circle cx="${bx + 22}" cy="${by + 17}" r="6" fill="#ffffff"/>` +
      `<text x="${bx + 74}" y="${by + 17}" font-size="17" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-family="PosterFont,sans-serif" font-weight="bold">EN VIVO</text>` +
      `</g>`
    )
  }

  parts.push(`</svg>`)
  const svg = parts.join('')

  try {
    return await sharp(Buffer.from(svg)).png().toBuffer()
  } catch (_) {
    return null
  }
}

// Genera el PNG de portada para un evento (con caché)
async function eventPoster(event) {
  const key = event.title + '|' + event.sport + '|' + (event.flagUrl || '') + '|' + (event.startUtc || '') + '|' + (event.country || '')
  const cached = posterCache.get(key)
  if (cached && Date.now() - cached.time < POSTER_TTL_MS) return cached.buf

  // El pais de agenda18 es el fiable; en fuentes sin country, el "sport"
  // suele ser el pais/liga (ej. "Chile", "Peru") y sirve para filtrar.
  const country = event.country || (countryToEn(event.sport) ? event.sport : null)

  const teams = parseTeams(event.title)
  const clean = teams.map(cleanTeamName)
  const settled = await Promise.allSettled(clean.map((t) => searchTeam(t, country)))

  const info = teams.map((orig, i) => {
    const r = settled[i] && settled[i].status === 'fulfilled' ? settled[i].value : null
    return { name: orig, badge: r ? r.badge : null }
  })

  let buf = await composePoster(event, info)
  if (!buf) {
    // fallback: PNG solido con color
    buf = await sharp({ create: { width: 500, height: 280, channels: 4, background: '#140f2a' } }).png().toBuffer()
  }

  posterCache.set(key, { time: Date.now(), buf })
  return buf
}

module.exports = {
  parseTeams,
  cleanTeamName,
  searchTeam,
  composePoster,
  eventPoster
}