# ADR-029 — Finalização delimitada de arquivos de bloco
Status: extensão reversível da ADR-020; data: 26/10/2026.
Decisão: imagem e anexo reutilizam upload privado assinado, finalização autorizada e download com ACL atual da página.
Imagem: aceitar PNG/JPEG/GIF/WebP com estrutura e dimensões verificadas, até 16.384 px por eixo e 30 milhões de pixels.
Anexo: armazenar como binário e forçar download com nosniff, sem executar ou renderizar HTML/SVG inline.
Recursos: dois validadores ativos e oito aguardando por instância; reservar antes do download em quota durável de 30 tentativas por ator/workspace a cada dez minutos.
Retry: arquivo já confirmado revalida ACL e metadados, preservando a idempotência sem repetir o download; capa e mídia de bloco são vínculos independentes.
Limite: inspeção estrutural não equivale à decodificação integral de pixels; limites do arquivo e de dimensões continuam obrigatórios.
Provas: pgTAP de isolamento/quotas e integrações de Storage, assinaturas conflitantes e frames de imagem excedentes.
