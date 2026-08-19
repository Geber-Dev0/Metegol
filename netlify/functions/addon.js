'use strict'

// Netlify function: envolver el addon Express con serverless-http.
// El path completo llega en event.path (rewrite /* a esta funcion), asi que
// express resuelve /manifest.json, /catalog/*, /stream/*, /poster/*, etc.

const serverless = require('serverless-http')
const { createApp } = require('../../addon')

const app = createApp()

exports.handler = serverless(app, {
  binary: ['image/png', 'video/mp2t', 'application/octet-stream']
})