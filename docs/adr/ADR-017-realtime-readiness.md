# ADR-017 — Prontidão e metadados do Realtime
Status: decisão reversível de integração; data: 26/10/2026.
Contexto: SUBSCRIBED confirma o canal, mas o primeiro aviso pode preceder a inicialização da replicação após reset.
Decisão: provas de entrega aguardam broadcast.replication_ready e evento system de conexão pronta antes do commit que medem.
Metadados: o Bloco envia somente revisão; realtime.send acrescenta id UUID de transporte, aceito explicitamente sem abrir espaço a conteúdo no evento.
Durabilidade: ACK depende da transação Postgres; perda de aviso continua recuperável por leitura autorizada/catch-up, nunca por confiar no socket.
Consequência: provider M5 deve distinguir conexão do canal/prontidão, repetir handshake com limite e manter reconciliação durável independentemente de eventos.
Prova: teste real autentica conta sintética, recebe revisão por canal privado e revoga leitura de snapshot/log mantendo esse canal aberto.
Fonte: [protocolo oficial Supabase](https://supabase.com/docs/guides/realtime/protocol), função pública da stack local e SDK fixados; nenhum protocolo privado da referência.
