# MeteGol ⚽

Addon de **Stremio** para ver deportes en vivo (fútbol, UFC, tenis, F1 y más) a partir de la
agenda de cuatro fuentes: [alangulotv.si](https://alangulotv.si), [futbollibretv.sx](https://futbollibretv.sx),
[agenda18.com](https://agenda18.com) (backend de futbollibre.mx / rojadirectaa.net) y
[deporflix.pe](https://deporflix.pe) (partidos puntuales "X vs Y").

> ⚠️ **Aviso importante:** Este addon redirige a streams de terceros no autorizados
> (ESPN, Fox, TNT, etc.). Ver [`docs/LEGAL.md`](docs/LEGAL.md) antes de usarlo y, sobre
> todo, antes de distribuirlo.

## ¿Qué hace?

- Lee la **agenda del día** de cuatro fuentes y las **fusiona en un solo catálogo**,
  deduplicando por título y combinando los enlaces del mismo partido.
- Lista los partidos/eventos en el catálogo de Stremio (`MeteGol Live`) con
  **portadas PNG generadas** (texto vectorial sin depender de fuentes del sistema):
  escudos de los equipos (vía TheSportsDB) cuando existen y **nombres de los equipos
  siempre abajo**. Texto normalizado (sin tildes). Si el evento está en vivo, muestra
  un badge "EN VIVO".
- Al abrir un evento, extrae en **tiempo real** los enlaces HLS (`.m3u8`) de los
  servidores de terceros y los sirve a Stremio como streams reproducibles (URL forzada
  a `.m3u8` para que ExoPlayer/Media3 los reconozca como HLS), ordenados por
  **proveedor más estable primero** (la18hd.su > fubo18.com > streamtp-golden1.click, etc.).
- En despliegue serverless (Netlify) los streams pasan por un **proxy HLS** (`lib/proxy.js`)
  que descarga m3u8 y segmentos desde la misma IP del token y los reescribe, con
  **doble vía**: URL tokenizada directa y, si falla, **re-extracción de la playlist
  fresca** dentro de la misma invocación (segmentos por índice, inmune a la rotación
  de nodos CDN y a la expiración de ~2 s de fubo18).
- **Configurable** (zona horaria para los horarios): al instalar, Stremio abre
  `/configure` para elegir el timezone (Argentina, Perú, Chile, México, etc.).

## Requisitos

- Node.js 18+ (probado con v24).
- Acceso a internet (el addon consulta las fuentes de agenda y los hosts de streaming en vivo).

## Instalación y uso local

```bash
npm install          # instala stremio-addon-sdk y express
npm start            # levanta el addon en http://127.0.0.1:7000
```

Luego, en Stremio (versión de escritorio):

1. Abre la pantalla de **Addons**.
2. Pega la URL: `http://localhost:7000/manifest.json`
3. Instala **MeteGol**.
4. Ve a "MeteGol Live" en tu catálogo y elige un partido.

> Stremio solo acepta HTTP sin HTTPS si es `127.0.0.1`/`localhost`. Para compartir el
> addon con otros dispositivos necesitás HTTPS (ver [`docs/INSTALACION.md`](docs/INSTALACION.md)).

## Despliegue en Netlify (URL fija)

El addon se publica en Netlify (URL HTTPS fija) usando una función serverless que envuelve
el router Express (`netlify/functions/addon.js` con `serverless-http`) más los assets
estáticos en `public/`:

```bash
npx netlify login          # una sola vez (login en navegador)
npx netlify-cli deploy --prod --dir public --functions netlify/functions --site <site-id>
```

Variables de entorno del sitio: `PUBLIC_BASE_URL` (URL del addon), `FOOTBALL_API_KEY` (API-Football).
El proxy de streaming queda en la misma URL (`PROXY_BASE_URL` opcional; sin ella usa
`PUBLIC_BASE_URL`). Fubo18 bloquea los rangos IP de Cloudflare Workers, por eso el proxy
vive en Netlify y no en el Worker (`workers/proxy/`, desplegado como respaldo/alternativa).

Después de desplegar, instala en Stremio la URL:
`https://<tu-proyecto>.netlify.app/manifest.json`

> Vercel ya no se usa como hosting (el plan free agotó el Fast Origin Transfer por el
> streaming del proxy). El `vercel.json`/`api/index.js` quedan por compatibilidad.

## Estructura del proyecto

```
MeteGol/
├── package.json            # dependencias y scripts
├── addon.js                # addonBuilder + handlers (catalog/meta/stream) + router Express
├── manifest.js             # definición del addon (id v5, config de zona horaria, recursos)
├── api/index.js            # entry point serverless para Vercel (compatibilidad, ya no se usa)
├── vercel.json             # configuración de despliegue en Vercel (legacy)
├── netlify.toml            # configuración de despliegue en Netlify (función + assets)
├── netlify/functions/addon.js  # handler Netlify Functions (serverless-http)
├── public/assets/          # assets estáticos que sirve Netlify (logo, fondo, favicon)
├── workers/proxy/          # Cloudflare Worker proxy HLS (respaldo; fubo18 bloquea sus IPs)
├── lib/
│   ├── common.js           # helpers compartidos (fetch, decode, normalize, classify, TZ)
│   ├── scraper.js          # fusión de las 4 fuentes + prioridad de proveedores
│   ├── scraper-futbollibre.js  # parsea futbollibretv.sx/eventos.js
│   ├── scraper-agenda18.js     # consume agenda18.com/agenda.json (.mx / rojadirectaa)
│   ├── scraper-deporflix.js    # partidos puntuales de deporflix.pe (WordPress Dooplay AJAX)
│   ├── extractor.js        # obtiene el m3u8 desde los endpoints de 3º
│   ├── proxy.js            # proxy HLS doble vía (directo + re-extracción) en serverless
│   ├── landing.js          # página /configure (INSTALL / INSTALL EN WEB / COPIAR URL)
│   └── teamlogos.js        # portadas PNG (opentype->SVG->sharp) con escudos + nombres
├── assets/DejaVuSans-Bold.ttf  # fuente embebida para las portadas
├── test.js                 # prueba rápida de scraper + extractor
└── docs/                   # documentación detallada
    ├── ARQUITECTURA.md
    ├── INSTALACION.md
    ├── MANTENIMIENTO.md
    └── LEGAL.md
```

## Pruebas rápidas sin servidor

```bash
npm test     # valida que el scraping, el merge de fuentes y la extracción de m3u8 funcionen
```

## Documentación

- [Arquitectura](docs/ARQUITECTURA.md) — cómo fluye la información paso a paso.
- [Instalación](docs/INSTALACION.md) — uso local, despliegue en Netlify, HTTPS.
- [Mantenimiento](docs/MANTENIMIENTO.md) — dominios, tokens, troubleshooting.
- [Legal](docs/LEGAL.md) — consideraciones sobre el contenido.