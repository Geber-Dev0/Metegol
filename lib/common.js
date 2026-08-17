'use strict'

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8'
}

async function fetchText(url, headers = {}, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { ...DEFAULT_HEADERS, ...headers },
      redirect: 'follow',
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} para ${url}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url, headers = {}, timeoutMs = 8000) {
  const text = await fetchText(url, headers, timeoutMs)
  return JSON.parse(text)
}

// Decodifica el parametro "r" (base64) a la URL del endpoint de terceros
function decodeStreamUrl(r) {
  try {
    const padding = r.length % 4 === 0 ? '' : '='.repeat(4 - (r.length % 4))
    return Buffer.from(r + padding, 'base64').toString('utf8')
  } catch (_) {
    return null
  }
}

// Extrae el parametro "r" (base64) de un href tipo "/eventos.html?r=XXXX"
function decodeHrefR(href) {
  if (!href) return null
  const m = href.match(/[?&]r=([A-Za-z0-9+/=]+)/)
  if (!m) return null
  return decodeStreamUrl(m[1])
}

// Convierte un titulo a un id estable (sin tokens ni fechas)
function titleToId(title) {
  return Buffer.from('metegol:' + title).toString('base64url')
}

// Convierte un id de vuelta al titulo original
function idToTitle(id) {
  try {
    const s = Buffer.from(id, 'base64url').toString('utf8')
    return s.startsWith('metegol:') ? s.slice('metegol:'.length) : null
  } catch (_) {
    return null
  }
}

// Normaliza un titulo para comparar/deduplicar entre fuentes
function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/[:\u2013\u2014_-]/g, ' ') // guiones y dos puntos -> espacio
    .replace(/\s+/g, ' ')
    .trim()
}

// ===== Zonas horarias =====
// Opciones de config que ve el usuario en Stremio (clave -> valor IANA)
const TZ_OPTIONS = [
  { label: 'Argentina (UTC-3)', value: 'America/Argentina/Buenos_Aires' },
  { label: 'Perú (UTC-5)', value: 'America/Lima' },
  { label: 'Chile (UTC-4)', value: 'America/Santiago' },
  { label: 'Colombia (UTC-5)', value: 'America/Bogota' },
  { label: 'México (UTC-6)', value: 'America/Mexico_City' },
  { label: 'Venezuela (UTC-4)', value: 'America/Caracas' },
  { label: 'Bolivia (UTC-4)', value: 'America/La_Paz' },
  { label: 'Paraguay (UTC-4)', value: 'America/Asuncion' },
  { label: 'Uruguay (UTC-3)', value: 'America/Montevideo' },
  { label: 'Ecuador (UTC-5)', value: 'America/Guayaquil' },
  { label: 'España (UTC+1)', value: 'Europe/Madrid' },
  { label: 'Estados Unidos Este (UTC-5)', value: 'America/New_York' },
  { label: 'Estados Unidos Oeste (UTC-8)', value: 'America/Los_Angeles' }
]

const DEFAULT_TZ = 'America/Argentina/Buenos_Aires'

function tzLabelToValue(label) {
  const opt = TZ_OPTIONS.find((o) => o.label === label)
  return opt ? opt.value : DEFAULT_TZ
}

// Formatea un instante UTC (ms) como "HH:MM" en la zona indicada
function formatTimeInTz(utcMs, tz) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(utcMs))
  } catch (_) {
    return new Date(utcMs).toISOString().slice(11, 16)
  }
}

// Offset (en ms) que usa la zona tz para un instante UTC dado
function tzOffsetMs(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(utcMs))
  const get = (t) => Number(parts.find((p) => p.type === t).value)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return wall - utcMs
}

// Convierte una hora de muro (hora local HH:MM del dia actual, en zona tz) a UTC
function wallTimeToUtc(hhmm, tz, nowMs = Date.now()) {
  const [hh, mm] = hhmm.split(':').map(Number)
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(nowMs))
  const get = (t) => Number(parts.find((p) => p.type === t).value)
  const guess = Date.UTC(get('year'), get('month') - 1, get('day'), hh, mm)
  return guess - tzOffsetMs(guess, tz)
}

// Duracion tipica por deporte (para saber si sigue "en vivo")
function sportDurationMs(sport) {
  const s = (sport || '').toLowerCase()
  if (/ufc|boxeo|boxeo|wwe|mma/.test(s)) return 3 * 60 * 60 * 1000
  if (/tenis|basqu|basket|nba|f1|automovil/.test(s)) return 2.5 * 60 * 60 * 1000
  return 2 * 60 * 60 * 1000 // futbol y resto
}

