// Prompt de compactação — adaptado do Claude Code (src/services/compact/prompt.ts).
// Estrutura de 9 seções + scratchpad <analysis> + <summary>, preâmbulo no-tools,
// formatador que descarta o <analysis> e mensagem de "sessão continuada".

// Preâmbulo agressivo: o resumo é texto puro, sem chamar ferramentas (1 turno só).
export const NO_TOOLS_PREAMBLE = `CRÍTICO: Responda APENAS com TEXTO. NÃO chame nenhuma ferramenta.

- Não use shell, ler_arquivo, escrever_arquivo, python, web, lembrar nem qualquer outra.
- Você já tem todo o contexto necessário na conversa acima.
- Chamadas de ferramenta serão REJEITADAS e desperdiçam seu único turno.
- Sua resposta inteira deve ser texto puro: um bloco <analysis> seguido de um bloco <summary>.

`

const ANALYSIS_INSTRUCTION = `Antes do resumo final, envolva sua análise em tags <analysis> pra organizar o raciocínio e garantir que cobriu todos os pontos. No processo de análise:

1. Analise cronologicamente cada mensagem e seção da conversa. Pra cada uma, identifique a fundo:
   - Os pedidos e intenções explícitas do usuário
   - Sua abordagem pra atender esses pedidos
   - Decisões-chave, conceitos técnicos e padrões de código
   - Detalhes específicos: nomes de arquivo, trechos de código completos, assinaturas de função, edições
   - Erros que apareceram e como foram corrigidos
   - Preste atenção especial a feedback do usuário, principalmente quando ele pediu pra fazer diferente.
2. Confira precisão técnica e completude, cobrindo cada elemento exigido.`

export const BASE_COMPACT_PROMPT = `Sua tarefa é criar um resumo detalhado da conversa até aqui, com atenção total aos pedidos explícitos do usuário e às suas ações anteriores. O resumo deve capturar detalhes técnicos, padrões de código e decisões de arquitetura essenciais pra continuar o trabalho sem perder contexto.

${ANALYSIS_INSTRUCTION}

Seu resumo deve incluir as seguintes seções:

1. Pedido e Intenção Principal: capture todos os pedidos e intenções explícitas do usuário em detalhe.
2. Conceitos Técnicos Chave: liste tecnologias, frameworks e conceitos importantes discutidos.
3. Arquivos e Trechos de Código: enumere arquivos e trechos examinados, modificados ou criados. Inclua snippets completos quando relevante e por que cada arquivo importa.
4. Erros e Correções: liste os erros que apareceram e como foram resolvidos. Destaque feedback do usuário, em especial quando ele pediu algo diferente.
5. Resolução de Problemas: documente problemas resolvidos e investigações em andamento.
6. Todas as mensagens do usuário: liste TODAS as mensagens do usuário que não são resultado de ferramenta. São críticas pra entender feedback e mudança de intenção.
7. Tarefas Pendentes: as tarefas que o usuário pediu explicitamente e ainda não foram concluídas.
8. Trabalho Atual: descreva em detalhe exatamente o que estava sendo feito imediatamente antes deste resumo, com nomes de arquivo e trechos.
9. Próximo Passo (opcional): o próximo passo, DIRETAMENTE alinhado ao pedido mais recente do usuário. Se a última tarefa foi concluída, só liste próximos passos se forem claramente o que o usuário pediu. Inclua citações verbatim da conversa recente mostrando exatamente onde você parou.

Estruture a saída assim:

<analysis>
[Seu raciocínio, cobrindo todos os pontos com cuidado]
</analysis>

<summary>
1. Pedido e Intenção Principal:
   [descrição detalhada]

2. Conceitos Técnicos Chave:
   - [conceito]

3. Arquivos e Trechos de Código:
   - [arquivo]: [por que importa] / [trecho]

4. Erros e Correções:
   - [erro]: [como corrigiu] / [feedback do usuário]

5. Resolução de Problemas:
   [descrição]

6. Todas as mensagens do usuário:
   - [mensagem]

7. Tarefas Pendentes:
   - [tarefa]

8. Trabalho Atual:
   [descrição com arquivos/trechos]

9. Próximo Passo:
   [próximo passo + citações verbatim]
</summary>`

/** Descarta o <analysis> (rascunho) e extrai o conteúdo do <summary>. */
export const formatCompactSummary = (raw: string): string => {
  let s = raw.replace(/<analysis>[\s\S]*?<\/analysis>/, '')
  const m = s.match(/<summary>([\s\S]*?)<\/summary>/)
  if (m) s = s.replace(/<summary>[\s\S]*?<\/summary>/, `Resumo:\n${(m[1] ?? '').trim()}`)
  return s.replace(/\n\n+/g, '\n\n').trim()
}

/** Monta a mensagem que substitui o histórico após a compactação. */
export const getCompactSummaryMessage = (raw: string): string => {
  const formatted = formatCompactSummary(raw)
  return (
    'Esta sessão é a continuação de uma conversa anterior que ficou sem contexto. ' +
    'O resumo abaixo cobre a parte inicial da conversa.\n\n' +
    formatted +
    '\n\nContinue de onde parou, sem perguntar nada ao usuário e sem recapitular o resumo. ' +
    'Retome a última tarefa como se a pausa não tivesse acontecido.'
  )
}
