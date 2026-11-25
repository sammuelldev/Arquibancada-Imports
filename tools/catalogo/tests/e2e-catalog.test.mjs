import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildPublicProductDraft } from '../lib/batch-import.mjs';
import { collectPages } from '../lib/collection-engine.mjs';
import { compareCandidates } from '../lib/duplicates.mjs';
import { rankImageAssociations } from '../lib/images.mjs';
import { auditCurrentCatalog } from '../lib/public-catalog.mjs';
import { JsonCatalogStore } from '../lib/json-store.mjs';
import { loadStoreTaxonomy } from '../lib/taxonomy.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const taxonomy = await loadStoreTaxonomy(root);

function fixture(sku, team, league, season, version, options = {}) {
  const safe = sku.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const title = options.title ?? [team, season, version].filter(Boolean).join(' ');
  const photo = options.noPhoto ? null : {
    url: `https://images.example.invalid/${safe}.jpg`,
    fileName: options.photoName ?? `${safe}.jpg`,
    team: options.photoTeam ?? team,
    season: options.photoSeason === undefined ? season : options.photoSeason,
    version: options.photoVersion ?? version,
    authorization: { status: 'unknown' },
  };
  return {
    sku,
    team,
    kind: options.kind ?? 'club',
    league,
    season,
    version,
    title,
    url: options.productUrl ?? `https://supplier.example.invalid/products/${safe}`,
    photo,
    supplierPrice: options.supplierPrice ?? 57.5,
    supplierCurrency: 'CNY',
    supplierStock: 'reported-by-fixture',
    sizes: ['S', 'M', 'L'],
  };
}

