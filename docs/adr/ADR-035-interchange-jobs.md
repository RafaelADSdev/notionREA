# ADR-035 — Intercâmbio por jobs privados retomáveis
Status: decisão reversível autorizada durante M6; data: 26/10/2026.
Fonte ZIP privada, digest SHA-256 e inventário precedem a prévia; confirmar é condição para criar páginas, bases ou arquivos definitivos.
A extração inicial pode percorrer 250 MiB em streaming, com contagem/CRC reais, prazo de execução e chunks privados; não materializa toda a expansão em memória.
Importação, validação de CSV e persistência avançam em lotes com cursores/recibos duráveis e autorização renovada; retry não duplica identidades já aceitas.
Markdown é tokenizado como dados e convertido ao schema permitido; HTML não é executado e conteúdo não representável recebe aviso explícito.
ZIP exportado combina partes privadas, Markdown/CSV e anexos autorizados; cada download revalida o escopo atual, sem URL pública permanente.
Limites mantidos: fonte 50 MiB, expansão 250 MiB, 10.000 entradas e razão 100:1; página acima de 8 MiB é erro de prévia, sem truncamento.
Dependências fixas: yauzl 3.4.0, marked 18.1.1; scripts negados e quarentena de releases preservada.
Fontes: [yauzl](https://github.com/thejoshwolfe/yauzl), [Marked](https://marked.js.org/) e [contrato](../spec/interchange-quality.md).
