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

Para Android/TV no sirve `localhost` (es otro dispositivo); ahí necesitás HTTPS
público (ver sección 3).

## 2. Probar sin levantar el servidor

`test.js` valida el scraping, el merge de fuentes y la extracción de streams sin el
servidor HTTP:

```bash
npm test
```

Muestra los eventos del día (fusionados de las 3 fuentes) y el primer `.m3u8` obtenido.

## 3. Despliegue público (HTTPS obligatorio)

Stremio exige HTTPS para cualquier addon que no sea `127.0.0.1`. Opciones:

### a) Vercel (URL fija recomendada)

El proyecto ya incluye `vercel.json` y `api/index.js` para deploy serverless:

```bash
npx vercel login          # una sola vez
npm run vercel:deploy     # despliega a producción
```

Instalás en Stremio la URL que te da Vercel:
`https://<tu-proyecto>.vercel.app/manifest.json`

> Nota: en Vercel las funciones salen con IP de datacenter. Si un proveedor de
> streaming validara la IP del cliente en su token, algunos enlaces podrían fallar;
> con los proveedores actuales el token embebe la IP de quien hace el fetch, así que
> suele funcionar.

### b) Netlify (alternativa)

Como la app es un router Express, podés crear un handler de Netlify Functions
(`netlify/functions/server.js`) que exporte la misma `createApp()`. No está
configurado en el repo.

### c) Hostings Node.js

Railway / Fly.io / Render / etc. Desplegás el repo; el addon escucha en la variable
de entorno `PORT`. La URL del addon será `https://<tu-dominio>/manifest.json`.

### d) Tunnel local (solo para probar desde otro dispositivo)

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