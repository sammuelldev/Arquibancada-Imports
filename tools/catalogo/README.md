# Ferramentas locais do catálogo

O catálogo feminino da Rainha JIN, o formato da exportação autorizada e os comandos de teste e retomada estão em [FEMININAS.md](FEMININAS.md). As ferramentas de compatibilidade abaixo auditam o acervo histórico de 20 produtos fora da vitrine.

## Comandos

- `npm run catalog:check` faz auditoria somente de leitura dos produtos e dos caminhos das imagens locais.
- `npm run catalog:test` executa testes offline, inclusive paginação pausada/retomada sobre os 20 produtos da loja.

O arquivo de estado só é criado quando um coletor é executado explicitamente. O caminho padrão é `data/catalogo-local/state.json`, ignorado pelo Git porque pode conter dados importados de fornecedores.

## Modelo de candidato

Cada candidato contém `source` (identificador, item externo, URLs, autorização declarada e instante de captura), `raw` (registro recebido), `supplierOffer` (preço/moeda/estoque/tamanhos como reportados pela fonte), `identity` normalizada, referências de `images`, uma fila `review` e `import.status`. Oferta do fornecedor não altera o preço da loja. Campos incertos permanecem vazios e geram motivos de revisão; o normalizador não inventa temporada, país, versão ou licença de imagem.

As categorias principais são as abas existentes. Seleções são sempre classificadas em `selecoes`; ligas sem aba, como Eredivisie, ficam em `outros`. `retro` é uma classificação adicional (`additionalClassifications: ["retro"]`) e não substitui a categoria do clube, liga ou seleção.

Versões são normalizadas para `home`, `away`, `third` e `special`. A indicação `retro` e os dados de edição/modelo são campos separados. Temporadas em intervalo viram `YYYY/YY`; anos únicos, como 1990 ou 2026, permanecem anos únicos.

## Duplicados e revisão

Uma chave externa estável na mesma origem gera um `recordId` idempotente; reaparecer em outra página atualiza o mesmo candidato. A mesma URL canônica de produto entre registros é duplicado conclusivo. Mesma equipe + temporada + versão, sem identificador conclusivo, vira `possible_duplicate` e exige revisão. Variação de temporada ou de versão impede a fusão. O sistema não apaga nem combina candidatos automaticamente.

Correspondências incertas de equipe, temporada ou versão ficam em `review.status = "pending"`. A comparação de imagens exige a mesma equipe e rejeita temporadas/versões conflitantes. Mesmo uma correspondência forte não significa que a imagem esteja licenciada: `authorization.status` e evidência são avaliados separadamente.

O armazenamento expõe filas separadas (`listCandidateReviewQueue`, `listImageReviewQueue`, `listDuplicateReviewQueue`) e grava decisões auditáveis (`recordCandidateReview`, `saveImageMatch`/`recordImageReview`, `recordDuplicateReview`). Candidatos completos entram como `ready_for_review`; os com lacunas entram como `pending`. Uma revisão concluída vira `reviewed`, sem aprovar ou publicar automaticamente o produto. Revisar um par como duplicado nunca mescla nem exclui os registros; a decisão fica registrada para uma etapa de importação posterior.

Quando uma revisão define `canonicalTeam`, os nomes de origem confirmados (e `aliases`, se fornecidos) são guardados no JSON local. Ligas fora da taxonomia também podem ser confirmadas numa revisão; elas continuam em `outros`, sem criar abas, e passam a ser reconhecidas nas próximas coletas locais. Um alias já associado a outro clube é recusado, salvo se a decisão vier explicitamente com `replaceAlias: true`.

Nenhuma imagem remota é baixada ou usada como hotlink. Uma imagem só entra em um rascunho quando a associação por equipe, temporada e versão é forte ou foi aprovada manualmente, há autorização documentada e existe caminho local relativo. `assertImageProcessingAllowed()` aplica o bloqueio de direitos. A preparação de importação usa `img/product-placeholder.svg` enquanto não existe arquivo local autorizado e associado.

## Conectar uma fonte autorizada depois

Implemente um adaptador que tenha `id`, `name`, `kind`, `authorization` e `fetchPage({ cursor, signal })`. `fetchPage` retorna `{ items, nextCursor, pageUrl }`; cada item deve mapear os campos de equipe, liga, temporada, versão, SKU/ID, URL de produto e referências de imagem. Se precisar transformar o registro bruto, defina também `mapItem(rawRecord)` no adaptador. O engine já trata limite de requisições, intervalo mínimo, tentativas limitadas, registro de erro, checkpoint por página, detecção de cursor repetido e retomada. `resume: false` reinicia a paginação desde o início, mas mantém a gravação idempotente dos itens por identificador de origem.

Antes de chamar `collectPages`, uma origem externa precisa apresentar `authorization.status: "approved"` e `evidenceUrl` ou `document`. Para `kind: "public_web"`, também é obrigatório `authorization.robotsStatus: "allowed"`. Sem isso a coleta falha antes de chamar o adaptador. `kind: "local_test"` só é liberado com `localOnly: true` e deve ler dados locais, sem rede. Use `kind: "official_feed"` para feed/API autorizado pelo fornecedor. O adaptador não deve tentar contornar login, CAPTCHA, bloqueios ou limites.

Exemplo conceitual (não conectado a qualquer fornecedor):

```js
const source = {
  id: 'feed-com-autorizacao',
  name: 'Feed de catálogo autorizado',
  kind: 'official_feed',
  authorization: {
    status: 'approved',
    evidenceUrl: 'https://fornecedor.example/docs/catalog-feed',
  },
  async fetchPage({ cursor }) {
    // Implementar com o protocolo e credenciais oficiais autorizados.
    return { items: [], nextCursor: null, pageUrl: null };
  },
};
```

Para preparar um lote, use `buildPublicProductDraft(candidate, { id })` ou `exportBatchDrafts(...)`. O resultado separa `product` (campos da loja, com `classificacoes: ["retro"]` quando aplicável) de `review` (pendências e classificações). Exportações são limitadas a `data/catalogo-local/`; importar no catálogo público continua sendo uma ação deliberada, não automática. O rascunho respeita R$ 130,00, disponibilidade `encomenda`, categorias atuais e evita URLs de imagem externas. A integração final da etiqueta Retrô na aba pública exigirá que o filtro da loja leia `classificacoes`; essa etapa não foi feita porque o catálogo público/layout permanece intacto.
