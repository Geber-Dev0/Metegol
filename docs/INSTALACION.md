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

Muestra los eventos del día (fusionados de las 4 fuentes) y el primer `.m3u8` obtenido.

## 3. Despliegue público (HTTPS obligatorio)

Stremio exige HTTPS para cualquier addon que no sea `127.0.0.1`. Opciones:

### a) Netlify (URL fija recomendada)

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
- `PROXY_BASE_URL` = opcional; si no está, el proxy de streaming usa `PUBLIC_BASE_URL`.

Instalás en Stremio la URL: `https://<tu-proyecto>.netlify.app/manifest.json`

> Nota: en Netlify las funciones salen con IP de datacenter y los tokens de los
> proveedores van ligados a esa IP, por eso el addon sirve los streams a través de
> `/proxy` (`lib/proxy.js`), que descarga m3u8 y segmentos desde la misma IP del token
> y los reescribe para el reproductor (con re-extracción automática si el segmento
> expiró o el nodo CDN rotó). Ver [`ARQUITECTURA.md`](ARQUITECTURA.md).

### b) Cloudflare Worker (proxy de respaldo)

`workers/proxy/` es un port del proxy HLS para Cloudflare Workers (sin Express):

```bash
cd workers/proxy
npx wrangler login
npx wrangler deploy
```

> ⚠️ Fubo18 **bloquea los rangos IP compartidos de Cloudflare Workers** (respuesta 403
> al pedir el m3u8; el mismo flujo funciona desde Vercel/Netlify o una IP residencial).
> Por eso el proxy principal vive en Netlify y el Worker queda como respaldo/alternativa
> para hosts que no bloqueen a Cloudflare. Si algún día se desbloquea, se activa seteando
> `PROXY_BASE_URL` a la URL del Worker.

### c) Vercel (legacy)

`vercel.json` y `api/index.js` quedan por compatibilidad. Ya no se usa como hosting:
el plan free agotó el **Fast Origin Transfer** (~10 GB/mes) por el streaming del proxy.

### d) Hostings Node.js

Railway / Fly.io / Render / etc. Desplegás el repo; el addon escucha en la variable
de entorno `PORT`. La URL del addon será `https://<tu-dominio>/manifest.json`.

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