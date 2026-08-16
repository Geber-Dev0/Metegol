'use strict'

// Portadas de eventos: intenta conseguir los escudos reales de los dos equipos
// (TheSportsDB, free) y compone un SVG. Si falla, cae a un poster con emoji.
// TheSportsDB: https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=<team>

const { fetchText, fetchJson, classify } = require('./common')

const TSDB_SEARCH = 'https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t='

// Caché en memoria: nombre de equipo -> { badge, name } | null
const teamCache = new Map()
const TEAM_TTL_MS = 6 * 60 * 60 * 1000

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

// Genera el SVG de portada con escudos y nombre de liga
function buildTeamPoster(teams, league, fallbackEmoji) {
  const leagueName = (league || '').toUpperCase() || 'EN VIVO'
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  if (!teams || teams.length < 2) {
    // sin equipos identificados: poster con emoji grande
    return emojiPoster(fallbackEmoji || '📺', leagueName)
  }

  const [a, b] = teams
  const cells = `
    <text x="125" y="30" font-size="14" text-anchor="middle" fill="#ffd700" font-family="Arial" font-weight="bold">${esc(leagueName)}</text>
    <image x="20" y="48" width="90" height="90" href="${a.badge}"/>
    <image x="140" y="48" width="90" height="90" href="${b.badge}"/>
    <text x="125" y="158" font-size="13" text-anchor="middle" fill="#ffffff" font-family="Arial">${esc(a.name)}</text>
    <text x="125" y="174" font-size="13" text-anchor="middle" fill="#ffffff" font-family="Arial">${esc(b.name)}</text>
    <text x="125" y="200" font-size="11" text-anchor="middle" fill="#ffd700" font-family="Arial" font-weight="bold">VS</text>`

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="140">
  <rect width="250" height="140" rx="8" fill="#140f2a"/>
  ${cells}
</svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

function emojiPoster(emoji, label) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const color = '#140f2a'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="140">
  <rect width="250" height="140" rx="8" fill="${color}"/>
  ${label ? `<text x="125" y="22" font-size="12" text-anchor="middle" fill="#ffd700" font-family="Arial" font-weight="bold">${esc(label)}</text>` : ''}
  <text x="125" y="90" font-size="60" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
</svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

// API principal: dado un evento, devuelve la URL de portada
async function eventPoster(event) {
  const teams = parseTeams(event.title)
  const clean = teams.map(cleanTeamName)
  const settled = await Promise.allSettled(clean.map((t) => searchTeam(t)))

  const found = []
  teams.forEach((orig, i) => {
    const r = settled[i] && settled[i].status === 'fulfilled' ? settled[i].value : null
    found.push({ badge: r ? r.badge : null, name: orig })
  })

  const withBadge = found.filter((f) => f.badge)
  if (withBadge.length >= 1) {
    // al menos un escudo: usamos el poster de equipos (los faltantes se muestran por nombre)
    return buildTeamPoster(found, event.sport, event.emoji)
  }
  return emojiPoster(event.emoji, event.sport)
}

module.exports = {
  parseTeams,
  searchTeam,
  buildTeamPoster,
  emojiPoster,
  eventPoster,
  classify
}
