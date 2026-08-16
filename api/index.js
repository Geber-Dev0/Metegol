'use strict'

// Entry point para Vercel (serverless): expone la app Express del addon.
// el archivo vercel.json define como se enruta a esta funcion.
const { createApp } = require('../addon')

const app = createApp()

module.exports = app
