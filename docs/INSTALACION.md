# Instalación y despliegue

## 1. Uso local (desarrollo / pruebas)

Stremio permite addons HTTP **sin HTTPS** solo si la URL es `127.0.0.1` o `localhost`.

```bash
cd Metegol
npm install
npm start
```

El servidor queda en `http://127.0.0.1:7000` (puerto configurable con `PORT`).

### Instalar en Stremio (escritorio)

1. Abrir Stremio en Windows/macOS/Linux.
2. Ir a la sección **Addons** → "Addon no oficial / Load addon".
3. Pegar: `http://localhost:7000/manifest.json`
4. Confirmar la instalación de **MeteGol**.
5. Stremio abre `/configure` para elegir la **zona horaria** (Argentina, Perú, Chile,
   México, etc.); los horarios del catálogo se muestran en esa zona.

Para Android/TV no sirve `localhost` (es otro dispositivo); ahí necesitás HTTPS
público (ver sección 3).

## 2. Probar sin levantar el servidor

`test.js` valida el scraping, el merge de fuentes y la extracción de streams sin el
servidor HTTP:

```bash
npm test
```

Muestra los eventos del día (fusionados de las fuentes) y el primer `.m3u8` obtenido.

## 3. Despliegue público (HTTPS obligatorio)

Stremio exige HTTPS para cualquier addon que no sea `127.0.0.1`. La arquitectura
final tiene **dos partes**: el addon público en Netlify (catálogo, portadas,
manifest, streams) y el **proxy HLS en tu PC** (descarga los m3u8/segmentos desde
tu IP residencial) expuesto por un **túnel de Cloudflare**. Ver
[`SERVIDOR.md`](SERVIDOR.md) para montar el PC servidor completo.

```
Stremio ──> Netlify (catálogo/portadas/streams, HTTPS)
                 │  PROXY_BASE_URL apunta al túnel
                 ▼
          túnel Cloudflare (URL HTTPS estable)
                 ▼
          Tu PC: addon local + proxy HLS (127.0.0.1:7000)
```

### a) Netlify (catálogo/portadas/streams públicos)

El proyecto incluye `netlify.toml` y `netlify/functions/addon.js` (envuelve el router
Express con `serverless-http`; los assets estáticos viven en `public/`):

```bash
npx netlify login               # una sola vez (login en navegador)
npx netlify-cli sites:create --name <nombre> --json   # si no existe el sitio
npx netlify-cli deploy --prod --dir public --functions netlify/functions --site <site-id>
```

Variables de entorno del sitio (con `netlify-cli env:set`):
- `PUBLIC_BASE_URL` = `https://<tu-proyecto>.netlify.app`
- `FOOTBALL_API_KEY` = key de API-Football
- `PROXY_BASE_URL` = URL del túnel (p. ej. `https://stream.metegol-live.eu.org` o
  la URL de un quick tunnel `https://xxxx.trycloudflare.com`). **Obligatoria** para
  que el streaming salga de tu PC; si no está, el proxy apunta a `PUBLIC_BASE_URL`.

Instalás en Stremio la URL: `https://<tu-proyecto>.netlify.app/manifest.json`

> Tras cambiar env vars hay que **redesplegar** para que tomen efecto.

### b) Proxy local + túnel Cloudflare (streaming)

Los proveedores de streams generan tokens **ligados a la IP** que pide la playlist
y bloquean las IPs de datacenter (fubo18 bloquea incluso los rangos de Cloudflare
Workers). Por eso los `.m3u8` y `.ts` los descarga **tu PC** (IP residencial) a
través del addon local en `127.0.0.1:7000`, expuesto con un túnel de Cloudflare:

```bash
node addon.js                     # en el PC servidor
cloudflared tunnel --url http://127.0.0.1:7000 --no-autoupdate   # quick tunnel (temporal)
# o túnel nombrado con dominio propio (URL estable): ver docs/SERVIDOR.md
```

El addon local sirve el **mismo proxy** (`lib/proxy.js`) que en serverless, con la
doble vía (URL tokenizada directa + re-extracción por índice). Como sale desde una IP
residencial, el token del playback siempre coincide con la IP que descarga los
segmentos → sin 403.

> **Diferencia clave con serverless:** en Netlify el proxy fallaría (IP de
> datacenter bloqueada); por eso el proxy se ejecuta localmente y Netlify solo
> genera el catálogo/streams con `PROXY_BASE_URL` apuntando al túnel.

### c) Cloudflare Worker (proxy de respaldo)

`workers/proxy/` es un port del proxy HLS para Cloudflare Workers (sin Express):

```bash
cd workers/proxy
npx wrangler login
npx wrangler deploy
```

> ⚠️ Fubo18 **bloquea los rangos IP compartidos de Cloudflare Workers** (respuesta 403
> al pedir el m3u8; el mismo flujo funciona desde una IP residencial o Netlify).
> Por eso el proxy principal corre en tu PC y el Worker queda como respaldo/alternativa
> para hosts que no bloqueen a Cloudflare. Se activa seteando `PROXY_BASE_URL` a la
> URL del Worker.

### d) Vercel (legacy)

`vercel.json` y `api/index.js` quedan por compatibilidad. Ya no se usa como hosting:
el plan free agotó el **Fast Origin Transfer** (~10 GB/mes) por el streaming del proxy.

### e) Tunnel local (solo para probar desde otro dispositivo)

```bash
npx localtunnel --port 7000
```

Te da una URL HTTPS pública que apunta a tu `localhost`. Útil para validar en Android
TV sin desplegar, pero no es estable a largo plazo.

## 4. Publicar en la colección central (opcional)

```js
const { publishToCentral } = require('stremio-addon-sdk')
publishToCentral('https://tu-dominio/manifest.json')
```

> ⚠️ Hacer el addon público lo expone a terceros y a los dominios de streaming
> involucrados. Ver [`LEGAL.md`](LEGAL.md) antes de publicar.