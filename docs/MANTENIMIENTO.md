# Mantenimiento

El addon depende de varias capas externas que **no están bajo nuestro control**. Cuando
deje de funcionar, seguí esta guía para diagnosticar y arreglar.

## Capas involucradas

| Capa | Ejemplo | Riesgo |
|------|---------|--------|
| Origen de la agenda | `alangulotv.si/agenda.php`, `futbollibretv.sx/eventos.js`, `agenda18.com/agenda.json` | Cambian estructura o caen |
| Endpoint de reproducción | `la18hd.su`, `streamtp-golden1.click`, `streamx488.sbs` | Caen, cambian de dominio, anti-hotlink |
| Host del m3u8 | `fubo18.com`, `tudeporteshoy.xyz` | Tokens efímeros, bloqueos por IP |
| Portadas | `thesportsdb.com` | Rate-limit, cambio de API |

## Síntomas y diagnóstico

### A. El catálogo aparece vacío
- Posible: cambiaron las fuentes de agenda.
- Probar: `npm test` → si muestra `Eventos encontrados: 0`, inspeccioná cada fuente:
  - `curl -A "Mozilla/5.0" https://alangulotv.si/agenda.php` y revisá `parseAgenda()`.
  - `curl -A "Mozilla/5.0" https://futbollibretv.sx/eventos.js` y revisá el regex de
    `EVENTOS_DATA` en `lib/scraper-futbollibre.js`.
  - `curl -A "Mozilla/5.0" https://agenda18.com/agenda.json?v=1.1` y revisá
    `parseAgendaJson()` en `lib/scraper-agenda18.js` (estructura Strapi).
- Si solo una fuente falla, las otras siguen alimentando el catálogo (uso de
  `Promise.allSettled`).

### B. El catálogo carga pero los streams no reproducen
- Posible 1: el endpoint de 3º cambió el nombre de la variable del m3u8.
  - Probar: abrir en el navegador la URL decodificada del `r` y buscar `playbackURL`.
  - Si ahora usa otro nombre (ej. `sourceUrl`) o cambió el formato ofuscado
    (`kv`/`jY`), actualizá los regex en `lib/extractor.js`.
- Posible 2: anti-hotlink / referer. Algunos endpoints devuelven un HTML distinto o
  redirigen si no viene el `Referer` adecuado. En `lib/extractor.js` se envía
  `Referer` alagulotv; para `la18hd.su` conviene `https://agenda18.com/`. Si un host
  nuevo lo exige, ajustá el referer por dominio.
- Posible 3: el dominio del m3u8 bloquea la IP del servidor (datacenter). En Vercel la
  IP es de un datacenter. El addon ya sirve los streams a través de `/proxy`
  (`lib/proxy.js`), que descarga m3u8 y segmentos desde la misma IP del token, así que
  el reproductor siempre coincide. Si un proveedor nuevo bloqueara la IP del datacenter
  por completo (no solo el token), no hay fix salvo cambiar de hosting.
- Posible 4: **DRM**. Los embeds de `tarjetarojita.xyz`/`proveseat.net` y `la10tv.com`
  usan cifrado/DRM y ya se descartan en `lib/scraper-agenda18.js`. Si aparece un
  proveedor nuevo con `_econfig`, `license` o `.mpd`, descartalo igual.

### C. "token expired" / el m3u8 devuelve 403
- Esperado si el m3u8 se reutilizó tras unos minutos. El addon ya genera el token en
  el momento del `stream`, así que no debería pasar salvo que el servidor de 3º tenga
  un reloj desincronizado. No cachear los `url` de stream.
- En fuentes tipo `canal.php` (la18hd/streamtp), los segmentos de fubo18 expiran en
  **~2 s** y la página **rota nodos CDN** (`bmf0aw9u` / `b2ZmaWNpYWw`) con ventanas de
  segmentos distintas. Por eso el proxy reescribe por **índice** (`idx`) y, si la URL
  directa falla, **re-extrae la playlist fresca dentro de la misma invocación** (misma
  IP = token válido). Si un segmento sigue dando 404, es que el índice quedó viejo; el
  proxy ya camina hacia atrás desde el segmento más nuevo.

### C2. Los posters salen "de cabeza" o viejos (texto girado 180°)
- El texto del poster se genera al derecho desde el servidor (verifique
  `/poster/:id.png` en el navegador). Si en Stremio sigue saliendo girado o antiguo,
  es **caché**: tanto Stremio como la CDN (`s-maxage=1800`, ~30 min) cachean las
  imágenes. Desinstalá los addons viejos (cada `id` tiene su propia caché), instalá el
  actual y esperá ~30 min o reiniciá Stremio.
- Si hay que forzar limpieza global: cambiar el `id` del addon en `manifest.js`
  (ej. `com.metegol.live.v5` → `v6`) invalida toda la caché de Stremio (addon nuevo),
  aunque la CDN tarda hasta ~30 min en refrescarse.

### D. Las portadas no muestran escudos
- TheSportsDB tiene rate-limit (~30 req/min). El addon cachea resultados en memoria
  (TTL 6 h), pero en el primer arranque puede tardar. Sin escudo, el poster igual
  muestra el **deporte arriba y los nombres de los equipos abajo** (texto normalizado,
  sin tildes). El texto grande centrado del deporte solo aparece si no se pudo extraer
  ningún nombre de equipo del título.

## Checklist periódico

- [ ] `npm test` devuelve eventos y al menos un m3u8 válido.
- [ ] El primer evento reproduce en Stremio.
- [ ] Las tres fuentes de agenda devuelven datos (verificar en catálogo).
- [ ] Los endpoints de 3º conocidos siguen activos (ver abajo).

## Dominios conocidos (a agosto 2026)

- Origen de agenda: `alangulotv.si`, `futbollibretv.sx`, `agenda18.com`, `img.agenda18.com`
- Endpoints de reproducción: `la18hd.su/vivo/canales.php`, `streamtp-golden1.click/global1.php`,
  `streamx488.sbs/global1.php`
- Hosts m3u8: `*.fubo18.com`, `*.tudeporteshoy.xyz`
- Descartados (DRM/cifrado): `tarjetarojita.xyz` (`proveseat.net`), `la10tv.com`
- Portadas: `thesportsdb.com` (API v1, key de test `3`)

> Si alguno desaparece, el addon seguirá funcionando para los demás; solo hay que
> actualizar los patrones del extractor si cambian la forma de exponer el m3u8.

## Prioridad de proveedores

`PROVIDER_PRIORITY` en `lib/scraper.js` ordena los streams por estabilidad. Si un
proveedor empieza a fallar seguido, subí su número (mayor = va después):

```js
const PROVIDER_PRIORITY = {
  'la18hd.su': 1,            // más estable, primero
  'fubo18.com': 2,
  'tudeporteshoy.xyz': 3,
  'streamtp-golden1.click': 4,
  'streamx488.sbs': 5        // menos estable, al final
}
```

## Actualizar el addon

```bash
git pull        # o editar archivos
npm install     # si cambian dependencias
npm start
```

Para Vercel, cada `npm run vercel:deploy` publica la última versión.