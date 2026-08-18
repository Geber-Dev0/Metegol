'use strict'

// Fuente de horarios autoritativa: API-Football (api-football.com).
// 1 llamada por dia (`fixtures?date=YYYY-MM-DD`) devuelve todos los partidos del
// mundo con fecha UTC exacta (fixture.date). Se cachea por fecha (TTL 1h) y el
// endpoint /schedule de addon.js agrega s-maxage para que el CDN absorba a los
// usuarios: en origen queda ~1 llamada por hora, muy lejos del limite gratis
// (100 requests/dia).

const fs = require('fs')
const path = require('path')
const { fetchJson } = require('./common')

const API_BASE = 'https://v3.football.api-sports.io'
const FIXTURES_ENDPOINT = API_BASE + '/fixtures'

const FIXTURES_TTL_MS = 60 * 60 * 1000
const fixturesCache = new Map() // date -> { time, fixtures }

// Key desde el entorno, o desde .env para desarrollo local (sin dotenv)
function getApiKey() {
  if (process.env.FOOTBALL_API_KEY) return process.env.FOOTBALL_API_KEY
  try {
    const envPath = path.join(__dirname, '..', '.env')
    const txt = fs.readFileSync(envPath, 'utf8')
    const m = txt.match(/^FOOTBALL_API_KEY\s*=\s*(.+)$/m)
    if (m) return m[1].trim()
  } catch (_) {}
  return null
}

function pad(n) {
  return String(n).padStart(2, '0')
}

// Fecha de "hoy" en la zona del servidor (Vercel corre en UTC). Los scrapers
// ya trabajan sobre el dia del backend; para el matcheo alcanza la misma fecha.
function todayStr() {
  const d = new Date()
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

async function fetchDailyFixtures(date) {
  const d = date || todayStr()
  const cached = fixturesCache.get(d)
  if (cached && Date.now() - cached.time < FIXTURES_TTL_MS) return cached.fixtures
  let fixtures = null
  const key = getApiKey()
  if (key) {
    try {
      const headers = {}
      headers['x-apisports-key'] = key
      const json = await fetchJson(FIXTURES_ENDPOINT + '?date=' + d, headers, 20000)
      if (json && Array.isArray(json.response)) fixtures = json.response
    } catch (_) {
      fixtures = null
    }
  }
  fixturesCache.set(d, { time: Date.now(), fixtures })
  return fixtures
}

// Clave normalizada (minusculas, sin tildes, solo alfanumerico)
function teamKey(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

// Extrae las claves de los dos equipos del titulo del evento (misma logica que
// parseTeams de teamlogos.js, sin depender de sharp/opentype).
function eventTeamKeys(title) {
  let rest = String(title || '')
  const ci = rest.indexOf(':')
  if (ci !== -1 && ci < rest.length - 1) rest = rest.slice(ci + 1)
  rest = rest.split('|')[0]
  const parts = rest
    .split(/\s+v(?:s|s\.)?\.?\s+|@|–|—|-/i)
    .map((s) => s.trim())
    .filter(Boolean)
  const teams = parts
    .slice(0, 2)
    .map((t) => t.replace(/\(.*?\)/g, '').trim())
    .filter(Boolean)
  return teams.map(teamKey).filter((k) => k.length >= 3)
}

function includesOrContains(a, b) {
  return a.includes(b) || b.includes(a)
}

// Devuelve el fixture de la API que matchea el evento (par de equipos) o null.
function matchFixture(event, fixtures) {
  if (!Array.isArray(fixtures) || !fixtures.length) return null
  const keys = eventTeamKeys(event.title)
  if (!keys.length) return null
  let best = null
  for (const f of fixtures) {
    const t = f && f.teams
    if (!t) continue
    const home = teamKey(t.home && t.home.name)
    const away = teamKey(t.away && t.away.name)
    if (!home || !away) continue
    let ok
    if (keys.length >= 2) {
      ok =
        (includesOrContains(home, keys[0]) && includesOrContains(away, keys[1])) ||
        (includesOrContains(home, keys[1]) && includesOrContains(away, keys[0]))
    } else {
      ok = includesOrContains(home, keys[0]) || includesOrContains(away, keys[0])
    }
    if (ok) {
      if (!best) best = f
      // si hay varios, preferir el que coincide en liga con el deporte del evento
      if (best && f.league && event.sport) {
        const lk = teamKey(f.league.name)
        const sk = teamKey(event.sport)
        if (lk === sk) return f
      }
    }
  }
  return best
}

// startUtc (ms) del fixture que matchea el evento, o null
function resolveStartUtc(event, fixtures) {
  const f = matchFixture(event, fixtures)
  if (f && f.fixture && f.fixture.date) {
    const utc = Date.parse(f.fixture.date)
    if (!Number.isNaN(utc)) return utc
  }
  return null
}

module.exports = {
  getApiKey,
  todayStr,
  fetchDailyFixtures,
  teamKey,
  eventTeamKeys,
  matchFixture,
  resolveStartUtc
}