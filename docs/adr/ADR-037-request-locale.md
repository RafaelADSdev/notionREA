# ADR-037 — Idioma por requisição e contexto React
Status: decisão reversível da ADR-008; data: 26/10/2026.
Decisão: pt-BR padrão e en selecionável por cookie validado; leitura no servidor por requisição, sem locale global mutável.
Cliente: LocaleProvider e useTranslations compartilham a preferência com componentes; consumidores sem provider conservam pt-BR.
Catálogo: IDs técnicos em inglês, pares pt-BR/en tipados, interpolação textual e prova de paridade dos parâmetros.
Servidor: getTranslations lê a preferência da requisição; ações e respostas usam o mesmo catálogo e não inferem o idioma pelo conteúdo do usuário.
Formatação: Intl recebe o locale da interface; dia civil conserva sua data, enquanto instantes usam fuso explícito quando necessário.
Alternativa: substituição de texto no DOM é excluída; biblioteca adicional não é necessária para os dois idiomas e o roteamento existente.
Consequência: locale não altera IDs, valores canônicos ou autorização; tradução amplia-se às superfícies entregues sem mudar a linguagem dos contratos técnicos.
