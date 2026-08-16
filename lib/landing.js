'use strict'

// Pagina de configuracion/instalacion del addon. Reemplaza a la landing del
// SDK para ofrecer, ademas del INSTALL (stremio://), botones de "Copiar URL"
// e "Instalar en web" (app.strem.io) que funcionan en navegadores/dispositivos
// donde el protocolo stremio:// no abre la app.

const CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; width: 100%; min-height: 100%; }
html { background: #131216; }
body {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Open Sans', Arial, sans-serif;
  color: #eee;
  padding: 24px;
}
.card {
  width: 100%;
  max-width: 420px;
  background: #1d1b21;
  border: 1px solid #2a2830;
  border-radius: 14px;
  padding: 28px 26px;
  text-align: center;
}
.logo { height: 64px; width: 64px; margin: 0 auto 12px; border-radius: 12px; overflow: hidden; background: #2a2830; display:flex; align-items:center; justify-content:center; }
.logo img { width: 100%; height: 100%; object-fit: cover; }
h1 { font-size: 22px; margin: 0; }
.version { color: #9a93a6; font-size: 12px; margin: 4px 0 12px; }
.desc { color: #bdb6c7; font-size: 13px; line-height: 1.5; margin: 0 0 18px; }
.field { text-align: left; margin-bottom: 8px; }
.field label { display: block; font-size: 12px; color: #c9c2d4; margin-bottom: 6px; }
.field select {
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  color: #eee;
  background: #26232c;
  border: 1px solid #36333f;
  border-radius: 8px;
  outline: none;
}
.field select:focus { border-color: #8A5AAB; }
.btn {
  display: block;
  width: 100%;
  padding: 12px 16px;
  margin-top: 10px;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  background: #8A5AAB;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  text-decoration: none;
  font-family: inherit;
  transition: background 0.12s ease;
}
.btn:hover { background: #9b6cbd; }
.btn.secondary { background: #33303b; }
.btn.secondary:hover { background: #3d3a46; }
.btn.ghost { background: transparent; border: 1px solid #45414f; color: #cfc8da; }
.btn.ghost:hover { border-color: #6a6375; }
#copied { display: none; color: #7ed67e; font-size: 12px; margin-top: 8px; }
.hint { font-size: 11px; color: #8d8699; margin-top: 14px; line-height: 1.5; }
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
          <label for="${elem.key}">${elem.title}</label>
          <select id="${elem.key}" name="${elem.key}">${options}</select>
        </div>`
    }
  })

  return `<!DOCTYPE html>
<html lang="es" style="background-image: url(${background}); background-size: cover;">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${manifest.name} - Stremio Addon</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="card">
    <div class="logo"><img src="${logo}" alt=""></div>
    <h1>${manifest.name}</h1>
    <div class="version">v${manifest.version || '0.0.0'}</div>
    <p class="desc">${manifest.description || ''}</p>

    <form id="mainForm">
      ${formHTML}
    </form>

    <a id="installLink" class="btn" href="#">INSTALL</a>
    <button id="webBtn" class="btn secondary" type="button">INSTALL EN WEB</button>
    <button id="copyBtn" class="btn ghost" type="button">COPIAR URL</button>
    <div id="copied">URL copiada al portapapeles</div>

    <p class="hint">Si "INSTALL" no abre Stremio, usá "INSTALL EN WEB" o copiá la URL y pegala en Stremio → Addons → Añadir desde URL.</p>
  </div>

  <script>
    var installLink = document.getElementById('installLink')
    var webBtn = document.getElementById('webBtn')
    var copyBtn = document.getElementById('copyBtn')
    var mainForm = document.getElementById('mainForm')
    var copied = document.getElementById('copied')

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