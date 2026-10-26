# ADR-014 — Compatibilidade estrita de tipos públicos do SDK

Status: decisão reversível de compatibilidade; data: 26/10/2026.
Contexto: Next 16.4 exige tipos DOM do TypeScript 6; Supabase Auth 2.118 redeclara toJSON incompatível com a interface nativa mais recente.
Decisão: TypeScript 6.0.3 e patch versionado mínimo no tipo PublicKeyCredentialFuture do SDK público, compondo StrictOmit<PublicKeyCredential,'toJSON'> com a assinatura JSON própria que o SDK já declara.
Escopo: uma declaração em fonte e seus dois artefatos .d.ts; nenhum código de execução, mecanismo de autenticação ou parâmetro de validação alterado.
Alternativas recusadas: skipLibCheck, ts-ignore, casts any, desativar exactOptionalPropertyTypes ou retornar a framework fora da manutenção para contornar erro.
Consequência: manter strict e checagem integral de bibliotecas; frozen install deve reaplicar o patch e typecheck validar sua necessidade.
Manutenção: revisar na próxima atualização auth-js; retirar quando o upstream corrigir composição de tipos; passkeys não são feature do MVP.
Fonte: dependência pública MIT @supabase/auth-js 2.118.0; incompatibilidade Next/TS6 também documentada no [repositório oficial](https://github.com/vercel/next.js/issues/99631).
