# ADR-010 — Semântica de databases

Status: aceita no Checkpoint 1; data: 26/10/2026.
Contexto: propriedades dinâmicas, cinco views, filtros combinados e edição simultânea sem sobrescrita silenciosa.
Decisão: um schema por base; título na página, valores tipados relacionais, relações explícitas no mesmo workspace e views como configurações.
Consultas: AST validada de filtros AND/OR, operadores por tipo, máximo cinco níveis/cinquenta condições; SQL parametrizado e paginação por cursor.
Concorrência: revisão por célula para valores, por entidade para schema/view; mudanças incompatíveis exigem prévia, não conversão destrutiva automática.
Apresentação: board por select/checkbox; conjuntos podem repetir entidade em grupos de views compatíveis; calendário por data; nulos por último e empate de ID.
Alternativas: JSON opaco de toda a base dificulta índices/constraints; filtro visual não substitui autorização e não é compartilhamento seguro.
Contrato e provas: [databases](../spec/databases.md); mesmas entidades nas cinco views, templates com IDs novos e testes de nulos/tipos/isolamento.
