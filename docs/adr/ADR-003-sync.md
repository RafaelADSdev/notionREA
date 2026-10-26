# ADR-003 — Sincronização sem servidor persistente próprio

Status: aceita no Checkpoint 1; data: 26/10/2026.
Contexto: Vercel e Supabase apenas; Broadcast não substitui log durável e sua autorização pode permanecer em cache.
Decisão: provider próprio Yjs; endpoint validado persiste delta idempotente, revisão e projeções por CAS antes de ACK.
Distribuição: Realtime privado sinaliza revisão sem texto; leitura de deltas sempre reautoriza; Presence usa capacidade/canal separados.
Reconexão: snapshot/watermark, catch-up, vetor de estado e sondagem recuperam mensagens ausentes; compactação preserva checkpoint consistente.
Alternativas: WebSocket próprio/Tiptap Cloud excluídos pela infraestrutura; substituir JSON inteiro ou confiar só em Broadcast viola durabilidade.
Gate: provar repetição, queda, compactação, conflito de revisão e revogação com canal aberto em M1/M5.
Fontes e protocolo: [arquitetura](../spec/architecture.md), [provider Yjs](https://docs.yjs.dev/tutorials/creating-a-custom-provider), [autorização](https://supabase.com/docs/guides/realtime/authorization).
