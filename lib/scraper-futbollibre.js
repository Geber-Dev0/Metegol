'use strict'

// Fuente: https://futbollibretv.sx/
// La agenda vive en /eventos.js como `const EVENTOS_DATA = [ {id, clase, titulo, hora, canales:[{nombre,url,calidad}]}, ... ]`
// Los enlaces son "/eventos.html?r=<base64>" igual que alangulotv.si.

const { fetchText, decodeHrefR, classify } = require('./common')

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
