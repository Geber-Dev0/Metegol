'use strict'

module.exports = {
  id: 'com.metegol.live.v3',
  version: '1.4.0',
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
  idPrefixes: ['metegol', 'metegol:']
}
