'use strict'

// Fuente: https://deporflix.pe/
// Sitio WordPress con tema Dooplay. Los partidos puntuales ("Equipo A vs Equipo B")
// viven como canales (CPT "movies") con un player AJAX propio:
//   1) Se listan via la REST API de WP: /wp-json/wp/v2/search?search=vs
//      (solo entradas cuyo slug apunta a /canales/ son partidos).
//   2) Por cada partido se hace POST a admin-ajax.php con action=doo_player_ajax
//      (post=id, nume=1, type=movie) que responde { embed_url }.
//   3) El embed_url es una pagina tipo canal.php (la18hd/fubo18) que el proxy
//      del addon ya sabe re-extraer y reescribir (token/IP consistente).

const { fetchText, classify } = require('./common')

const BASE_URL = 'https://deporflix.pe'
const SEARCH_URL = BASE_URL + '/wp-json/wp/v2/search?search=vs&per_page=20&_embed=1'
const AJAX_URL = BASE_URL + '/wp-admin/admin-ajax.php'
const REFERER = BASE_URL + '/'

// Palabras clave de competicion -> clave de SPORT_CLASS_MAP para el emoji/bandera
const COMP_TO_CLASS = [
  [/libertadores/i, 'LIB'],
  [/sudamericana/i, 'SUD'],
  [/champions|uefa/i, 'CHA'],
  [/premier/i, 'EN'],
  [/liga\s*1\s*max|liga\s*1/i, 'PE'],
  [/mls/i, 'USA'],
  [/serie\s*a/i, 'IT'],
  [/bundesliga/i, 'ALE'],
  [/ligue|leagues/i, 'FRA'],
  [/la\s*liga/i, 'ES']
]

// Clasifica un titulo de partido deporflix por competicion; por defecto futbol
function classifyTitle(title) {
  for (const [re, cls] of COMP_TO_CLASS) {
    if (re.test(title)) return classify(cls)
  }
  return classify('FUT')
}

// POST a admin-ajax (fetchText es GET, asi que fetch directo)
async function postAjax(postId, referer) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(AJAX_URL, {
      method: 'POST',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': referer
      },
      body: 'action=doo_player_ajax&post=' + encodeURIComponent(postId) + '&nume=1&type=movie',
      redirect: 'follow',
      signal: controller.signal
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const json = JSON.parse(await res.text())
    return json && json.embed_url ? json.embed_url : null
  } finally {
    clearTimeout(timer)
  }
}

// Lista los partidos puntuales ("X vs Y") de deporflix
async function getDeporflixEvents() {
  const html = await fetchText(SEARCH_URL, { Referer: REFERER }, 10000)
  let results
  try {
    results = JSON.parse(html)
  } catch (_) {
    return []
  }
  if (!Array.isArray(results)) return []

  const matches = results.filter(
    (r) =>
      r &&
      r.id &&
      r.title &&
      / vs /i.test(r.title) &&
      typeof r.url === 'string' &&
      /\/canales\//.test(r.url)
  )

  const events = await Promise.all(
    matches.map(async (r) => {
      const referer = r.url
      const embedUrl = await postAjax(r.id, referer).catch(() => null)
      if (!embedUrl) return null
      const sport = classifyTitle(r.title)
      return {
        title: r.title.replace(/\s+/g, ' ').trim(),
        time: '',
        sport: sport.name,
        emoji: sport.emoji,
        country: sport.country || null,
        streams: [
          {
            source: 'DF',
            label: 'Deporflix',
            url: embedUrl
          }
        ]
      }
    })
  )

  return events.filter(Boolean)
}

module.exports = {
  BASE_URL,
  getDeporflixEvents,
  classifyTitle
}