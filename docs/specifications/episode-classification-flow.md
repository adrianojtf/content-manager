# Classificação de Séries e Episódios — Fluxos e Diagramas

**Status:** Referência  
**Specs relacionadas:** [Episode Setup Workflow](./technical-episode-setup-workflow.md), [Publication Analytics](./technical-analytics.md)  
**Fonte da verdade (código):** `src/domain/analytics/episode-identity.ts`, `src/application/analytics/classify-imported-publication.ts`, `src/application/analytics/episode-review.usecases.ts`, `src/infrastructure/intelligence/jev-publication-episode-classifier.ts`

## 1. Visão geral — quem decide o quê

É importante separar três perguntas diferentes, respondidas por mecanismos diferentes:

| Pergunta | Quem responde | Como |
|---|---|---|
| "Esta publicação é um episódio?" | **IA (JEV)** | Uma pergunta `choice` ao modelo: `EPISODE` / `NOT_EPISODE` / `UNCERTAIN` |
| "Qual é a série / temporada / número?" | **Regras determinísticas** (não é IA) | Regex e heurísticas sobre título + descrição |
| "Essa série existe ou é nova?" | **O criador** | Confirmação manual na etapa 1 do workflow |

Ou seja: **não existe um classificador de "é série ou não"**. A IA nunca nomeia nem agrupa séries — ela só diz se a publicação *parece ser uma parte de uma série*. O nome da série é extraído do texto por heurísticas locais e proposto ao criador, que confirma ou corrige.

> **Nota sobre linha temporal:** `publishedAt` **não** é entrada da classificação nem do agrupamento. Serve só para exibição e para o fingerprint de mudança (pular re-classificação). Ver seção 8.

## 2. Pipeline de atualização (refresh)

Disparado por `POST /analytics/episodes/review/refresh` (`RefreshEpisodeSuggestions`). Para cada publicação importada, em paralelo conceitual:

```mermaid
flowchart TD
    A[RefreshEpisodeSuggestions] --> B[Publicações importadas<br/>somente banco local]
    B --> C{Já vinculada ou<br/>fingerprint inalterado?}
    C -- sim --> S[Ignora]
    C -- não --> E[ClassifyImportedPublication]
    E --> F["JEV: é episódio?<br/>EPISODE / NOT_EPISODE / UNCERTAIN"]
    E --> G["Regras: extrai identidade<br/>série, temporada, episódio, código"]
    E --> H[Rationale trilíngue<br/>pt-BR / en-US / es-ES]
    F & G & H --> I[Sugestão pendente salva<br/>com evidência + auditoria]
    I --> J[GetEpisodeReview deriva a etapa]
```

As duas análises (F e G) são independentes: a IA pode dizer `UNCERTAIN` mesmo quando as regras extraem um número de episódio, e vice-versa. Cada publicação é avaliada isoladamente; uma falha vira registro por fonte, sem abortar o lote.

## 3. O que a IA decide (e o que ela NÃO decide)

O `JevPublicationEpisodeClassifier` envia ao modelo **apenas**:

```json
{ "publication": { "platform": "...", "title": "...", "description": "..." } }
```

e faz uma única pergunta do tipo `choice`:

- `EPISODE` — o texto dá evidência clara de que é um episódio/capítulo numerado de uma série recorrente;
- `NOT_EPISODE` — o texto dá evidência clara de que não é;
- `UNCERTAIN` — texto ausente, ambíguo ou insuficiente.

A IA **não** recebe `publishedAt`, permalink, outras publicações, nem histórico do criador. Ela **não** retorna nome de série, temporada ou número — só o rótulo e a confiança. Se a publicação não tem título nem descrição, o modelo nem é chamado: um fallback `RULES` retorna `UNCERTAIN` sem confiança.

## 4. Como o nome da série é extraído (determinístico)

`extractExplicitEpisodeIdentity(title, description)` roda matchers **em ordem**; o primeiro que casa define a identidade inteira:

