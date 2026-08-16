'use strict'

const { TZ_OPTIONS } = require('./lib/common')

module.exports = {
  id: 'com.metegol.live.v3',
  version: '1.6.0',
  name: 'MeteGol',
  description: 'Deportes en vivo: fútbol (Liga Profesional, LaLiga, Libertadores), UFC y más. Fuentes: alangulotv.si, futbollibretv.sx, agenda18.com.',
  resources: ['catalog', 'meta', 'stream'],
  types: ['tv'],
  catalogs: [
    {
      type: 'tv',
      id: 'deportes',
      name: 'MeteGol Live'
    }
  ],
  idPrefixes: ['metegol', 'metegol:'],
  behaviorHints: {
    // la config se elige una vez por usuario y Stremio la guarda en la URL
    configurable: true
  },
  config: [
    {
      key: 'timezone',
      type: 'select',
      title: 'Zona horaria (para mostrar los horarios de los partidos)',
      default: 'Argentina (UTC-3)',
      options: TZ_OPTIONS.map((o) => o.label),
      required: true
    }
  ]
}
