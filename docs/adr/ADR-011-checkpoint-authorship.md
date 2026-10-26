# ADR-011 — Autoria técnica dos commits locais

Status: decisão operacional reversível; data: 26/10/2026.
Contexto: o usuário autorizou commit ao fechar cada marco; não há user.name/user.email configurados no Git desta máquina; escolha aplicada ao Checkpoint 1 e mantida no M1.
Decisão: usar autoria técnica explícita Codex <codex@localhost> somente na invocação do commit local de marco, sem inventar identidade pessoal ou alterar configuração global/local persistente.
Alternativa: interromper a entrega apenas por metadado reversível contraria a autonomia pedida para decisões pequenas.
Consequência: a autoria técnica fica auditável; usar a identidade que o usuário configurar quando disponível, sem substituir configuração existente.
Limite: nenhuma conta GitHub foi acessada e não haverá push, assinatura em nome do usuário ou atribuição de e-mail pessoal.
