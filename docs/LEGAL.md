# Consideraciones legales y de uso

## Qué es este addon

MeteGol es una herramienta técnica que **enlaza** contenido de terceros. No aloja,
reproduce ni distribuye ningún stream por sí mismo: solo obtiene, en el momento de la
reproducción, la URL HLS (`.m3u8`) que publican otros sitios y se la pasa a Stremio.

## Contenido

Los streams provienen de servicios que re-emiten canales de pago sin autorización
(ESPN, Fox Sports, TNT Sports, Disney+, Liga 1 Max, UFC, etc.). En la mayoría de las
jurisdicciones acceder o facilitar el acceso a este contenido constituye una
infracción de derechos de autor y/o de los términos de dichos servicios.

## Recomendaciones

1. **Uso personal y privado.** El addon está pensado para probar la viabilidad
   técnica en tu propio Stremio (`localhost`). No lo publiques ni lo compartas
   públicamente.
2. **No uses `publishToCentral`** salvo que asumas las consecuencias de exponer el
   addon a terceros. El README y `INSTALACION.md` explican cómo hacerlo, pero queda a
   tu criterio y responsabilidad.
3. **Evitá renderizar las páginas de terceros.** El addon solo hace peticiones HTTP y
   extrae el `.m3u8` con regex; nunca carga los iframes ni los scripts de publicidad
   (pop-unders, `aclib`, etc.) que esos sitios inyectan.
4. **Cumple la legislación local.** El responsable del uso es quien ejecuta el addon.

## Responsabilidad

El autor de este repositorio no se hace responsable del uso que se le dé ni de la
disponibilidad, legalidad o seguridad de los servicios de terceros a los que apunta.
