import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeCandidate } from '../lib/candidate.mjs';
import { collectPages, assertSourceAllowed } from '../lib/collection-engine.mjs';
import { compareCandidates, findDuplicatePairs } from '../lib/duplicates.mjs';
import { rankImageAssociations, assertImageProcessingAllowed } from '../lib/images.mjs';
import { auditCurrentCatalog, loadCurrentProducts } from '../lib/public-catalog.mjs';
import { loadStoreTaxonomy } from '../lib/taxonomy.mjs';
import { JsonCatalogStore } from '../lib/json-store.mjs';
import { buildPublicProductDraft } from '../lib/batch-import.mjs';
import { parseKitVersion, parseSeason } from '../lib/normalization.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const taxonomy = await loadStoreTaxonomy(root);
const source = {
  id: 'local-store-reference',
  name: 'Produtos locais para teste de compatibilidade',
  kind: 'local_test',
  localOnly: true,
};

function productAsSourceRecord(product) {
  return {
    externalId: String(product.id),
    team: product.time,
    entityKind: product.categoria === 'selecao' ? 'national_team' : 'club',
    league: product.liga,
    country: product.pais,
    season: product.temporada,
    version: product.versao,
    name: product.nome,
    image: product.img,
  };
}

test('os 20 produtos atuais são lidos sem alteração e suas imagens existem', async () => {
  const products = await loadCurrentProducts(root);
  const report = await auditCurrentCatalog(root, taxonomy);
  assert.equal(products.length, 20);
  assert.equal(report.productCount, 20);
  assert.equal(report.missingImageCount, 0);
  assert.deepEqual(report.categoryCounts, {
    brasileirao: 4,
    laliga: 4,
    premier: 3,
    bundesliga: 2,
    selecoes: 7,
  });
  assert.equal(report.retroCount, 2);
  const referenceCandidates = products.map(product => normalizeCandidate(productAsSourceRecord(product), { source, taxonomy }));
  assert.equal(findDuplicatePairs(referenceCandidates).length, 0);
});

test('normaliza nomes em português e aliases comuns de clubes e seleções', () => {
  const samples = [
    ['Bayern Munich', 'Bayern de Munique'],
    ['Man City', 'Manchester City'],
    ['Cote dIvoire', 'Costa do Marfim'],
    ['South Korea', 'Coreia do Sul'],
  ];
  for (const [input, expected] of samples) {
    const candidate = normalizeCandidate({ team: input, entityKind: input === 'Bayern Munich' || input === 'Man City' ? 'club' : 'national_team', league: 'Premier League', season: '2024/25', version: 'Home', name: `Home Shirt ${input}` }, { source, taxonomy });
    assert.equal(candidate.identity.team.canonicalName, expected);
  }
});

test('extrai temporada, versão e mantém Retrô como classificação adicional', () => {
  assert.deepEqual(parseSeason('2024-2025'), {
    label: '2024/25', startYear: 2024, endYear: 2025, type: 'season', confidence: 'high',
  });
  assert.equal(parseSeason('Camisa Retrô 1998').label, '1998');
  assert.equal(parseKitVersion('Camisa Fora').slot, 'away');

  const retro = normalizeCandidate({
    externalId: 'retro-01', team: 'Alemanha', entityKind: 'national_team', league: 'selecoes',
    season: '1990', version: 'Retrô', name: 'Camisa Retrô 1990',
  }, { source, taxonomy });
  assert.equal(retro.identity.category.primaryId, 'selecoes');
  assert.equal(retro.identity.category.retro, true);
  assert.deepEqual(retro.identity.category.additionalClassifications, ['retro']);
});

