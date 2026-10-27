# ADR-041 — Entrega de conteúdo no ambiente serverless

- Estado: adotada; decisão operacional reversível do M6.
- Next roda no runtime Node 24 da Vercel; validação Yjs usa worker empacotado no tracing de documentos, databases e intercâmbio.
- Anexos privados continuam no Supabase Storage; uploads usam capacidade restrita e downloads exigem autorização atual.
- Downloads devolvem `ReadableStream` sem `Content-Length`, em blocos de 256 KiB, inclusive acima do limite de resposta bufferizada da plataforma.
- Publicação de conteúdo longo usa manifesto/chunks autorizados da migration 011; exportações são jobs retomáveis com partes privadas.
- Limite global de Storage: 50 MiB para ZIP; bucket de anexos mantém 25 MiB. Não aumentar o payload permitido no servidor Next.
- Implantação remota requer smoke de streaming, worker, autenticação e revogação; provas locais não comprovam o ambiente hospedado.
- Fonte: [limite e streaming na Vercel](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).
