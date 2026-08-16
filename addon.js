'use strict'

const express = require('express')
const { addonBuilder, serveHTTP } = require('stremio-addon-sdk')
const getRouter = require('stremio-addon-sdk/src/getRouter')
const manifest = require('./manifest')
const { getEvents, getEventByTitle, titleToId, idToTitle, decodeStreamUrl } = require('./lib/scraper')
const { getStreamUrl } = require('./lib/extractor')
const { eventPoster } = require('./lib/teamlogos')

const PREFIX = 'metegol:'

const builder = new addonBuilder(manifest)

function buildMeta(event) {
  return {
    id: PREFIX + titleToId(event.title),
    type: 'tv',
    name: event.title,
    posterShape: 'landscape',
    description: `${event.sport}${event.time ? ' · ' + event.time : ''} · ${event.streams.length} enlace(s) disponible(s)`,
    releaseInfo: event.time,
    genres: [event.sport]
  }
}

// CATALOGO: lista de eventos del dia (con portadas de equipos)
builder.defineCatalogHandler(async (args) => {
  if (args.type === 'tv' && args.id === 'deportes') {
    try {
      const events = await getEvents()
      const metas = await Promise.all(
        events.map(async (e) => {
          const meta = buildMeta(e)
          meta.poster = await eventPoster(e)
          return meta
        })
      )
      return { metas }
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

      const meta = buildMeta(event)
      meta.poster = await eventPoster(event)
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
      const results = await Promise.all(
        event.streams.map(async (s) => {
          try {
            const m3u8 = await getStreamUrl(s.url, 'https://alangulotv.si/')
            return {
              name: s.label || s.source,
              title: s.label || s.source,
              url: m3u8,
              behaviorHints: {
                notWebReady: true
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
  app.use(getRouter(builder.getInterface()))
  return app
}

// Si se ejecuta directamente (node addon.js), arranca el servidor local
if (require.main === module) {
  const port = process.env.PORT || 7000
  serveHTTP(builder.getInterface(), { port })
  console.log(`MeteGol addon corriendo en http://127.0.0.1:${port}/manifest.json`)
}

module.exports = { createApp, builder, manifest }
