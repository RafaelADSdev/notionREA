# Dependências públicas e licenças

A implementação usa pacotes públicos fixados em `package.json` e `pnpm-lock.yaml`. Esta relação descreve proveniência; resultados de gates e progresso ficam exclusivamente no PLAN. Nenhum pacote, código ou asset foi recuperado da instalação de referência.

| Grupo | Pacotes diretos | Licença declarada |
| --- | --- | --- |
| Framework | Next.js, React e React DOM | MIT |
| Backend cliente/SSR | Supabase JS e SSR | MIT |
| Editor | TipTap core, StarterKit, PM, Collaboration, Table, UniqueID e y-tiptap | MIT |
| CRDT | Yjs | MIT |
| Arraste acessível | dnd-kit React e DOM | MIT |
| Validação | Zod | MIT |
| Estilos | Tailwind CSS | MIT |

As versões exatas estão no manifesto/lockfile; evitar duplicá-las em outra fonte editável. [TipTap](https://github.com/ueberdosis/tiptap/blob/main/LICENSE.md), [Yjs](https://github.com/yjs/yjs/blob/main/LICENSE), [Supabase JS](https://github.com/supabase/supabase-js/blob/master/LICENSE) e [Next.js](https://github.com/vercel/next.js/blob/canary/license.md) publicam suas licenças. Nenhuma extensão comercial do editor foi instalada.

`pnpm licenses list --prod --json` consulta os metadados instalados e pode variar nos opcionais nativos de cada plataforma. Além de MIT/Apache-2.0/ISC/BSD, o inventário Windows inclui `caniuse-lite` (dados CC-BY-4.0) e `@img/sharp-win32-x64` (Apache-2.0 AND LGPL-3.0-or-later). O segundo é dependência nativa transitiva de imagem do Next; não é uma extensão proprietária do editor. Consulte os avisos nos próprios pacotes e [Sharp](https://sharp.pixelplumbing.com/install/).

Preservar licenças/avisos e a identificação dos componentes de terceiros ao empacotar. A preparação de deploy deve revisar também os opcionais Linux e os arquivos de licença presentes no artefato final; este repositório não distribui `node_modules` nem os binários nativos. Não inferir a licença de todo o grafo pela licença de um pacote raiz.

O patch em `patches/` ajusta exclusivamente uma declaração de tipos do SDK público Supabase Auth MIT; não muda execução. Sua razão e condição de remoção estão na ADR-014. Atualizações de dependências exigem repetir instalação frozen, auditoria, inventário de licenças e gates pertinentes.
