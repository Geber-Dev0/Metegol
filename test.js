'use strict'

// Prueba rapida del scraper y extractor sin levantar el servidor
const { getEvents, getEventByTitle, decodeStreamUrl } = require('./lib/scraper')
const { extractPlaybackUrl, getStreamUrl } = require('./lib/extractor')

async function main() {
  console.log('=== Testing scraper: agenda.php ===')
  const events = await getEvents()
  console.log('Eventos encontrados:', events.length)
  events.slice(0, 5).forEach((e) => {
    console.log(`- [${e.time}] ${e.emoji} ${e.sport}: ${e.title} (${e.streams.length} enlaces)`)
  })

  console.log('\n=== Testing extraccion de stream (primer evento con enlaces) ===')
  const withStream = events.find((e) => e.streams.length)
  if (!withStream) {
    console.log('No hay eventos con streams')
    return
  }
  console.log('Evento:', withStream.title)
  console.log('Enlace decodificado:', withStream.streams[0].url)

  try {
    const m3u8 = await getStreamUrl(withStream.streams[0].url, 'https://alangulotv.si/')
    console.log('m3u8 obtenido:', m3u8)
  } catch (err) {
    console.error('Error extrayendo m3u8:', err.message)
  }
}

main().catch((e) => {
  console.error('FALLO GENERAL:', e)
  process.exit(1)
})
