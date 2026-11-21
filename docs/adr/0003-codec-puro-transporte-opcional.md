# ADR-0003: Codec puro; transporte MIDI como extra opcional

**Estado:** Aceptada (2026-11-21). Codec desbloqueado por M0 (ver [ADR-0005](0005-formato-seq-cola-de-notas.md)); transporte sigue bloqueado (falta TD-3 por USB).

## Contexto

El formato SysEx / `.seq` del TD-3 no tiene especificación oficial; solo existe documentación por ingeniería inversa de la comunidad. Escribirlo de memoria produciría bytes que podrían corromper o no ser aceptados por el equipo. Además, `python-rtmidi` puede no compilar en Termux, y los tests no deben depender de hardware.

## Decisión

1. **Codec puro:** funciones `bytes <-> modelo` sin I/O, testeables con fixtures.
2. **Transporte separado:** el envío por USB (`mido` / `python-rtmidi`) vive detrás del extra opcional `[midi]`. El núcleo no lo importa.
3. **Codec condicionado a bytes reales (M0):** no se escribe hasta tener bytes reales del TD-3 (dump por USB o un `.seq` exportado desde SynthTribe). Esos bytes son la fuente de verdad y las fixtures de los tests.

## Alternativas descartadas

- **Codec escrito de memoria o desde notas de terceros sin verificar:** riesgo de datos inválidos, sin forma de probarlos.
- **`mido`/`rtmidi` como dependencia obligatoria:** rompe la instalación en Termux y los tests sin hardware.
- **Transporte mezclado con el codec:** impide testear el codec sin dispositivo.

## Consecuencias

- M2 (codec) se desbloqueó con los 3 `.seq` reales de M0, que son las fixtures (ver ADR-0005). El SysEx está implementado pero sin verificar en hardware.
- M3 (transporte) sigue bloqueado: falta un TD-3 conectado por USB.
- El extra `[midi]` está reservado en `pyproject.toml`, sin código.
- La pregunta abierta de la C aguda quedó resuelta (ver ADR-0004).
