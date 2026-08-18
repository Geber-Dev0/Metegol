'use strict'

// Agregador de agendas: alangulotv.si + futbollibretv.sx + agenda18.com (.mx / rojadirectaa)
const { fetchText, decodeStreamUrl, decodeHrefR, classify, normalizeTitle } = require('./common')
const { getFutbolLibreEvents } = require('./scraper-futbollibre')
const { getAgenda18Events } = require('./scraper-agenda18')

const BASE_URL = 'https://alangulotv.si'
const AGENDA_URL = BASE_URL + '/agenda.php'

// Parsea el HTML de agenda.php y devuelve la lista de eventos
function parseAgenda(html) {
  const events = []

  // Coincide contra cada <li class="XX">...</li> de evento (los de primer nivel que no son subitems)
  const liRe = /<li class="([A-Z0-9\s]+)"><a href="#">([\s\S]*?)<\/a>\s*<ul>([\s\S]*?)<\/ul>\s*<\/li>/g
  let m
  while ((m = liRe.exec(html)) !== null) {
    const classList = m[1]
    const body = m[2]
    const streamsHtml = m[3]

    const timeMatch = body.match(/<span class="t">([^<]*)<\/span>/)
    // El titulo es el texto del <a> sin el <span> de hora
    const titleRaw = body.split('<span class="t">')[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const title = titleRaw.replace(/:\s*$/, '').trim()
    const time = timeMatch ? timeMatch[1].trim() : ''

    // Parsear los streams (subitems)
    const streams = []
    const streamRe = /<li class="([^"]+)"><a href="[^"]*?r=([A-Za-z0-9+/=]+)"[^>]*>([\s\S]*?)<\/a><\/li>/g
    let sm
    while ((sm = streamRe.exec(streamsHtml)) !== null) {
      const label = sm[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      const streamUrl = decodeStreamUrl(sm[2])
      if (!streamUrl) continue
      streams.push({
        source: sm[1].includes('subitem2') ? 'OP2' : 'OP1',
        label,
        url: streamUrl
      })
    }

    const sport = classify(classList)
    events.push({
      title: title || body.slice(0, 40),
      time,
      sport: sport.name,
      emoji: sport.emoji,
      streams
    })
  }

  // Eliminar duplicados por titulo
  const seen = new Set()
  return events.filter((e) => {
    if (seen.has(e.title)) return false
    seen.add(e.title)
    return true
  })
}

// Limpia titulos con prefijos repetidos ("UFC: UFC: A vs B" -> "UFC: A vs B")
function cleanTitle(title) {
  return String(title).replace(/^([^:]+):\s*\1:\s*/i, '$1: ').trim()
}

// Fusiona eventos de varias fuentes deduplicando por titulo normalizado.
// Para el mismo partido conserva el primero y agrega los enlaces de los demas.
// Si una fuente trae startUtc (fecha+hora exacta, agenda18) y la que ya esta
// registrada no, se reemplaza time/startUtc/flagUrl por los mas completos.
function mergeEvents(...lists) {
  const byKey = new Map()
  for (const list of lists) {
    for (const e of list || []) {
      const title = cleanTitle(e.title)
      const key = normalizeTitle(title)
      if (!key) continue
      const existing = byKey.get(key)
      if (existing) {
        existing.streams = mergeStreams(existing.streams, e.streams)
        // preferir la fuente con fecha exacta para el horario
        if (!existing.startUtc && e.startUtc) {
          existing.startUtc = e.startUtc
          existing.time = e.time
        }
        if (!existing.flagUrl && e.flagUrl) existing.flagUrl = e.flagUrl
        if (!existing.country && e.country) existing.country = e.country
      } else {
        byKey.set(key, {
          title,
          time: e.time,
          startUtc: e.startUtc || null,
          sport: e.sport,
          emoji: e.emoji,
          country: e.country || null,
          flagUrl: e.flagUrl || null,
          streams: [...(e.streams || [])]
        })
      }
    }
  }
  return [...byKey.values()]
}

// Une streams sin duplicar URLs repetidas (misma señal en varias fuentes)
function mergeStreams(a, b) {
  const out = [...(a || [])]
  const urls = new Set(out.map((s) => s.url))
  for (const s of b || []) {
    if (!urls.has(s.url)) {
      urls.add(s.url)
      out.push(s)
    }
  }
  return out
}

// Prioridad de proveedores: menor = mas estable (se lista primero).
// los dominios desconocidos van al final (99).
const PROVIDER_PRIORITY = {
  'la18hd.su': 1,
  'fubo18.com': 2,
  'tudeporteshoy.xyz': 3,
  'streamtp-golden1.click': 4,
  'streamx488.sbs': 5
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch (_) {
    return ''
  }
}

function streamScore(s) {
  const host = hostOf(s.url)
  const hostScore = PROVIDER_PRIORITY[host] !== undefined ? PROVIDER_PRIORITY[host] : 99
  const label = s.label || ''
  let labelScore = 0
  if (/720p|1080p|4k/i.test(label)) labelScore -= 2 // calidad alta primero
  if (/espa\W|spanish/i.test(label)) labelScore -= 1 // preferir espanol
  return [hostScore, labelScore]
}

// Ordena los streams de un evento: proveedor estable primero, luego por calidad/idioma
function sortStreams(streams) {
  return [...(streams || [])].sort((a, b) => {
    const [ah, al] = streamScore(a)
    const [bh, bl] = streamScore(b)
    if (ah !== bh) return ah - bh
    if (al !== bl) return al - bl
    return 0
  })
}

const AGENDA_TTL_MS = 30000
let agendaCache = null

async function getEvents() {
  const now = Date.now()
  if (agendaCache && now - agendaCache.time < AGENDA_TTL_MS) {
    return agendaCache.events
  }

  // Las 3 fuentes en paralelo; si una falla, no tumba al resto
  const [alangulotv, futbollibre, agenda18] = await Promise.allSettled([
    fetchText(AGENDA_URL).then(parseAgenda),
    getFutbolLibreEvents(),
    getAgenda18Events()
  ])

  const merged = mergeEvents(
    alangulotv.status === 'fulfilled' ? alangulotv.value : [],
    futbollibre.status === 'fulfilled' ? futbollibre.value : [],
    agenda18.status === 'fulfilled' ? agenda18.value : []
  )
  const events = (await augmentWithApi(merged)).map((e) => ({ ...e, streams: sortStreams(e.streams) }))

  agendaCache = { time: now, events }
  return events
}

// API-Football como fuente autoritativa de horarios: si un evento matchea un
// fixture (par de equipos), se sobrescribe startUtc con el timestamp UTC exacto
// que entrega la API. Si no hay key, falla o no matchea, se conserva lo anterior.
async function augmentWithApi(events) {
  if (!Array.isArray(events) || !events.length) return events
  try {
    const footballApi = require('./footballApi')
    const fixtures = await footballApi.fetchDailyFixtures()
    if (!fixtures) return events
    return events.map((e) => {
      const utc = footballApi.resolveStartUtc(e, fixtures)
      return utc != null ? { ...e, startUtc: utc } : e
    })
  } catch (_) {
    return events
  }
}

async function getEventByTitle(title) {
  const events = await getEvents()
  const norm = normalizeTitle(title)
  return events.find((e) => normalizeTitle(e.title) === norm) || null
}

module.exports = {
  BASE_URL,
  AGENDA_URL,
  fetchText,
  decodeStreamUrl,
  decodeHrefR,
  normalizeTitle,
  parseAgenda,
  mergeEvents,
  cleanTitle,
  sortStreams,
  PROVIDER_PRIORITY,
  getEvents,
  getEventByTitle,
  augmentWithApi,
  titleToId: require('./common').titleToId,
  idToTitle: require('./common').idToTitle
}