const fixtures = [
  fixture('pal-home-a', 'Palmeiras', 'Brasileirão', '2024/25', 'Home'),
  fixture('pal-home-b', 'Palmeiras', 'Brasileirão', '2024/25', 'Home'),
  fixture('pal-away', 'Palmeiras', 'Brasileirão', '2024/25', 'Away', { photoSeason: null }),
  fixture('pal-home-old', 'Palmeiras', 'Brasileirão', '2023/24', 'Home'),
  fixture('flamengo-home', 'Flamengo', 'Brasileirão', '2024/25', 'Home'),
  fixture('madrid-home', 'Real Madrid', 'La Liga', '2024/25', 'Home'),
  fixture('madrid-away', 'Real Madrid', 'La Liga', '2023/24', 'Away'),
  fixture('barcelona-alias', 'FC Barcelona', 'La Liga', '2023/24', 'Home'),
  fixture('atletico-alias', 'Atletico Madrid', 'La Liga', '2024/25', 'Away'),
  fixture('city-alias', 'Man City', 'Premier League', '2024/25', 'Home'),
  fixture('arsenal-away', 'Arsenal', 'Premier League', '2023/24', null, { title: 'Arsenal Away Shirt 2023/24' }),
  fixture('chelsea-third', 'Chelsea', 'Premier League', '2024/25', 'Third'),
  fixture('bayern-alias', 'Bayern Munich', 'Bundesliga', '2024/25', 'Home'),
  fixture('dortmund-home', 'Borussia Dortmund', 'Bundesliga', '2023/24', 'Home'),
  fixture('inter-alias', 'Inter Milan', 'Serie A', '2023/24', 'Away'),
  fixture('juventus-special', 'Juventus', 'Serie A', '2024/25', 'Special Edition'),
  fixture('psg-alias', 'PSG', 'Ligue 1', '2023/24', 'Home'),
  fixture('marseille-away', 'Olympique de Marseille', 'Ligue 1', '2024/25', 'Away'),
  fixture('lille-third', 'Lille', 'Ligue 1', '2023/24', 'Third'),
  fixture('ajax-other', 'Ajax', 'eredivisie', '2024/25', 'Home'),
  fixture('benfica-other', 'Benfica', 'primeira_liga', '2023/24', 'Away'),
  fixture('boca-other', 'Boca Juniors', 'campeonato_argentino', '2024', 'Home'),
  fixture('alnassr-other', 'Al Nassr', 'saudi_pro_league', '2024/25', 'Home'),
  fixture('brazil-home', 'Brazil', 'Seleções', '2026', 'Home', { kind: 'national_team' }),
  fixture('brazil-away', 'Brazil', 'Seleções', '2026', 'Away', { kind: 'national_team' }),
  fixture('argentina-home', 'Argentina', 'Seleções', '2024', 'Home', { kind: 'national_team' }),
  fixture('france-home', 'France', 'Seleções', '2024', 'Home', { kind: 'national_team' }),
  fixture('germany-retro', 'Germany', 'Seleções', '1990', 'Retro Home', { kind: 'national_team' }),
  fixture('france-retro', 'France', 'Seleções', '1998', 'Retro Home', { kind: 'national_team' }),
  fixture('japan-away', 'Japão', 'Seleções', '2022', 'Away', { kind: 'national_team' }),
  fixture('netherlands-home', 'Netherlands', 'Seleções', '2022', 'Home', { kind: 'national_team' }),
  fixture('usa-third', 'USA', 'Seleções', '2026', 'Third', { kind: 'national_team' }),
  fixture('morocco-home', 'Marrocos', 'Seleções', '2022', 'Home', { kind: 'national_team' }),
  fixture('wales-home', 'Wales', 'Seleções', '2024', 'Home', { kind: 'national_team' }),
  fixture('barcelona-retro', 'FC Barcelona', 'La Liga', '1999', 'Retro Away'),
  fixture('pal-home-same-url', 'Palmeiras', 'Brasileirão', '2024/25', 'Home', {
    productUrl: 'https://supplier.example.invalid/products/pal-home-a',
  }),
  fixture('brazil-home-copy', 'Brazil', 'Seleções', '2026', 'Home', { kind: 'national_team' }),
  fixture('incomplete-unknown', 'Unknown FC', 'Mystery League', null, null, {
    title: 'Unidentified Shirt',
    photoTeam: 'Unknown FC',
  }),
  fixture('lille-prior-season', 'Lille', 'Ligue 1', '2022/23', 'Away'),
  fixture('spain-2010', 'Espanha', 'Seleções', '2010', 'Home', { kind: 'national_team' }),
  fixture('benfica-third', 'Benfica', 'primeira_liga', '2024/25', 'Third'),
  fixture('argentina-retro', 'Argentina', 'Seleções', '1986', 'Retro Home', { kind: 'national_team' }),
  fixture('river-other', 'River Plate', 'campeonato_argentino', '2023/24', 'Away'),
];

async function removeIsolatedDirectory(directory) {
  const resolved = path.resolve(directory);
  const tempRoot = path.resolve(os.tmpdir());
  assert.equal(path.dirname(resolved), tempRoot, 'E2E cleanup is restricted to its generated OS temp directory.');
  assert.ok(path.basename(resolved).startsWith('arquibancada-catalog-e2e-'));
  await rm(resolved, { recursive: true, force: true });
}