```mermaid
flowchart TD
    T[título + descrição] --> M1{"1) Código `PREFIX-S02E08`?<br/>ex.: FQA-S02-E08"}
    M1 -- sim --> R1["série = PREFIX (ex.: FQA)<br/>temporada + episódio + código"]
    M1 -- não --> M2{"2) Código `PREFIX-E08` / `PREFIX-EP8`?"}
    M2 -- sim --> R2["série = PREFIX<br/>temporada UNKNOWN"]
    M2 -- não --> M3{"3) `S02E08` / `T2E8` solto?"}
    M3 -- sim --> R3["temporada + episódio conhecidos<br/>série = texto ao redor do marcador *"]
    M3 -- não --> M4{"4) `temporada 2 episódio 8` /<br/>`season 2 episode 8`?"}
    M4 -- sim --> R3
    M4 -- não --> M5{"5) `capítulo 8` / `episódio 8` /<br/>`episode 8` / `part 8`?"}
    M5 -- sim --> R4["episódio conhecido, temporada UNKNOWN<br/>série = texto ao redor * ou standalone **"]
    M5 -- não --> R5["sem número de episódio<br/>série = standalone ** se houver"]
```

### 4.1 Série pelo código (`PREFIX-...`)

Quando há um código tipo `FQA-S02-E08` ou `OBS-EP4`, o prefixo em maiúsculas vira o nome da série diretamente — sem heurística adicional. É o caminho mais confiável.

### 4.2 Série ao redor do marcador (`seriesNameAroundEpisodeMarker`)

Quando o número aparece como `Capítulo 8`, `S02E08`, etc., o algoritmo olha o texto **na mesma linha, antes e depois** do marcador, e gera candidatos com pontuação:

| Origem do candidato | Pontos |
|---|---|
| `... da série X` / `de novela X` depois do marcador | 6 |
| `| Nome` (pipe) depois do marcador | 6 |
| Texto antes do marcador na mesma linha | 5 se houver delimitador (`|`, `—`, `:`), 3 sem |
| Linha anterior inteira (≤100 caracteres) | 2 |

Antes de pontuar, cada candidato passa por `cleanSeriesNameCandidate`: remove pontuação/emoji das bordas, colapsa espaços e **rejeita** nomes que sejam só `episódio N`/`capítulo N`, ou que comecem com palavras genéricas (`no`, `em`, `ep`, `pov`, `que`, `mas`, `ele`, `ela`...). Vence o de maior pontuação; desempate pelo mais curto.

**Exemplo:** `Obsidiana O Legado | Capítulo 8` → antes do marcador há `Obsidiana O Legado |` com delimitador → série `Obsidiana O Legado` (5 pts).

### 4.3 Série "standalone" (`standaloneSeriesName`)

Quando não há marcador de episódio, ou o marcador não rendeu nome, o algoritmo varre todas as linhas buscando pistas de obra nomeada:

| Padrão | Pontos |
|---|---|
| `estreia: X`, `bastidores de X`, `acompanhe X`, `série: X`, `capítulos de X`, `reta final de X`... | 9 |
| Hashtag CamelCase com ≥3 palavras úteis (`#ObsidianaOLegado` → `Obsidiana O Legado`) | 8 + (nº palavras)/100 |
| `Nome | resto da legenda` | 7 |

Regras de corte: o nome precisa ter **≥2 palavras** normalizadas, e hashtags compostas só de palavras genéricas (`novela`, `serie`, `microdrama`, `romance`, `vertical`, `agegap`...) são descartadas. Vence o maior score; desempate pelo nome mais longo.

### 4.4 Heurística específica do tenant (Obsidiana)

Há uma regra ad hoc que resolve o arco `Obsidiana: O Legado` (texto, `#obsidianaolegado`, ou `#obsidiana` + `#olegado` separadas) para `seriesName=Obsidiana`, temporada `2` — e `1ª temporada — Obsidiana` para temporada `1`. Ela roda **depois** dos matchers e sobrescreve o resultado quando casa.

### 4.5 Normalização para agrupar

`normalizeSeriesIdentity` tira acentos, baixa tudo e troca não-alfanumérico por espaço (`Obsidiana O Legado` → `obsidiana o legado`). É essa forma normalizada que junta variações de escrita na mesma proposta de série e na mesma chave de episódio.

## 5. Da sugestão à série confirmada

