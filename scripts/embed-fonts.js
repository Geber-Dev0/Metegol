'use strict'
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', 'assets')
const dejavu = fs.readFileSync(path.join(root, 'DejaVuSans-Bold.ttf')).toString('base64')
const roboto = fs.readFileSync(path.join(root, 'Roboto-Bold.ttf')).toString('base64')

const out =
  "'use strict'\n\n" +
  "// Fuentes embebidas como base64 (DejaVu Sans Bold + Roboto Bold) para que\n" +
  "// esbuild las empaquete en la funcion serverless: fs.readFileSync no incluye\n" +
  '// los .ttf en el bundle. Generado con scripts/embed-fonts.js (no editar a mano).\n\n' +
  'module.exports = {\n' +
  "  dejavuSansBold: '" + dejavu + "',\n" +
  "  robotoBold: '" + roboto + "'\n" +
  '}\n'

fs.writeFileSync(path.join(__dirname, '..', 'lib', 'fonts-base64.js'), out)
console.log('OK total:', out.length, '| dejavu b64:', dejavu.length, '| roboto b64:', roboto.length)