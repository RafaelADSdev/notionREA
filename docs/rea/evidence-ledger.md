# Livro de evidências sanitizado

## Identidade e limites

Alvo: `C:\Users\Usuario\AppData\Local\Programs\Notion\resources\app.asar`, 8.343.290 bytes. SHA-256: `f1e1e42ffae7cea6c9ba3be5e783942737bdfb9cd15038822e6a378d25e3987a`. Versão do executável adjacente: 7.12.0. Data de observação: 26/10/2026.

Os IDs REA identificam registros retidos na sessão da ferramenta. Não se presume que continuem consultáveis em uma sessão futura. Este registro preserva fatos e limitações em linguagem natural; deliberadamente não guarda o bundle bruto, fontes ou inventário de símbolos. Auditoria futura deve respeitar o escopo autorizado e o clean-room; não autoriza reabrir código para implementar o contrato já escrito.

| Achado | Evidência / autoridade | Conclusão permitida | Confiança e limite |
| --- | --- | --- | --- |
| O-01 | Inspeção de diretório e metadados do executável | Uma instalação candidata foi encontrada nos caminhos padrão verificados e App Paths | Observado; não é busca exaustiva de todos os discos |
| O-02 | `open_binary`, identidade SHA-256 acima | O alvo aberto é um arquivo reconhecido como ASAR | Observado; não demonstra comportamento |
| O-03 | Pai REA `ev_f3960737517ea8dae2b1ae6616ee7fecb395b2333de04953b3a7429cc00133cf`; projeção `ev_3d4a2c4b1af84a41dbb7835767bb42e23b90433091c9e658ee962a4e54b14281` | Inventário estático: 204 ocorrências de arquivos, 78 de diretórios e seis contradições de integridade | Derivado do artefato; inventário completo dentro desse escopo, sem cobertura funcional |
| O-04 | Mesma evidência; primeira inspeção com integridade estrita falhou | Seis arquivos complementares diferem dos hashes declarados no pacote | Causa desconhecida; não diagnostica comprometimento nem instalação íntegra |
| O-05 | Pai REA `ev_52e9c4431fed8c13a66754c5f5d4251e2581f0e0738efc08479307ce86c6ecf9`; projeção `ev_0233b025eeaac375fff3564b09b060cdc8020e6a4ee95d06f2122394c9f5868d` | A análise estática reconheceu estruturas de aplicação Electron; 59 arquivos JavaScript analisados e oito não concluídos por limite de memória | Derivado; cobertura parcial e relações dinâmicas desconhecidas |
| O-06 | Mesmo pai; estatísticas da projeção | 122 arquivos considerados relevantes; cerca de 6,97 MB de texto lidos como conteúdo inerte | Mede volume lido, não porcentagem de funcionalidades cobertas |
| U-01 | O-03 a O-06 | Fluxos locais, seleção real, salvamento, concorrência e permissões efetivamente aplicadas não foram observados | Não estabelecer conclusões negativas a partir da ausência de achados |

## Procedimento efetivamente realizado

1. Confirmar diretório de trabalho vazio; localizar instalação em caminhos padrão, sem abrir perfil do usuário.
2. Consultar sessão REA: nenhum alvo aberto; abrir somente o ASAR explícito.
3. Tentar inventário com integridade estrita; falha preservada. Repetir em modo de registro de contradições: leitura dos bytes existentes com marcação de não confiança, sem corrigir arquivo ou remover verificação/proteção do app.
4. Executar análise JavaScript resumida, sem execução do alvo, com limites de memória/tempo/grafo. O resumo completo ficou retido pela ferramenta; a prévia de transporte foi truncada e seus contadores foram lidos do registro estruturado, sem repetir a análise.
5. Não aprofundar fontes ou relações privadas para implementar recursos. Resolver o escopo funcional por documentação pública e escolhas originais.
6. Encerrar a sessão sem snapshot de código ao concluir a investigação.

Sessão encerrada com sucesso; nova leitura do SHA-256 do ASAR ao final coincidiu com a identidade inicial. Isso verifica esse arquivo, não todos os arquivos da instalação.

Uma solicitação inicial de análise com seleção vazia de fontes foi rejeitada na validação, antes de analisar o alvo. Não se trata de evidência. Nenhuma rejeição foi tratada como sucesso.

## Limitações materiais

O limite de memória impediu oito análises; o grafo semântico foi limitado e tem desconhecidos explícitos. Não houve aumento de escopo para Ghidra, dados locais, execução ou rede. As contradições de integridade permaneceram registradas e não foram “reparadas”. Nenhuma conclusão sobre implementação do editor, persistência de conteúdo ou protocolo de sincronização da referência foi transportada à arquitetura do Bloco.