test('clubes de ligas sem aba própria vão para Outros e ficam revisáveis quando a liga é desconhecida', () => {
  const ajax = normalizeCandidate({ team: 'Ajax', league: 'eredivisie', season: '2024/25', version: 'Home', name: 'Ajax Home' }, { source, taxonomy });
  assert.equal(ajax.identity.category.primaryId, 'outros');
  assert.equal(ajax.identity.category.leagueId, 'eredivisie');

  const unknown = normalizeCandidate({ team: 'Unknown FC', league: 'some league', name: 'Unknown shirt' }, { source, taxonomy });
  assert.equal(unknown.identity.category.primaryId, 'outros');
  assert.equal(unknown.review.status, 'pending');
  assert.ok(unknown.review.reasons.includes('team_unmatched'));
});

test('duplicidade exata é reconhecida, mas temporadas e versões distintas não são fundidas', async () => {
  const product = (await loadCurrentProducts(root))[0];
  const first = normalizeCandidate(productAsSourceRecord(product), { source, taxonomy });
  const sameExternalItem = normalizeCandidate(productAsSourceRecord(product), { source, taxonomy });
  const differentVersion = normalizeCandidate({ ...productAsSourceRecord(product), externalId: 'alt-2', version: 'Away', name: 'Camisa Fora' }, { source, taxonomy });
  const differentSeason = normalizeCandidate({ ...productAsSourceRecord(product), externalId: 'alt-3', season: '2023/24' }, { source, taxonomy });

  assert.equal(compareCandidates(first, sameExternalItem).kind, 'same_record');
  const sameSkuDifferentTitle = normalizeCandidate({ ...productAsSourceRecord(product), name: 'Palmeiras home official shirt' }, { source, taxonomy });
  assert.equal(compareCandidates(first, sameSkuDifferentTitle).kind, 'same_record');
  assert.equal(compareCandidates(first, differentVersion).kind, 'distinct');
  assert.equal(compareCandidates(first, differentSeason).kind, 'distinct');

  const mirror = normalizeCandidate({ ...productAsSourceRecord(product), externalId: 'second-supplier-id' }, {
    source: { ...source, id: 'authorized-future-feed' }, taxonomy,
  });
  assert.equal(compareCandidates(first, mirror).kind, 'possible_duplicate');
  assert.equal(findDuplicatePairs([first, mirror]).length, 1);

  const urlFirst = normalizeCandidate({ ...productAsSourceRecord(product), productUrl: 'https://supplier.example/product/42' }, {
    source: { ...source, id: 'supplier-one' }, taxonomy,
  });
  const urlMirror = normalizeCandidate({ ...productAsSourceRecord(product), externalId: 'other-sku', productUrl: 'https://supplier.example/product/42?utm_source=mail' }, {
    source: { ...source, id: 'supplier-two' }, taxonomy,
  });
  assert.equal(compareCandidates(urlFirst, urlMirror).kind, 'duplicate');
});

test('associação de imagem verifica clube, temporada e versão; direitos continuam separados', () => {
  const product = normalizeCandidate({
    externalId: 'palmeiras-home', team: 'Palmeiras', entityKind: 'club', league: 'brasileirao',
    season: '2024/25', version: 'Home', name: 'Palmeiras Home Shirt',
  }, { source, taxonomy });
  const imageRef = {
    url: 'https://images.example.test/palmeiras-2024-home.jpg',
    team: 'Palmeiras', season: '2024/25', version: 'Home',
    authorization: { status: 'unknown' },
  };
  const [association] = rankImageAssociations(product, [imageRef], taxonomy);
  assert.equal(association.match.score, 95);
  assert.equal(association.match.status, 'strong_candidate');
  assert.equal(association.canUseInStore, false);
  assert.throws(() => assertImageProcessingAllowed(imageRef), /autorização documentada/i);

  const authorizedLocal = {
    ...imageRef,
    localPath: 'img camisas/palmeiras-titular.jpg',
    authorization: { status: 'authorized', evidenceNote: 'Permissão de uso documentada para este arquivo.' },
  };
  const [approvedAssociation] = rankImageAssociations(product, [authorizedLocal], taxonomy);
  assert.equal(approvedAssociation.canUseInStore, true);
  assert.equal(approvedAssociation.requiresHumanReview, false);
  const imageDraft = buildPublicProductDraft(product, { id: 2100, imageReference: approvedAssociation });
  assert.equal(imageDraft.product.img, 'img camisas/palmeiras-titular.jpg');

  const existingLocalRef = { localPath: 'img camisas/palmeiras-titular.jpg', team: 'Palmeiras', version: 'Casa', authorization: { status: 'unknown' } };
  const [existingLocalAssociation] = rankImageAssociations(product, [existingLocalRef], taxonomy);
  assert.equal(existingLocalAssociation.match.score, 70);
  assert.equal(existingLocalAssociation.match.status, 'needs_review');
  assert.equal(existingLocalAssociation.canUseInStore, false);
});

