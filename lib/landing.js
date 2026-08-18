'use strict'

// Pagina de configuracion/instalacion del addon. Reemplaza a la landing del
// SDK para ofrecer, ademas del INSTALL (stremio://), botones de "Copiar URL"
// e "Instalar en web" (app.strem.io) que funcionan en navegadores/dispositivos
// donde el protocolo stremio:// no abre la app. Textos con toggle ES/EN.

const TEXTS = {
  es: {
    desc: 'Fútbol en vivo: las principales ligas de toda América y Europa',
    by: 'Desarrollado por Geber.Dev',
    install: 'INSTALL',
    web: 'INSTALL EN WEB',
    copy: 'COPIAR URL',
    copied: 'URL copiada al portapapeles',
    hint: 'Si "INSTALL" no abre Stremio, usá "INSTALL EN WEB" o copiá la URL y pegala en Stremio → Addons → Añadir desde URL.',
    kofi: 'Apoyar en Ko-fi ☕',
    'field.timezone': 'Zona horaria (para mostrar los horarios de los partidos)',
    lang: 'EN'
  },
  en: {
    desc: 'Live football: the main leagues of all the Americas and Europe',
    by: 'Developed by Geber.Dev',
    install: 'INSTALL',
    web: 'INSTALL ON WEB',
    copy: 'COPY URL',
    copied: 'URL copied to clipboard',
    hint: 'If "INSTALL" does not open Stremio, use "INSTALL ON WEB" or copy the URL and paste it in Stremio → Addons → Add from URL.',
    kofi: 'Support on Ko-fi ☕',
    'field.timezone': 'Timezone (to show match times)',
    lang: 'ES'
  }
}

const CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; width: 100%; min-height: 100%; }
html { background: #0a3d1c; }
body {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Open Sans', Arial, sans-serif;
  color: #fff;
  padding: 24px;
}
.lang-toggle {
  position: fixed;
  top: 14px;
  right: 14px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: #0d1a10;
  border: 1px solid #33523a;
  border-radius: 20px;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.12s ease;
}
.lang-toggle:hover { background: #12321c; border-color: #facc15; }
.card {
  width: 100%;
  max-width: 420px;
  background: #0d1a10;
  border: 1px solid #33523a;
  border-radius: 14px;
  padding: 28px 26px;
  text-align: center;
}
.logo { height: 64px; width: 64px; margin: 0 auto 12px; border-radius: 12px; overflow: hidden; background: #0f2416; display:flex; align-items:center; justify-content:center; }
.logo img { width: 100%; height: 100%; object-fit: cover; }
h1 { font-size: 22px; margin: 0; }
.version { color: #7ecb8e; font-size: 12px; margin: 4px 0 12px; }
.desc { color: #cfe8d6; font-size: 13px; line-height: 1.5; margin: 0 0 6px; }
.author { color: #a8c9b2; font-size: 12px; margin: 14px 0 4px; }
.field { text-align: left; margin-bottom: 8px; }
.field label { display: block; font-size: 12px; color: #cfe8d6; margin-bottom: 6px; }
.field select {
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  color: #fff;
  background: #12321c;
  border: 1px solid #2f5c3a;
  border-radius: 8px;
  outline: none;
}
.field select:focus { border-color: #facc15; }
.btn {
  display: block;
  width: 100%;
  padding: 12px 16px;
  margin-top: 10px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: #16a34a;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  text-decoration: none;
  font-family: inherit;
  transition: background 0.12s ease;
}
.btn:hover { background: #1fb657; }
.btn.secondary { background: #facc15; color: #1a1a1a; }
.btn.secondary:hover { background: #fde047; }
.btn.ghost { background: transparent; border: 1px solid #e8f5ec; color: #f2f7f4; }
.btn.ghost:hover { border-color: #ffffff; }
#copied { display: none; color: #4ade80; font-size: 12px; margin-top: 8px; }
.hint { font-size: 11px; color: #a8c9b2; margin-top: 14px; line-height: 1.5; }
`

function configurePage(manifest) {
  const background = manifest.background || 'https://dl.strem.io/addon-background.jpg'
  const logo = manifest.logo || 'https://dl.strem.io/addon-logo.png'

  let formHTML = ''
  ;(manifest.config || []).forEach((elem) => {
    if (elem.type === 'select') {
      const defaultValue = elem.default || (elem.options || [])[0]
      const options = (elem.options || [])
        .map((o) => `<option value="${o}"${o === defaultValue ? ' selected' : ''}>${o}</option>`)
        .join('')
      formHTML += `
        <div class="field">
          <label for="${elem.key}" data-i18n="${elem.key === 'timezone' ? 'field.timezone' : elem.key}">${elem.title}</label>
          <select id="${elem.key}" name="${elem.key}">${options}</select>
        </div>`
    }
  })

  return `<!DOCTYPE html>
<html lang="es" style="background-image: linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(${background}); background-size: cover; background-position: center;">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/assets/favicon.png">
  <title>${manifest.name} - Stremio Addon</title>
  <style>${CSS}</style>
</head>
<body>
  <button id="langToggle" class="lang-toggle" type="button">EN</button>
  <div class="card">
    <div class="logo"><img src="${logo}" alt=""></div>
    <h1>${manifest.name}</h1>
    <div class="version">v${manifest.version || '0.0.0'}</div>
    <p class="desc" data-i18n="desc">${TEXTS.es.desc}</p>

    <form id="mainForm">
      ${formHTML}
    </form>

    <a id="installLink" class="btn" href="#" data-i18n="install">${TEXTS.es.install}</a>
    <button id="webBtn" class="btn secondary" type="button" data-i18n="web">${TEXTS.es.web}</button>
    <button id="copyBtn" class="btn ghost" type="button" data-i18n="copy">${TEXTS.es.copy}</button>
    <div id="copied" data-i18n="copied">${TEXTS.es.copied}</div>

    <p class="hint" data-i18n="hint">${TEXTS.es.hint}</p>
    <p class="author" data-i18n="by">${TEXTS.es.by}</p>
    <a class="btn ghost" href="https://ko-fi.com/geberdev" target="_blank" rel="noopener" data-i18n="kofi">${TEXTS.es.kofi}</a>
  </div>

  <script>
    var installLink = document.getElementById('installLink')
    var webBtn = document.getElementById('webBtn')
    var copyBtn = document.getElementById('copyBtn')
    var mainForm = document.getElementById('mainForm')
    var copied = document.getElementById('copied')
    var langToggle = document.getElementById('langToggle')

    var TEXTS = ${JSON.stringify(TEXTS)}
    var lang = (navigator.language || 'es').toLowerCase().indexOf('es') === 0 ? 'es' : 'en'

    function applyLang() {
      document.documentElement.lang = lang
      document.querySelectorAll('[data-i18n]').forEach(function (el) {
        var key = el.getAttribute('data-i18n')
        el.textContent = TEXTS[lang][key]
      })
      langToggle.textContent = TEXTS[lang].lang
    }
    langToggle.onclick = function () { lang = lang === 'es' ? 'en' : 'es'; applyLang() }
    applyLang()

    var manifestPath = '/manifest.json'

    function configObj() {
      return Object.fromEntries(new FormData(mainForm))
    }

    function baseManifestUrl() {
      var enc = encodeURIComponent(JSON.stringify(configObj()))
      return window.location.protocol + '//' + window.location.host + '/' + enc + manifestPath
    }

    function updateLink() {
      var full = baseManifestUrl()
      installLink.href = 'stremio://' + full.replace(/^https?:\\/\\//, '')
    }

    mainForm.onchange = updateLink
    updateLink()

    webBtn.onclick = function () {
      var url = baseManifestUrl()
      var open = 'https://app.strem.io/#?addonOpen=' + encodeURIComponent(url)
      window.open(open, '_blank')
    }

    copyBtn.onclick = function () {
      var url = baseManifestUrl()
      var done = function () {
        copied.style.display = 'block'
        setTimeout(function () { copied.style.display = 'none' }, 2500)
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { fallback(url, done) })
      } else {
        fallback(url, done)
      }
    }

    function fallback(url, done) {
      var ta = document.createElement('textarea')
      ta.value = url
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch (e) {}
      document.body.removeChild(ta)
      done()
    }
  </script>
</body>
</html>`
}

module.exports = configurePage