A extração produz apenas uma **sugestão**. A série só passa a existir de fato quando o criador confirma:

```mermaid
flowchart LR
    P["identidade extraída:<br/>seriesName 'Obsidiana O Legado'"] --> Q[Etapa SERIES]
    Q --> R{Criador confirma}
    R -->|mapear existente| S[series_id da série existente]
    R -->|nova série| T[cria série com nome<br/>corrigido + aliases + modo]
    T --> U["aliases absorvem grafias futuras<br/>ex.: 'Obsidiana: O Legado'"]
```

## 6. Etapas e agrupamento de episódios

`GetEpisodeReview` recalcula a etapa no servidor a cada leitura:

```mermaid
flowchart TD
    P[Sugestões pendentes] --> Q{Alguma sem série confirmada?}
    Q -- sim --> SER[Etapa SERIES — agrupa por nome<br/>sugerido normalizado ou série confirmada]
    Q -- não --> W{Alguma série SEASONAL sem<br/>temporada confirmada?}
    W -- sim --> SEA[Etapa SEASONS — agrupa por<br/>série + temporada proposta + episódio]
    W -- não --> G[groupEpisodePublicationSuggestions<br/>chave: série normalizada<br/>+ temporada + episodeNumber]
    G --> EPI[Etapa EPISODES — um card por<br/>identidade canônica, entre redes]
```

A chave de agrupamento é `série normalizada : season:N|seasonless : episodeNumber`. Plataforma, conta, permalink, legenda e **data nunca entram na chave** — o mesmo episódio no Instagram/TikTok/YouTube/Facebook vira um único card com carrossel de fontes.

Sugestões que não entram em grupo ficam `unmatched` com motivo explícito:

| Motivo | Condição |
|---|---|
| `NOT_EPISODE` / `UNCERTAIN` | resultado do classificador |
| `IDENTITY_INCOMPLETE` | sem nome de série ou número inválido |
| `SEASON_UNKNOWN` | temporada não explícita e não confirmada |
| `SERIES_SEASON_MODE_CONFLICT` | identidade conflita com o modo da série |
| `IDENTITY_SINGLE` | bucket com uma única fonte — sem corroboração entre redes |
| `IDENTITY_CONFLICT` | mesma chave, códigos de episódio diferentes |

## 7. Aprovação e persistência

```mermaid
flowchart LR
    subgraph SERIES[Passo 1 — Séries]
        A1[proposta] --> A2{confirmar}
        A2 -->|existente| A3[series_id]
        A2 -->|nova| A4[cria série]
    end
    subgraph SEASONS[Passo 2 — Temporadas, só SEASONAL]
        B1[proposta] --> B2[confirmar número]
    end
    subgraph EPISODES[Passo 3 — Episódios]
        C1[card + carrossel<br/>selecionar fontes] --> C2[aprovar]
        C2 --> C3[transação atômica:<br/>episódio + vínculos<br/>sugestões → APPROVED]
    end
    SERIES --> SEASONS --> EPISODES --> D[COMPLETE]
```

O registro manual (`POST /analytics/series`, `POST /analytics/episodes/manual`) ignora a classificação: o criador escolhe até uma publicação não vinculada por rede; o servidor resolve as fontes do banco, cria episódio + vínculos atomicamente e marca sugestões pendentes como `APPROVED`.

## 8. A classificação considera a linha temporal?

**Não.** A dimensão cronológica não é usada em nenhuma etapa:

- O JEV recebe só `platform`, `title`, `description` — sem `publishedAt` e sem publicações vizinhas.
- A extração de identidade é regex/heurística por texto, sem análise de sequência.
- As chaves de agrupamento não contêm data; fontes com a mesma identidade agrupam independente de quando foram publicadas.
- `publishedAt` só aparece no `episodePublicationFingerprint` (pular re-classificação se nada mudou) e como metadado de exibição.

**Implicação:** o número explícito no texto sempre vence a cronologia. Publicar fora de ordem funciona, mas nada detecta "E10 antes de E09" ou reúso do mesmo número meses depois em outra temporada. Detectar isso exigiria regras novas ou incluir `publishedAt`/publicações irmãs no input do modelo, com atualização das specs.
