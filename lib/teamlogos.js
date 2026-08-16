'use strict'

// Portadas de eventos: genera un PNG real (sharp) combinando escudos de los dos
// equipos (TheSportsDB), bandera del pais (agenda18) y emoji de deporte.
// Se sirve desde una ruta propia del addon (/poster/:id) porque Stremio en
// Android no renderiza SVG data URI como posters.
// TheSportsDB: https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=<team>

const sharp = require('sharp')
const { fetchText, fetchJson } = require('./common')

const TSDB_SEARCH = 'https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t='

// Caché en memoria: nombre de equipo -> { badge, name } | null
const teamCache = new Map()
const TEAM_TTL_MS = 6 * 60 * 60 * 1000

// Caché de PNG ya generados: id -> buffer
const posterCache = new Map()
const POSTER_TTL_MS = 30 * 60 * 1000

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

async function searchTeam(team) {
  const cacheKey = team.toLowerCase()
  const cached = teamCache.get(cacheKey)
  if (cached && Date.now() - cached.time < TEAM_TTL_MS) return cached.result

  let result = null
  try {
    const json = await fetchJson(TSDB_SEARCH + encodeURIComponent(team), {}, 10000)
    const teams = json && json.teams
    if (Array.isArray(teams) && teams.length && teams[0].strBadge) {
      result = { badge: teams[0].strBadge, name: teams[0].strTeam }
    }
  } catch (_) {
    result = null
  }
  teamCache.set(cacheKey, { time: Date.now(), result })
  return result
}

// Descarga una imagen y la devuelve como { buffer, w, h } o null si falla
async function loadImage(url, timeoutMs = 8000) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const buffer = Buffer.from(await res.arrayBuffer())
      const meta = await sharp(buffer).metadata()
      return { buffer, w: meta.width || 0, h: meta.height || 0 }
    } finally {
      clearTimeout(timer)
    }
  } catch (_) {
    return null
  }
}

// Ajusta una imagen dentro de un cuadrado de maxSize manteniendo proporcion
function fitSize(w, h, maxSize) {
  if (!w || !h) return { w: maxSize, h: maxSize }
  const scale = Math.min(maxSize / w, maxSize / h)
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}

// Escudo -> buffer PNG transparente ya redimensionado (cuadrado)
async function badgeToPng(badgeUrl, size = 84) {
  const img = await loadImage(badgeUrl)
  if (!img) return null
  const fit = fitSize(img.w, img.h, size)
  try {
    const buffer = await sharp(img.buffer)
      .resize(fit.w, fit.h, { fit: 'inside' })
      .png()
      .toBuffer()
    return buffer
  } catch (_) {
    return null
  }
}

// Compone el PNG de portada: fondo, escudos, bandera y etiquetas
async function composePoster(event, teamsInfo) {
  const W = 500
  const H = 280
  const [a, b] = teamsInfo || []
  const hasBadges = !!(a && a.badge && b && b.badge)

  // Texto grande del deporte como protagonista cuando no hay escudos.
  // No se usa el emoji porque Vercel (Linux) no tiene fuentes de emoji y
  // librsvg lo dibujaria como caja vacia.
  const fallbackText = event.sport || 'DEPORTE'

  let composite = [
    // fondo oscuro con degradado
    {
      input: Buffer.from(
        `<svg width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d1340"/><stop offset="1" stop-color="#0c0a1e"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`
      )
    }
  ]

  if (hasBadges) {
    // escudos de ambos equipos
    const aPng = await badgeToPng(a.badge)
    const bPng = await badgeToPng(b.badge)
    const bSize = 90
    if (aPng) composite.push({ input: aPng, left: Math.round(W / 2 - bSize - 40), top: 60 })
    if (bPng) composite.push({ input: bPng, left: Math.round(W / 2 + 40), top: 60 })
    if (aPng && bPng) {
      // separador "VS"
      composite.push({
        input: Buffer.from(
          `<svg width="80" height="40"><text x="40" y="30" font-size="30" text-anchor="middle" fill="#ffd700" font-family="Arial" font-weight="bold">VS</text></svg>`
        ),
        left: Math.round(W / 2 - 40),
        top: Math.round(H / 2 - 20)
      })
    }
  } else {
    // sin escudos: nombre del deporte en grande como protagonista
    composite.push({
      input: Buffer.from(
        `<svg width="${W}" height="${H}"><text x="${W / 2}" y="${H * 0.5}" font-size="64" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" font-family="Arial" font-weight="bold">${esc(fallbackText)}</text></svg>`
      ),
      top: 0,
      left: 0
    })
  }

  // bandera del pais (esquina superior izquierda)
  if (event.flagUrl) {
    const flag = await loadImage(event.flagUrl)
    if (flag) {
      const fit = fitSize(flag.w, flag.h, 46)
      try {
        const flagPng = await sharp(flag.buffer).resize(fit.w, fit.h).png().toBuffer()
        composite.push({ input: flagPng, left: 18, top: 16 })
      } catch (_) {}
    }
  }

  // etiquetas: deporte (arriba) y nombres de equipos (abajo)
  const labels = []
  if (event.sport) labels.push({ text: (event.sport || '').toUpperCase(), y: 30, size: 22, color: '#ffd700' })
  if (hasBadges) {
    if (a && a.name) labels.push({ text: a.name, y: 228, size: 24, color: '#ffffff' })
    if (b && b.name) labels.push({ text: b.name, y: 256, size: 24, color: '#ffffff' })
  }
  const labelSvg = labels
    .map((l) => `<text x="${W / 2}" y="${l.y}" font-size="${l.size}" text-anchor="middle" fill="${l.color}" font-family="Arial" font-weight="bold">${esc(l.text)}</text>`)
    .join('')
  if (labelSvg) {
    composite.push({
      input: Buffer.from(`<svg width="${W}" height="${H}">${labelSvg}</svg>`),
      top: 0,
      left: 0
    })
  }

  try {
    const png = await sharp({
      create: { width: W, height: H, channels: 4, background: '#0c0a1e' }
    })
      .composite(composite)
      .png()
      .toBuffer()
    return png
  } catch (_) {
    return null
  }
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Genera el PNG de portada para un evento (con caché)
async function eventPoster(event) {
  const key = event.title + '|' + event.sport + '|' + (event.flagUrl || '')
  const cached = posterCache.get(key)
  if (cached && Date.now() - cached.time < POSTER_TTL_MS) return cached.buf

  const teams = parseTeams(event.title)
  const clean = teams.map(cleanTeamName)
  const settled = await Promise.allSettled(clean.map((t) => searchTeam(t)))

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
  badgeToPng,
  composePoster,
  eventPoster
}