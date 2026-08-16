# Arquitectura de MeteGol

## Cadena de datos

```mermaid
flowchart TD
    A[Stremio] -->|catalog/tv/deportes| B[defineCatalogHandler]
    A -->|meta/tv/metegol_xxx| M[defineMetaHandler]
    A -->|stream/tv/metegol_xxx| C[defineStreamHandler]

    B --> D[scraper.getEvents]
    D -->|GET agenda.php| E1[(alangulotv.si/agenda.php)]
    D -->|GET eventos.js| E2[(futbollibretv.sx/eventos.js)]
    D -->|GET agenda.json| E3[(agenda18.com/agenda.json)]
    E1 -->|HTML| D
    E2 -->|EVENTOS_DATA| D
    E3 -->|JSON Strapi| D
    D -->|merge + dedupe + prioridad| B
    B -->|metas con portadas| A

    M --> D2[scraper.getEventByTitle]
    D2 --> D
    D2 -->|evento| M
    M -->|meta| A

    C --> F[scraper.getEventByTitle]
    F --> D
    F -->|evento + enlaces| C
    C --> G[extractor.getStreamUrl]
    G -->|GET endpoint 3º| H[(la18hd.su / streamtp-golden1.click / streamx488.sbs)]
    H -->|HTML con playbackURL| G
    G -->|m3u8| C
    C -->|streams (url del proxy)| A
    A -->|reproduce m3u8 via /proxy| P[lib/proxy.js]
    P -->|GET m3u8 + segmentos (misma IP del token)| I[(fubo18.com / tudeporteshoy.xyz)]
    I -->|m3u8 + .ts| P
    P -->|m3u8 reescrito + segmentos| A
```

## Capas

1. **Fuentes de datos**
   - `alangulotv.si/agenda.php` — HTML con la agenda del día. Cada evento es un
     `<li class="XX">` con título, hora (`<span class="t">`) y canales
     (`<li class="subitem1/2">`). Cada canal tiene `/eventos.html?r=<BASE64>`.
   - `futbollibretv.sx/eventos.js` — archivo JS con `const EVENTOS_DATA = [...]` en el
     mismo formato (`clase`, `titulo`, `hora`, `canales`). Los enlaces también son
     `/eventos.html?r=<BASE64>`.
   - `agenda18.com/agenda.json` — JSON estilo Strapi compartido por futbollibre.mx y
     rojadirectaa.net. Eventos con `diary_hour`, `diary_description`, `deportes`,
     `embeds` (iframe con `r=<BASE64>`) y `country` (con bandera). Se descartan los
     embeds de `tarjetarojita.xyz`/`proveseat` (DRM cifrado) y `la10tv.com` (DRM).

2. **Scraper — `lib/scraper.js`**
   - Descarga las tres fuentes en paralelo (`Promise.allSettled`, si una falla no
     tumba al resto) y las fusiona con `mergeEvents()`.
   - `mergeEvents()` deduplica por **título normalizado** (sin acentos, mayúsculas ni
     guiones) y combina los enlaces del mismo partido (`mergeStreams`).
   - `sortStreams()` ordena los enlaces de cada evento por **prioridad de proveedor**
     (`PROVIDER_PRIORITY`): `la18hd.su` primero, luego `fubo18.com`,
     `tudeporteshoy.xyz`, `streamtp-golden1.click`, `streamx488.sbs`; los hosts
     desconocidos al final. Prefiere `720p/1080p` y `Español`.
   - `titleToId()` / `idToTitle()` convierten el título en un `id` estable
     (`metegol:<base64url>`), de modo que el stream no se rompe entre refrescos del
     catálogo (el token no entra en el id).
   - `classify()` mapea la clase del `<li>` (ES, AR, IT, UFC...) a un deporte con emoji.

3. **Scrapers específicos**
   - `lib/scraper-futbollibre.js` — extrae el array `EVENTOS_DATA` del JS (regex sobre
     el literal JSON) y decodifica los `r`.
   - `lib/scraper-agenda18.js` — parsea el JSON de Strapi, convierte la hora de
     `America/Lima` (UTC-5) a hora local y agrega la bandera de país
     (`img.agenda18.com/uploads/...`).

4. **Portadas — `lib/teamlogos.js`**
   - `parseTeams()` extrae hasta dos equipos del título (tras el primer `:` y separados
     por `vs`/`-`/`@`).
   - `searchTeam()` consulta **TheSportsDB** (`/api/v1/json/3/searchteams.php?t=`), con
     caché en memoria (TTL 6 h) para respetar el rate-limit.
   - `eventPoster()` compone un **SVG** con los escudos de ambos equipos; si no hay
     escudos, cae a un póster SVG con el emoji del deporte.