// Dice si un partido esta en vivo: inicio - margen <= ahora <= inicio + duracion
function isLiveNow(startUtc, nowMs = Date.now(), sport) {
  if (!startUtc) return false
  const marginMs = 15 * 60 * 1000 // 15 min de tolerancia (los partidos se atrasan)
  const durMs = sportDurationMs(sport)
  return nowMs >= startUtc - marginMs && nowMs <= startUtc + durMs
}

// Extrae el nombre de liga/continente de la clase del <li> (ES, AR, IT, UFC...)
const SPORT_CLASS_MAP = {
  AR: { name: 'Argentina', emoji: '🇦🇷', country: 'Argentina' },
  ES: { name: 'España', emoji: '🇪🇸', country: 'Spain' },
  IT: { name: 'Italia', emoji: '🇮🇹', country: 'Italy' },
  EN: { name: 'Inglaterra', emoji: '🏴', country: 'England' },
  ENG: { name: 'Inglaterra', emoji: '🏴', country: 'England' },
  ALE: { name: 'Alemania', emoji: '🇩🇪', country: 'Germany' },
  FRA: { name: 'Francia', emoji: '🇫🇷', country: 'France' },
  HOL: { name: 'Holanda', emoji: '🇳🇱', country: 'Netherlands' },
  POR: { name: 'Portugal', emoji: '🇵🇹', country: 'Portugal' },
  MEX: { name: 'México', emoji: '🇲🇽', country: 'Mexico' },
  BEL: { name: 'Bélgica', emoji: '🇧🇪', country: 'Belgium' },
  USA: { name: 'Estados Unidos', emoji: '🇺🇸', country: 'USA' },
  BRA: { name: 'Brasil', emoji: '🇧🇷', country: 'Brazil' },
  URU: { name: 'Uruguay', emoji: '🇺🇾', country: 'Uruguay' },
  COL: { name: 'Colombia', emoji: '🇨🇴', country: 'Colombia' },
  CHI: { name: 'Chile', emoji: '🇨🇱', country: 'Chile' },
  CH: { name: 'Chile', emoji: '🇨🇱', country: 'Chile' },
  ECUA: { name: 'Ecuador', emoji: '🇪🇨', country: 'Ecuador' },
  PE: { name: 'Perú', emoji: '🇵🇪', country: 'Peru' },
  PY: { name: 'Paraguay', emoji: '🇵🇾', country: 'Paraguay' },
  ARA: { name: 'Arabia', emoji: '🇸🇦', country: 'Saudi Arabia' },
  TUR: { name: 'Turquía', emoji: '🇹🇷', country: 'Turkey' },
  CHA: { name: 'Champions League', emoji: '🏆', country: null },
  LIB: { name: 'Copa Libertadores', emoji: '🏆', country: null },
  SUD: { name: 'Sudamericana', emoji: '🏆', country: null },
  UFC: { name: 'UFC', emoji: '🥊', country: null },
  TENIS: { name: 'Tenis', emoji: '🎾', country: null },
  F1: { name: 'F1', emoji: '🏎️', country: null },
  NBA: { name: 'NBA', emoji: '🏀', country: null },
  NFL: { name: 'NFL', emoji: '🏈', country: null },
  BOX: { name: 'Boxeo', emoji: '🥊', country: null },
  WWE: { name: 'WWE', emoji: '🤼', country: null },
  FUT: { name: 'Fútbol', emoji: '⚽', country: null }
}

function classify(classList) {
  const cls = (classList || '').trim().toUpperCase()
  const key = cls.split(/\s+/)[0]
  return SPORT_CLASS_MAP[key] || { name: cls || 'Deporte', emoji: '📺', country: null }
}

module.exports = {
  DEFAULT_HEADERS,
  fetchText,
  fetchJson,
  decodeStreamUrl,
  decodeHrefR,
  titleToId,
  idToTitle,
  normalizeTitle,
  classify,
  SPORT_CLASS_MAP,
  TZ_OPTIONS,
  DEFAULT_TZ,
  tzLabelToValue,
  formatTimeInTz,
  tzOffsetMs,
  wallTimeToUtc,
  sportDurationMs,
  isLiveNow
}