test('o marcador Retrô fica no draft sem substituir versão e categoria', () => {
  const retro = normalizeCandidate({
    externalId: 'retro-argentina', team: 'Argentina', entityKind: 'national_team', league: 'selecoes',
    season: '1994', version: 'Retrô Casa', name: 'Argentina 1994 Retro Home',
  }, { source, taxonomy });
  const draft = buildPublicProductDraft(retro, { id: 2003 });
  assert.equal(draft.product.categoria, 'selecao');
  assert.equal(draft.product.versao, 'Casa');
  assert.deepEqual(draft.product.classificacoes, ['retro']);
  assert.deepEqual(draft.review.additionalClassifications, ['retro']);
});

test('rascunho de importação preserva preço e disponibilidade da loja e recusa hotlink', () => {
  const candidate = normalizeCandidate({
    externalId: 'draft-01', team: 'Argentina', entityKind: 'national_team', league: 'selecoes',
    season: '2024/25', version: 'Home', name: 'Argentina Home Shirt',
    price: 48, currency: 'CNY', stock: 'supplier-reported', sizes: ['S', 'M'],
  }, { source, taxonomy });
  const draft = buildPublicProductDraft(candidate, { id: 2001 });
  assert.deepEqual(candidate.supplierOffer, {
    priceRaw: 48, currency: 'CNY', availabilityRaw: 'supplier-reported', sizes: ['S', 'M'],
  });
  assert.equal(draft.product.preco, 130);
  assert.equal(draft.product.disponibilidade, 'encomenda');
  assert.equal(draft.product.categoria, 'selecao');
  assert.equal(draft.product.img, 'img/product-placeholder.svg');
  assert.equal(draft.review.required, true);
  assert.deepEqual(draft.review.additionalClassifications, []);

  assert.throws(() => buildPublicProductDraft(candidate, {
    id: 2002,
    imageReference: { url: 'https://images.example.test/argentina.jpg', match: { status: 'strong_candidate' }, authorization: { status: 'authorized', evidenceUrl: 'https://example.test/permission' } },
  }), /caminho local/i);
  assert.throws(() => buildPublicProductDraft(candidate, {
    id: 2004,
    imageReference: {
      localPath: 'img/argentina.jpg', match: { status: 'needs_review' },
      authorization: { status: 'authorized', evidenceUrl: 'https://example.test/permission' },
    },
  }), /correspondência confirmada/i);
});

test('exportação em lote não permite apontar para o catálogo público', async () => {
  const { exportBatchDrafts } = await import('../lib/batch-import.mjs');
  await assert.rejects(
    () => exportBatchDrafts([], { filename: path.join(root, 'produtos.js') }),
    /data\/catalogo-local/i,
  );
});

