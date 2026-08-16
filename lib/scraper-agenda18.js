'use strict'

// Fuente: https://agenda18.com/agenda.json  (backend compartido por futbollibre.mx y rojadirectaa.net)
// Estructura Strapi:
//   { data: [ { attributes: {
//       diary_hour, diary_description, date_diary, deportes,
//       embeds: { data: [ { attributes: { embed_name, idioma, embed_iframe } } ] },
//       country: { data: { attributes: { name, image: { data: { attributes: { url } } } } } }
//   } } ] }
// Los embed_iframe son "/embed/eventos.html?r=<base64>" que decodifican a la URL del endpoint 3º.

const { fetchText, fetchJson, decodeHrefR } = require('./common')

const BASE_URL = 'https://agenda18.com'
const AGENDA_URL = BASE_URL + '/agenda.json?v=1.1'
const IMG_BASE = 'https://img.agenda18.com'
const REFERER = 'https://agenda18.com/'

// Deportes permitidos (mismo filtro que usa la web en CATEGORIES_PERMITTED)
const CATEGORIES_PERMITTED = ['futbol', 'tennis', 'basketball', 'wwe', 'mma(ufc)', 'formula1', 'boxing']

// Convierte la hora (America/Lima, UTC-5) + fecha a instante UTC (ms).
// Peru no usa horario de verano: UTC-5 fijo todo el año.
function toStartUtc(dateStr, diaryHour) {
  if (!diaryHour) return null
  const [hh, mm, ss = 0] = diaryHour.split(':').map(Number)
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null
  const [y, m, d] = (dateStr || '').split('-').map(Number)
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return null
  // Lima es UTC-5 -> UTC = hora local + 5h
  return Date.UTC(y, m - 1, d, hh + 5, mm, ss)
}

// Convierte "Futbol"/"Boxeo" a emoji y nombre
function mapDeporte(deportes) {
  const key = (deportes || '').toLowerCase().replace(/\s+/g, ' ')
  const map = {
    futbol: { name: 'Fútbol', emoji: '⚽' },
    tennis: { name: 'Tenis', emoji: '🎾' },
    basketball: { name: 'Básquet', emoji: '🏀' },
    'mma(ufc)': { name: 'UFC', emoji: '🥊' },
    formula1: { name: 'F1', emoji: '🏎️' },
    boxing: { name: 'Boxeo', emoji: '🥊' },
    wwe: { name: 'WWE', emoji: '🤼' }
  }
  return map[key] || { name: deportes || 'Deporte', emoji: '📺' }
}

function countryFlagUrl(country) {
  const img = country && country.data && country.data.attributes && country.data.attributes.image
  if (img && img.data && img.data.attributes && img.data.attributes.url) {
    return IMG_BASE + img.data.attributes.url
  }
  return null
}

function parseAgendaJson(json) {
  const arr = (json && json.data) || []
  const seen = new Set()
  const events = []

  for (const item of arr) {
    const attr = (item && item.attributes) || {}
    const title = (attr.diary_description || '').trim()
    if (!title) continue

    const embeds = (attr.embeds && attr.embeds.data) || []
    const streams = []
    for (const emb of embeds) {
      const ea = (emb && emb.attributes) || {}
      const href = ea.embed_iframe
      const url = decodeHrefR(href)
      if (!url) continue
      // descartar DRM (.mpd), proveedores no reproducibles y embeds anidados complejos (tarjetarojita/proveseat)
      if (/\.mpd(\?|$)/.test(url) || /drm\.php/.test(url)) continue
      if (/tarjetarojita|proveseat|la10tv|la10\.com/.test(url)) continue
      streams.push({
        source: 'A18',
        label: (ea.embed_name || 'Ver') + (ea.idioma ? ' · ' + ea.idioma : ''),
        url
      })
    }
    if (!streams.length) continue

    const sport = mapDeporte(attr.deportes)
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    events.push({
      title,
      time: (attr.diary_hour || '').slice(0, 5),
      startUtc: toStartUtc(attr.date_diary, attr.diary_hour),
      sport: sport.name,
      emoji: sport.emoji,
      flagUrl: countryFlagUrl(attr.country),
      streams
    })
  }

  return events
}

async function getAgenda18Events() {
  const text = await fetchText(AGENDA_URL, { Referer: REFERER }, 12000)
  const json = JSON.parse(text)
  return parseAgendaJson(json)
}

module.exports = {
  BASE_URL,
  AGENDA_URL,
  toStartUtc,
  parseAgendaJson,
  getAgenda18Events
}
