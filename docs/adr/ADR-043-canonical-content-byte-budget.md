# ADR-043 — Orçamento canônico de conteúdo

Status: aceita como correção do contrato de 8 MiB, sem ampliar capacidade.
O validador TypeScript mede UTF-8 de `JSON.stringify`; `jsonb::text` acrescenta espaços estruturais.
Uma projeção válida de 5.000 blocos mediu 8.315.065 bytes compactos e 8.420.073 bytes no PostgreSQL.
A migration 012 compartilha `private.compact_json_bytes` entre persistência e projeção pública.
A expressão regular preserva cada literal JSON completo, inclusive escapes e espaços autorais, removendo apenas whitespace entre tokens.
O limite permanece 8.388.608 bytes; snapshots, updates, ACL, CAS, recibos e orçamento público sanitizado são preservados.
pgTAP prova a regressão, UTF-8/escapes, aceitação no limite, rejeição de um byte excedente e privilégios inalterados.
