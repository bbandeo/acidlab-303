# ADR-0002: El agente genera las variaciones; Python solo valida y compila

**Estado:** Aceptada (2026-11-21)

## Contexto

El requisito pide 4 variaciones (A/B/C/D) a partir de una intención musical. La arquitectura en 3 capas establece que los agentes nunca manipulan bytes crudos: deciden, y el código determinista ejecuta.

## Decisión

El agente (skill de Claude Code) escribe las 4 variaciones completas en un `bank.json` (Bank v1). Python no inventa música: valida el JSON contra el contrato y, cuando exista el codec, lo compila. Las variaciones B/C/D son relacionadas con A pero las decide el agente.

## Alternativas descartadas

- **Motor determinista de mutaciones** (derivar B/C/D de A con reglas en Python): YAGNI. Nadie lo pidió, exige definir reglas musicales que hoy serían inventadas, y el agente ya cubre esa variedad. Se reconsidera si aparece la necesidad de reproducibilidad o de mutar bancos existentes.

## Consecuencias

- El código Python es chico: modelo, validación, schema y CLI.
- La calidad musical depende de la skill y del agente, no de tests.
- La validación es solo estructural; no se imponen reglas musicales.
- Un error del agente se detecta en `td3 validate` y se corrige reescribiendo el JSON.
