'use strict'

// Fuente: https://futbollibretv.sx/
// La agenda vive en /eventos.js como `const EVENTOS_DATA = [ {id, clase, titulo, hora, canales:[{nombre,url,calidad}]}, ... ]`
// Los enlaces son "/eventos.html?r=<base64>" igual que alangulotv.si.
// La `hora` que publica el sitio es UTC+1 fijo (verificado vs horarios reales:
// Fenerbahce-Lyon 20:00 = 19:00 UTC; Riestra-Gimnasia 21:00 = 20:00 UTC), por
// eso se convierte con Etc/GMT-1. La API-Football la reemplaza cuando matchea.

const { fetchText, decodeHrefR, classify, wallTimeToUtc } = require('./common')

const BASE_URL = 'https://futbollibretv.sx'
const AGENDA_URL = BASE_URL + '/eventos.js'
const REFERER = BASE_URL + '/'

// Extrae el array EVENTOS_DATA (JSON valido embebido en el archivo JS)
function parseEventosJs(js) {
  const m = js.match(/EVENTOS_DATA\s*=\s*(\[[\s\S]*\])\s*;?\s*$/)
  if (!m) return []
  let data
  try {
    data = JSON.parse(m[1])
  } catch (e) {
    return []
  }
  if (!Array.isArray(data)) return []

  const seen = new Set()
  return data
    .filter((e) => e && e.titulo && Array.isArray(e.canales))
    .map((e) => {
      const sport = classify(e.clase || '')
      const streams = e.canales
        .map((c) => {
          const url = decodeHrefR(c.url)
          if (!url) return null
          return {
            source: 'FL',
            label: c.nombre + (c.calidad ? ' · ' + c.calidad : ''),
            url
          }
        })
        .filter(Boolean)
      return {
        title: e.titulo,
        time: e.hora || '',
        startUtc: wallTimeToUtc(e.hora || '', 'Etc/GMT-1'),
        sport: sport.name,
        emoji: sport.emoji,
        streams
      }
    })
    .filter((e) => {
      const key = e.title.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

async function getFutbolLibreEvents() {
  const js = await fetchText(AGENDA_URL, { Referer: REFERER })
  return parseEventosJs(js)
}

module.exports = {
  BASE_URL,
  AGENDA_URL,
  parseEventosJs,
  getFutbolLibreEvents
}