test('fluxo integrado do catálogo com dados sintéticos isolados', async t => {
  assert.ok(fixtures.length >= 30);
  const productsFile = path.join(root, 'produtos.js');
  const originalProductsHash = createHash('sha256').update(await readFile(productsFile)).digest('hex');
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'arquibancada-catalog-e2e-'));
  const store = await new JsonCatalogStore(path.join(tempDirectory, 'state.json')).open();

  try {
    const pageSize = 10;
    const source = {
      id: 'isolated-synthetic-feed',
      name: 'Fixtures sintéticas E2E',
      kind: 'local_test',
      localOnly: true,
      mapItem(record) {
        return {
          externalId: record.sku,
          team: record.team,
          entityKind: record.kind,
          league: record.league,
          season: record.season,
          version: record.version,
          name: record.title,
          productUrl: record.url,
          image: record.photo,
          price: record.supplierPrice,
          currency: record.supplierCurrency,
          stock: record.supplierStock,
          sizes: record.sizes,
        };
      },
      async fetchPage({ cursor }) {
        const offset = cursor == null ? 0 : Number(cursor);
        const items = fixtures.slice(offset, offset + pageSize);
        const nextOffset = offset + items.length;
        return {
          items,
          nextCursor: nextOffset >= fixtures.length ? null : String(nextOffset),
          pageUrl: `local://synthetic-feed/${offset}`,
        };
      },
    };

    const interrupted = await collectPages({
      source, store, taxonomy, config: { maxRequests: 1, minIntervalMs: 0 }, sleep: async () => {},
    });
    assert.equal(interrupted.status, 'paused');
    assert.equal(interrupted.products, pageSize);
    assert.equal(store.getCollectionState(source.id).cursor, String(pageSize));

    const candidateBySku = sku => store.listCandidates().find(candidate => candidate.source.externalId === sku);
    const firstProduct = candidateBySku('pal-home-a');
    assert.ok(firstProduct);
    const firstReview = await store.recordCandidateReview(firstProduct.recordId, {
      team: 'Palmeiras', league: 'brasileirao', country: 'Brasil',
      season: '2024/25', version: 'Home', reviewer: 'E2E reviewer',
      note: 'Identity confirmed in isolated test fixture.',
    }, taxonomy);
    assert.equal(firstReview.review.status, 'reviewed');

    const homeDuplicate = candidateBySku('pal-home-b');
    const possiblePair = store.data.duplicatePairs.find(pair =>
      [pair.firstId, pair.secondId].includes(firstReview.recordId)
      && [pair.firstId, pair.secondId].includes(homeDuplicate.recordId));
    assert.equal(possiblePair?.kind, 'possible_duplicate');
    await store.recordDuplicateReview(possiblePair.pairId, {
      outcome: 'same_product', reviewer: 'E2E reviewer', note: 'Synthetic pair decision.',
    });

    const exactImage = rankImageAssociations(firstReview, firstReview.images, taxonomy)[0];
    assert.equal(exactImage.match.score, 95);
    assert.equal(exactImage.match.status, 'strong_candidate');
    assert.equal(exactImage.canUseInStore, false);
    await store.saveImageMatch(firstReview.recordId, exactImage.reference.imageId, exactImage.match);
    await store.recordImageReview(firstReview.recordId, exactImage.reference.imageId, {
      outcome: 'approved_match', reviewer: 'E2E reviewer', note: 'Visual identity accepted; rights remain separate.',
    });
    const firstProductDraft = buildPublicProductDraft(firstReview, { id: 9001 });
    assert.equal(firstProductDraft.product.img, 'img/product-placeholder.svg');
    assert.throws(() => buildPublicProductDraft(firstReview, {
      id: 9002,
      imageReference: exactImage,
    }), /autorização documentada/i);

    const uncertainProduct = candidateBySku('pal-away');
    const uncertainImage = rankImageAssociations(uncertainProduct, uncertainProduct.images, taxonomy)[0];
    assert.equal(uncertainImage.match.score, 70);
    assert.equal(uncertainImage.match.status, 'needs_review');
    await store.saveImageMatch(uncertainProduct.recordId, uncertainImage.reference.imageId, uncertainImage.match);
    assert.ok(store.listImageReviewQueue().some(entry => entry.recordId === uncertainProduct.recordId));
    await store.recordImageReview(uncertainProduct.recordId, uncertainImage.reference.imageId, {
      outcome: 'rejected_match', reviewer: 'E2E reviewer', note: 'Season was missing from image metadata.',
    });

    const resumed = await collectPages({
      source, store, taxonomy, config: { maxRequests: 20, minIntervalMs: 0 }, sleep: async () => {},
    });
    assert.equal(resumed.status, 'complete');
    assert.equal(store.listCandidates().length, fixtures.length);
    assert.equal(store.listCandidates().filter(candidate => candidate.import.status === 'imported').length, 0);

    const persistedFirst = candidateBySku('pal-home-a');
    assert.equal(persistedFirst.review.status, 'reviewed');
    assert.equal(persistedFirst.review.decisions.length, 1);
    assert.equal(persistedFirst.images[0].match.status, 'approved_match');
    assert.equal(persistedFirst.images[0].authorization.status, 'unknown');
    const persistedPair = store.data.duplicatePairs.find(pair => pair.pairId === possiblePair.pairId);
    assert.equal(persistedPair.reviewed, true);
    assert.equal(persistedPair.outcome, 'same_product');
    assert.ok(store.data.duplicatePairs.some(pair => pair.kind === 'duplicate'));
    assert.ok(store.data.duplicatePairs.some(pair => pair.kind === 'possible_duplicate'));

    const get = sku => candidateBySku(sku);
    assert.equal(get('barcelona-alias').identity.team.canonicalName, 'Barcelona');
    assert.equal(get('city-alias').identity.team.canonicalName, 'Manchester City');
    assert.equal(get('bayern-alias').identity.team.canonicalName, 'Bayern de Munique');
    assert.equal(get('inter-alias').identity.team.canonicalName, 'Inter de Milão');
    assert.equal(get('netherlands-home').identity.team.canonicalName, 'Holanda');
    assert.equal(get('usa-third').identity.team.canonicalName, 'Estados Unidos');
    assert.equal(get('pal-home-a').identity.category.primaryId, 'brasileirao');
    assert.equal(get('madrid-home').identity.category.primaryId, 'laliga');
    assert.equal(get('city-alias').identity.category.primaryId, 'premier');
    assert.equal(get('dortmund-home').identity.category.primaryId, 'bundesliga');
    assert.equal(get('inter-alias').identity.category.primaryId, 'seriea');
    assert.equal(get('marseille-away').identity.category.primaryId, 'ligue1');
    assert.equal(get('brazil-home').identity.category.primaryId, 'selecoes');
    assert.equal(get('ajax-other').identity.category.primaryId, 'outros');
    assert.equal(get('germany-retro').identity.category.primaryId, 'selecoes');
    assert.equal(get('germany-retro').identity.kit.retro, true);
    assert.equal(get('germany-retro').identity.category.additionalClassifications[0], 'retro');
    assert.equal(get('barcelona-retro').identity.category.primaryId, 'laliga');
    assert.equal(get('barcelona-retro').identity.category.additionalClassifications[0], 'retro');

    assert.equal(compareCandidates(get('pal-home-a'), get('pal-away')).kind, 'distinct');
    assert.equal(compareCandidates(get('pal-home-a'), get('pal-home-old')).kind, 'distinct');

    const drafts = store.listCandidates().map((candidate, index) => buildPublicProductDraft(candidate, { id: 10_000 + index }));
    assert.equal(drafts.length, fixtures.length);
    assert.ok(drafts.every(draft => draft.product.preco === 130));
    assert.ok(drafts.every(draft => draft.product.disponibilidade === 'encomenda'));
    const incomplete = drafts.find(draft => draft.sourceRecordId === get('incomplete-unknown').recordId);
    assert.equal(incomplete.review.required, true);
    assert.equal(incomplete.product.temporada, null);
    assert.equal(incomplete.product.versao, null);
    assert.equal(incomplete.product.img, 'img/product-placeholder.svg');
    assert.equal(get('incomplete-unknown').review.status, 'pending');
    assert.equal(get('incomplete-unknown').import.status, 'candidate');
    assert.equal(drafts.find(draft => draft.sourceRecordId === persistedFirst.recordId).review.required, false);
    assert.equal(store.data.errors.length, 0);

    const currentCatalog = await auditCurrentCatalog(root, taxonomy);
    assert.equal(currentCatalog.productCount, 20);
    assert.equal(currentCatalog.missingImageCount, 0);
    assert.equal(createHash('sha256').update(await readFile(productsFile)).digest('hex'), originalProductsHash);

    t.diagnostic(`isolated records=${fixtures.length}; candidates=${store.listCandidates().length}; resumed pages=${resumed.pages}; duplicate pairs=${store.data.duplicatePairs.length}; drafts=${drafts.length}; public products=${currentCatalog.productCount}`);
  } finally {
    await removeIsolatedDirectory(tempDirectory);
    assert.equal(createHash('sha256').update(await readFile(productsFile)).digest('hex'), originalProductsHash);
  }
});
