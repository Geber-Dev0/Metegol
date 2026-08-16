# MeteGol ⚽

Addon de **Stremio** para ver deportes en vivo (fútbol, UFC, tenis, F1 y más) a partir de la
agenda de tres fuentes: [alangulotv.si](https://alangulotv.si), [futbollibretv.sx](https://futbollibretv.sx)
y [agenda18.com](https://agenda18.com) (backend de futbollibre.mx / rojadirectaa.net).

> ⚠️ **Aviso importante:** Este addon redirige a streams de terceros no autorizados
> (ESPN, Fox, TNT, etc.). Ver [`docs/LEGAL.md`](docs/LEGAL.md) antes de usarlo y, sobre
> todo, antes de distribuirlo.

## ¿Qué hace?

- Lee la **agenda del día** de tres fuentes y las **fusiona en un solo catálogo**,
  deduplicando por título y combinando los enlaces del mismo partido.
- Lista los partidos/eventos en el catálogo de Stremio (`MeteGol Live`) con
  **portadas que incluyen los escudos de los equipos** (vía TheSportsDB, con fallback a emoji).
- Al abrir un evento, extrae en **tiempo real** los enlaces HLS (`.m3u8`) de los
  servidores de terceros y los sirve a Stremio como streams reproducibles, ordenados por
  **proveedor más estable primero** (la18hd.su > fubo18.com > streamtp-golden1.click, etc.).

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

## Despliegue en Vercel (URL fija)

El addon puede publicarse en Vercel para tener una URL HTTPS fija (sin túnel):

```bash
npm run vercel:deploy   # requiere haber iniciado sesión con `vercel login`
```

Después de desplegar, instala en Stremio la URL:
`https://<tu-proyecto>.vercel.app/manifest.json`

## Estructura del proyecto

```
MeteGol/
├── package.json            # dependencias y scripts
├── addon.js                # addonBuilder + handlers (catalog/meta/stream) + router Express
├── manifest.js             # definición del addon (id, nombre, recursos, tipos)
├── api/index.js            # entry point serverless para Vercel (monta el router Express)
├── vercel.json             # configuración de despliegue en Vercel
├── lib/
│   ├── common.js           # helpers compartidos (fetch, decode, normalize, classify)
│   ├── scraper.js          # fusión de las 3 fuentes + prioridad de proveedores
│   ├── scraper-futbollibre.js  # parsea futbollibretv.sx/eventos.js
│   ├── scraper-agenda18.js     # consume agenda18.com/agenda.json (.mx / rojadirectaa)
│   ├── extractor.js        # obtiene el m3u8 desde los endpoints de 3º
│   └── teamlogos.js        # portadas con escudos de equipos (TheSportsDB) + fallback
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
- [Instalación](docs/INSTALACION.md) — uso local, despliegue en Vercel/Netlify, HTTPS.
- [Mantenimiento](docs/MANTENIMIENTO.md) — dominios, tokens, troubleshooting.
- [Legal](docs/LEGAL.md) — consideraciones sobre el contenido.