test('o coletor recusa fontes externas sem autorização documentada antes de qualquer requisição', async () => {
  let called = false;
  assert.throws(() => assertSourceAllowed({ ...source, localOnly: false, fetchPage: async () => {} }), /falta autorização/i);
  const denied = { id: 'unapproved-feed', kind: 'official_feed', fetchPage: async () => { called = true; return { items: [] }; } };
  assert.throws(() => assertSourceAllowed(denied), /falta autorização/i);
  assert.equal(called, false);

  const publicWebWithoutRobots = {
    id: 'public-site',
    kind: 'public_web',
    authorization: { status: 'approved', evidenceUrl: 'https://example.test/permission', robotsStatus: 'unknown' },
    fetchPage: async () => { called = true; return { items: [] }; },
  };
  assert.throws(() => assertSourceAllowed(publicWebWithoutRobots), /robots.txt/i);
  assert.equal(called, false);
});

test('fila de revisão permite corrigir candidato, imagem e duplicado sem mesclar registros', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arquibancada-review-'));
  try {
    const store = await new JsonCatalogStore(path.join(tempDir, 'state.json')).open();
    const candidate = normalizeCandidate({
      externalId: 'review-01', team: 'Unknown FC', league: 'unknown league',
      name: 'Unresolved shirt', image: 'https://images.example.test/unknown.jpg',
    }, { source, taxonomy });
    await store.upsertCandidates([candidate]);
    assert.equal(store.listCandidateReviewQueue().length, 1);

    const reviewed = await store.recordCandidateReview(candidate.recordId, {
      team: 'Manchester City', league: 'Premier League', season: '2024/25', version: 'Home',
      reviewer: 'Amanda', note: 'Correspondência confirmada no processo de revisão.',
    }, taxonomy);
    assert.equal(reviewed.review.status, 'reviewed');
    assert.equal(reviewed.identity.team.canonicalName, 'Manchester City');
    assert.equal(reviewed.identity.category.primaryId, 'premier');
    assert.equal(store.listCandidateReviewQueue().length, 0);

    const image = reviewed.images[0];
    await store.saveImageMatch(candidate.recordId, image.imageId, { status: 'needs_review', score: 70, reasons: ['season_missing'] });
    assert.equal(store.listImageReviewQueue().length, 1);
    const imageDecision = await store.recordImageReview(candidate.recordId, image.imageId, {
      outcome: 'rejected_match', reviewer: 'Amanda', note: 'Temporada não confirmada.',
    });
    assert.equal(imageDecision.match.status, 'rejected_match');
    assert.equal(imageDecision.authorization.status, 'unknown');
    assert.equal(store.listImageReviewQueue().length, 0);

    await store.setDuplicatePairs([{ pairId: 'pair-example', firstId: candidate.recordId, secondId: 'candidate-other', kind: 'possible_duplicate', reviewed: false }]);
    const duplicateDecision = await store.recordDuplicateReview('pair-example', {
      outcome: 'different_products', reviewer: 'Amanda', note: 'Modelos distintos.',
    });
    assert.equal(duplicateDecision.reviewed, true);
    assert.equal(duplicateDecision.outcome, 'different_products');
    assert.equal(store.listDuplicateReviewQueue().length, 0);

    const uncommonClub = normalizeCandidate({
      externalId: 'uncommon-01', team: 'Dynamo Kyiv', league: 'Ukrainian Premier League',
      season: '2023/24', version: 'Home', name: 'Dynamo Kyiv Home Shirt',
    }, { source, taxonomy });
    await store.upsertCandidates([uncommonClub]);
    const manualTeam = await store.recordCandidateReview(uncommonClub.recordId, {
      team: 'Dynamo Kyiv', canonicalTeam: 'Dynamo Kyiv', entityKind: 'club',
      aliases: ['FC Dynamo Kyiv'], league: 'Ukrainian Premier League', country: 'Ucrânia', reviewer: 'Amanda',
    }, taxonomy);
    assert.equal(manualTeam.review.status, 'reviewed');
    assert.equal(manualTeam.identity.team.canonicalName, 'Dynamo Kyiv');
    assert.equal(manualTeam.identity.category.primaryId, 'outros');
    assert.equal(manualTeam.identity.category.leagueId, 'ukrainianpremierleague');
    assert.ok(store.data.teamAliases.fcdynamokyiv);
    assert.ok(store.data.approvedLeagues.ukrainianpremierleague);

    const repeatedAlias = normalizeCandidate({
      externalId: 'uncommon-02', team: 'FC Dynamo Kyiv', league: 'Ukrainian Premier League',
      season: '2024/25', version: 'Away', name: 'Dynamo Kyiv Away Shirt',
    }, { source, taxonomy: store.taxonomyWithManualAliases(taxonomy) });
    assert.equal(repeatedAlias.identity.team.canonicalName, 'Dynamo Kyiv');
    assert.equal(repeatedAlias.identity.team.country, 'Ucrânia');
    assert.equal(repeatedAlias.identity.category.primaryId, 'outros');
    assert.equal(repeatedAlias.review.status, 'ready_for_review');
    assert.equal(store.listCandidates().length, 2);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('paginação local pode pausar e retomar sem perder produtos nem criar duplicatas', async () => {
  const products = await loadCurrentProducts(root);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arquibancada-catalog-'));
  try {
    const store = await new JsonCatalogStore(path.join(tempDir, 'state.json')).open();
    const adapter = {
      ...source,
      async fetchPage({ cursor }) {
        const offset = cursor == null ? 0 : Number(cursor);
        const items = products.slice(offset, offset + 5).map(productAsSourceRecord);
        const next = offset + items.length;
        return { items, nextCursor: next >= products.length ? null : String(next), pageUrl: `local://catalog/${offset}` };
      },
    };

    const firstRun = await collectPages({ source: adapter, store, taxonomy, config: { maxRequests: 1, minIntervalMs: 0 } });
    assert.equal(firstRun.status, 'paused');
    assert.equal(store.listCandidates().length, 5);
    assert.equal(store.getCollectionState(source.id).cursor, '5');
    assert.equal(store.listCandidates()[0].source.pageUrl, 'local://catalog/0');
    assert.equal(store.listCandidates()[0].source.pageCursor, null);

    const resumed = await collectPages({ source: adapter, store, taxonomy, config: { maxRequests: 10, minIntervalMs: 0 } });
    assert.equal(resumed.status, 'complete');
    assert.equal(store.listCandidates().length, 20);
    assert.equal(new Set(store.listCandidates().map(item => item.recordId)).size, 20);
    assert.equal(store.listCandidateReviewQueue().length, 20);
    assert.equal(store.data.errors.length, 0);

    const persisted = JSON.parse(await readFile(path.join(tempDir, 'state.json'), 'utf8'));
    assert.equal(Object.keys(persisted.candidates).length, 20);
    assert.equal(persisted.collectionStates[source.id].done, true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('falha temporária no limite de requisições pode ser retomada sem falso cursor repetido', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'arquibancada-retry-'));
  try {
    const store = await new JsonCatalogStore(path.join(tempDir, 'state.json')).open();
    let attempts = 0;
    const adapter = {
      ...source,
      async fetchPage() {
        attempts += 1;
        if (attempts === 1) {
          const error = new Error('temporary');
          error.retryable = true;
          throw error;
        }
        return { items: [{ externalId: 'resume-1', team: 'Brasil', entityKind: 'national_team', league: 'selecoes', season: '2026', version: 'Home', name: 'Brasil Home' }], nextCursor: null };
      },
    };
    const paused = await collectPages({ source: adapter, store, taxonomy, config: { maxRequests: 1, minIntervalMs: 0 } });
    assert.equal(paused.status, 'paused');
    assert.deepEqual(store.getCollectionState(source.id).seenCursors, []);
    const resumed = await collectPages({ source: adapter, store, taxonomy, config: { maxRequests: 2, minIntervalMs: 0 } });
    assert.equal(resumed.status, 'complete');
    assert.equal(store.listCandidates().length, 1);
    assert.equal(store.data.errors.length, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
