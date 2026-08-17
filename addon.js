'use strict'

const express = require('express')
const path = require('path')
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk')
const getRouter = require('stremio-addon-sdk/src/getRouter')
const configurePage = require('./lib/landing')
const manifest = require('./manifest')
const { getEvents, getEventByTitle, titleToId, idToTitle, decodeStreamUrl } = require('./lib/scraper')
const { eventPoster } = require('./lib/teamlogos')
const { proxyHandler, publicBase, proxiedUrl } = require('./lib/proxy')
const { tzLabelToValue, formatTimeInTz, wallTimeToUtc, isLiveNow } = require('./lib/common')

const PREFIX = 'metegol:'

const builder = new addonBuilder(manifest)

// Resuelve la zona horaria elegida por el usuario (config del addon)
function resolveTz(config) {
  return tzLabelToValue((config && config.timezone) || undefined)
}

// Horario del partido en la zona del usuario: usa la fecha exacta de agenda18
// si existe; si la fuente solo da hora, esa hora es de Lima (UTC-5, backend de
// agenda18) y la convertimos a la zona del usuario.
function eventStartUtc(event, tz) {
  if (event.startUtc) return event.startUtc
  return event.time ? wallTimeToUtc(event.time, 'America/Lima') : null
}

function buildMeta(event, config) {
  const tz = resolveTz(config)
  const startUtc = eventStartUtc(event, tz)
  const live = isLiveNow(startUtc, Date.now(), event.sport)
  const timeStr = startUtc ? formatTimeInTz(startUtc, tz) : event.time

  return {
    id: PREFIX + titleToId(event.title),
    type: 'tv',
    name: (live ? 'EN VIVO · ' : '') + event.title,
    posterShape: 'landscape',
    poster: `${process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 7000}`}/poster/${encodeURIComponent(titleToId(event.title))}.png`,
    description: `${live ? '🔴 EN VIVO' : 'Programado'} · ${event.sport}${timeStr ? ' · ' + timeStr : ''} · ${event.streams.length} enlace(s) disponible(s)`,
    releaseInfo: timeStr,
    genres: [event.sport]
  }
}

// CATALOGO: lista de eventos del dia (con portadas de equipos)
builder.defineCatalogHandler(async (args) => {
  if (args.type === 'tv' && args.id === 'deportes') {
    try {
      const events = await getEvents()
      return { metas: events.map((e) => buildMeta(e, args.config)) }
    } catch (err) {
      console.error('[catalog] error:', err.message)
      return { metas: [] }
    }
  }
  return { metas: [] }
})

// META: necesario para que Stremio reconozca el item como canal de TV jugable
builder.defineMetaHandler(async (args) => {
  if (args.type === 'tv' && args.id.startsWith(PREFIX)) {
    try {
      const title = idToTitle(args.id.slice(PREFIX.length))
      const event = await getEventByTitle(title)
      if (!event) return { meta: null }

      const meta = buildMeta(event, args.config)
      return { meta }
    } catch (err) {
      console.error('[meta] error:', err.message)
      return { meta: null }
    }
  }
  return { meta: null }
})

// STREAM: dado el id del evento, sirve los m3u8 reales (fetch en tiempo real por tokens)
builder.defineStreamHandler(async (args) => {
  if (args.type === 'tv') {
    const title = args.id.startsWith(PREFIX) ? idToTitle(args.id.slice(PREFIX.length)) : null
    if (!title) return { streams: [] }

    try {
      const event = await getEventByTitle(title)
      if (!event || !event.streams.length) return { streams: [] }

      // Fetches en paralelo para no superar el timeout de Stremio
      const proxyBase = process.env.PUBLIC_BASE_URL || ''
      const results = await Promise.all(
        event.streams.map(async (s) => {
          try {
            // Se pasa la URL del canal (ej. canal.php) al proxy: el proxy
            // extrae el m3u8 con SU IP, asi el token del playback queda ligado
            // a la misma IP que descarga los segmentos (en serverless la IP
            // egress varia entre invocaciones y si el token se genera en una
            // invocacion distinta, fubo18 responde 403).
            // La extension se fuerza a .m3u8: la URL termina en .php y los
            // players internos (ExoPlayer/Media3 de Stremio Android) no la
            // reconocen como HLS, fallan y Stremio "switchea" a VLC.
            const finalUrl = proxyBase ? proxiedUrl(proxyBase, s.url, 'm3u8') : s.url
            return {
              name: s.label || s.source,
              title: s.label || s.source,
              url: finalUrl,
              behaviorHints: {
                // HLS via proxy https: dejar que Stremio use su player interno
                // (ExoPlayer en Android, hls.js en web). notWebReady:true forza
                // a player externo y causa el "switch de reproductores".
                notWebReady: false
              }
            }
          } catch (err) {
            console.error('[stream] enlace fallido (' + s.label + '):', err.message)
            return null
          }
        })
      )

      return { streams: results.filter(Boolean) }
    } catch (err) {
      console.error('[stream] error:', err.message)
      return { streams: [] }
    }
  }
  return { streams: [] }
})

// Exporta el router Express del addon (para serverless: Vercel/Netlify)
function createApp() {
  const app = express()
  app.use(express.json())
  // /proxy y /proxy/seg.ts (el segmento real viaja en ?url=)
  app.get('/proxy', proxyHandler)
  app.get('/proxy/:name', proxyHandler)
  // Archivos estaticos: logo, fondo y favicon de la landing
  app.use('/assets', express.static(path.join(__dirname, 'assets')))
  // /poster/<id>.png: portada generada en PNG (sharp) porque Stremio en
  // Android no renderiza SVG data URI como posters
  app.get('/poster/:id', async (req, res) => {
    try {
      const id = req.params.id.replace(/\.png$/i, '')
      const title = idToTitle(decodeURIComponent(id))
      const event = title ? await getEventByTitle(title) : null
      if (!event) return res.status(404).send('Evento no encontrado')
      const png = await eventPoster(event)
      if (!png) return res.status(500).send('Error generando portada')
      res.set('Content-Type', 'image/png')
      res.set('Cache-Control', 'public, max-age=1800, s-maxage=1800')
      res.send(png)
    } catch (err) {
      console.error('[poster] error:', err.message)
      res.status(500).send('Error generando portada')
    }
  })
  app.use(getRouter(builder.getInterface()))

  // Landing page + /configure: necesarios para que Stremio muestre el boton
  // "Configure" al instalar (redirige aqui cuando el manifest tiene config).
  // Es lo mismo que hace serveHTTP del SDK, pero nuestro createApp es custom.
  const hasConfig = !!(manifest.config || []).length
  const landingHTML = configurePage(manifest)
  app.get('/', (_, res) => {
    if (hasConfig) {
      return res.redirect('/configure')
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(landingHTML)
  })
  if (hasConfig) {
    app.get('/configure', (_, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(landingHTML)
    })
  }
  return app
}

// Si se ejecuta directamente (node addon.js), arranca el servidor local
if (require.main === module) {
  const port = process.env.PORT || 7000
  serveHTTP(builder.getInterface(), { port })
  console.log(`MeteGol addon corriendo en http://127.0.0.1:${port}/manifest.json`)
}

module.exports = { createApp, builder, manifest }