5. **Extractor — `lib/extractor.js`**
   - Consulta el endpoint del tercero con headers de navegador (y `Referer`).
   - `extractPlaybackUrl()` busca la variable `playbackURL` (tolera barras escapadas)
     y, como fallback, el **formato ofuscado** (`kv`/`jY` = pares `[idx, base64]` con
     clave `k = fnA()+fnB()`, ver `extractObfuscatedPlaybackUrl`) o la primera URL
     `.m3u8` del HTML.
   - Devuelve el `.m3u8` real.

6. **Proxy HLS — `lib/proxy.js`**
   - **Motivo:** los proveedores generan tokens **ligados a la IP del fetch**. En
     serverless el fetch sale con IP de datacenter, y el reproductor (IP del usuario)
     no coincide → el proveedor responde 403. El proxy resuelve esto haciendo que
     TODOS los requests (m3u8 y segmentos) salgan desde la misma IP que generó el token.
   - `GET /proxy?url=<m3u8|.ts>` descarga el recurso desde la IP del servidor y:
     - Si es una playlist (`#EXTM3U`), reescribe cada segmento/variante/`URI=` para que
       también pase por `/proxy` (`rewritePlaylist()`).
     - Si es un segmento `.ts`, lo sirve tal cual (`video/mp2t`).
   - En `defineStreamHandler` el m3u8 se devuelve envuelto en la URL del proxy cuando
     hay `PUBLIC_BASE_URL` (deploy); en local se devuelve directo.

7. **Addon — `addon.js`**
   - `addonBuilder(manifest)` declara recursos `catalog` + `meta` + `stream`, tipo `tv`.
   - `defineCatalogHandler` → `metas` (uno por evento) con **portada de equipos**.
   - `defineMetaHandler` → devuelve la meta del evento (necesario para que Stremio
     trate el ítem como canal de TV jugable).
   - `defineStreamHandler` → por cada enlace del evento, extrae el m3u8 en paralelo y
     lo devuelve como stream (a través del proxy si corresponde).
   - `createApp()` monta Express + la ruta `/proxy` + el **router** (`getRouter`) para
     serverless. Si se ejecuta `node addon.js`, usa `serveHTTP` para el servidor local.

## Modelo de datos de un evento

```js
{
  title:   'Primera División: Deportes Limache vs Universidad Chile',
  time:    '22:30',
  sport:   'Chile',
  emoji:   '🇨🇱',
  flagUrl: 'https://img.agenda18.com/uploads/chile_86c07a7b38.png', // solo agenda18
  streams: [
    { source: 'A18', label: 'TNT Sports Premium CL · Español', url: 'https://la18hd.su/vivo/canal.php?stream=tntsportschile' },
    { source: 'OP1', label: 'TNT Sports Premium Calidad 720p', url: 'https://streamx488.sbs/global1.php?channel=tntsportscl' }
  ]
}
```

## Clave técnica: tokens efímeros

Los `.m3u8` de los servidores de terceros llevan un `?token=...` que **expira en
pocos minutos** (los timestamps embebidos en la propia URL marcan inicio/fin de
validez). Por eso:

- El fetch al endpoint de 3º y la extracción del m3u8 ocurren **dentro de
  `defineStreamHandler`**, en el instante en que el usuario abre el evento.
- **No se cachea** el m3u8; cada solicitud de stream obtiene una URL nueva.
- El `id` del evento usa solo el título (sin token), para que el catálogo y el stream
  coincidan aunque pase el tiempo.

## Despliegue serverless (Vercel)

- `api/index.js` importa `createApp()` y la exporta como handler de Vercel.
- `vercel.json` enruta todo el tráfico (`/(.*)`) a `api/index.js` y define
  `PUBLIC_BASE_URL` (la URL pública del addon).
- **Clave:** en Vercel los tokens quedan ligados a la IP del datacenter, por eso el
  `defineStreamHandler` devuelve el m3u8 **envuelto en `/proxy`** (`lib/proxy.js`), que
  descarga m3u8 y segmentos desde la misma IP del token y los reescribe para el
  reproductor. Sin el proxy, el TV recibiría 403 (IP distinta a la del token).
- Consideraciones de Vercel: cada segmento `.ts` es una request de la función
  serverless; el plan Hobby permite respuestas de streaming y tiene un límite de
  ancho de banda (100 GB/mes) y de requests. Para uso personal alcanza.