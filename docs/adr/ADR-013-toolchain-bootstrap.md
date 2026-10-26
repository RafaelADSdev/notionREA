# ADR-013 — Bootstrap e segurança da toolchain

Status: decisão operacional reversível; data: 26/10/2026.
Contexto: Node instalado 24.21.0; wrapper pnpm do ambiente usa 24.19.0, ambos LTS 24; peers de plugins Next ainda exigem ESLint 9.
Decisão: recomendar 24.21.0 em .node-version e aceitar >=24.19.0 <25; pacotes com versões exatas e instalação sem scripts de dependências, negados por padrão.
Tooling: Next 16.4.3, React 19.3.1, TypeScript 6.0.3 (ADR-014), TipTap 3.32.0, Yjs 13.6.33, Vitest 5.0.5 e CLI Supabase 2.122.0; peers estritos permanecem habilitados.
Lint: Biome 2.6.3 mantido é o gate principal (React/Next/a11y); ESLint 9.39.5 roda adicionalmente preservando regras Next legadas, pois plugins ainda recusam 10; risco limitado à toolchain de desenvolvimento, revisão obrigatória no M6.
Alternativas: não desabilitar checagem de peers nem remover regras para fazer instalação/lint passar; avaliar conjunto de lint mantido compatível antes da entrega.
Consequência: lockfile preserva o experimento; auditoria e reprodução frozen serão gates, sem aprovação ampla de postinstall ou alteração da instalação global.
