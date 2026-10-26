# Investigação REA — referência comportamental

Data: 26/10/2026. Alvo autorizado: instalação desktop do Notion no Windows, versão informada pelo executável 7.12.0. Método: skill REA versão 41, em `C:\Users\Usuario\Skills\reverse-engineer-anything\SKILL.md`.

## Contrato de investigação

Entender capacidades e produzir linguagem natural. Nenhum código, símbolo interno, asset, fonte, texto de interface ou estilo recuperado integra estes documentos. Hashes e IDs de evidência abaixo são proveniência da investigação, não identificadores de implementação. Não houve operação de UI, execução do alvo, captura de rede, acesso a API privada ou leitura de perfil/conta/cache/sessão. O pacote instalado permaneceu intacto. Não houve extração ou exportação do grafo de código para este repositório.

A REA não define um modelo obrigatório de relatório Markdown para esta investigação. Aplicamos seu livro de achados: pergunta, evidência, autoridade, confiança, limite e questão residual. O resultado é dividido entre [evidências](evidence-ledger.md), [fontes públicas](public-sources.md), [inventário](feature-inventory.md), [fluxos](ux-flows.md), [modelo](conceptual-model.md) e [lacunas/priorização](gaps-risks-priorities.md).

## Separação de autoridade

| Marca | Significado | Uso permitido |
| --- | --- | --- |
| O | Observação estática REA ou metadado local | Somente o fato delimitado pela evidência |
| P | Comportamento descrito em documentação pública oficial | Referência funcional, sem afirmar execução local |
| I | Inferência do analista | Hipótese explicitamente limitada, nunca fato observado |
| D | Decisão original do Bloco ou requisito do usuário | Contrato de implementação em `docs/spec/` |
| U | Não estabelecido nas evidências disponíveis | Preservar lacuna ou obter captura fornecida pelo usuário |

## Resultado da checklist de perguntas

| Pergunta | Resultado | Limitação |
| --- | --- | --- |
| Qual artefato foi examinado? | Respondida por O-01 a O-03 | Busca de instalação limitada aos caminhos padrão e App Paths |
| O pacote é integralmente verificável? | Parcial: seis contradições registradas | Causa desconhecida; arquivos divergentes não confiáveis |
| O que a análise estática comprova? | Parcial: empacotamento e estruturas de aplicação desktop | Cobertura semântica parcial; não comprova UX |
| Quais blocos e operações compõem a referência? | Respondida documentalmente, P | Sem demonstração local |
| Como funcionam páginas, bases, views e propriedades? | Respondida documentalmente, P | API pública não revela armazenamento interno |
| Como funcionam seleção, drag, slash e undo? | Parcial: P, contrato original D | IME, conflitos e detalhes visuais locais permanecem U |
| Como funcionam busca, compartilhamento, lixeira e templates? | Respondida documentalmente no nível necessário ao contrato | Planos, políticas administrativas e versão podem variar |
| Como serão colaboração, dados e identidade do Bloco? | Especificados como D | Dependem de aprovação e provas dos marcos |

Esta fase entrega uma especificação implementável, com evidência pública e decisões próprias. **Não entrega uma validação completa dos fluxos do Notion instalado.** Não é necessário reabrir o artefato para implementar o escopo proposto; comportamentos sem comprovação foram assumidos como decisões do produto, explicitadas nos contratos. Eventual exigência de paridade exata nesses pontos depende de capturas fornecidas pelo usuário.
