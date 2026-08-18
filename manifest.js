'use strict'

const { TZ_OPTIONS } = require('./lib/common')

const BASE = process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:7000'

module.exports = {
  id: 'com.metegol.live.v5',
  version: '1.7.2',
  name: 'MeteGol',
  description: 'Fútbol en vivo: las principales ligas de toda América y Europa',
  logo: `${BASE}/assets/logo.png`,
  background: `${BASE}/assets/fondo.jpg`,
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
