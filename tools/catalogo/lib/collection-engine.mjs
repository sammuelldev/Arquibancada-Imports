import { normalizeCandidate } from './candidate.mjs';
import { findDuplicatePairs } from './duplicates.mjs';

export function assertSourceAllowed(source) {
  if (!source?.id || typeof source.fetchPage !== 'function') throw new TypeError('Fonte inválida: id e fetchPage são obrigatórios.');
  if (source.kind === 'local_test' && source.localOnly === true) return;
  const authorization = source.authorization;
  if (authorization?.status !== 'approved' || !(authorization.evidenceUrl || authorization.document)) {
    throw new Error(`Coleta bloqueada para "${source.id}": falta autorização documentada da fonte.`);
  }
  if (source.kind === 'public_web' && authorization.robotsStatus !== 'allowed') {
    throw new Error(`Coleta bloqueada para "${source.id}": permissão em robots.txt não está confirmada como allowed.`);
  }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const cursorKey = cursor => cursor == null ? '__START__' : JSON.stringify(cursor);

export async function collectPages({
  source,
  store,
  taxonomy,
  config = {},
  sleep = wait,
  now = () => Date.now(),
  signal,
}) {
  assertSourceAllowed(source);
  const options = {
    maxRequests: 20,
    minIntervalMs: 1000,
    maxRetries: 2,
    ...config,
  };
  const activeTaxonomy = store.taxonomyWithManualAliases?.(taxonomy) ?? taxonomy;
  const prior = config.resume === false ? {} : store.getCollectionState(source.id) ?? {};
  if (prior.done) return { status: 'complete', pages: 0, requests: 0, products: 0, cursor: null };
  let cursor = prior.cursor ?? null;
  let pageCount = prior.pageCount ?? 0;
  let seenCursors = new Set(prior.seenCursors ?? []);
  const runStartCount = pageCount;
  let requests = 0;
  let products = 0;
  let lastRequestAt = null;
  let status = 'paused';

  while (requests < options.maxRequests) {
    if (signal?.aborted) {
      status = 'paused';
      break;
    }
    const currentKey = cursorKey(cursor);
    if (seenCursors.has(currentKey)) {
      await store.logError({ sourceId: source.id, cursor, code: 'repeated_cursor', message: 'A paginação retornou um cursor já visitado; coleta interrompida para evitar loop.' });
      status = 'error';
      break;
    }
    let page;
    let attempt = 0;
    while (true) {
      if (requests >= options.maxRequests) break;
      if (lastRequestAt != null) {
        const delay = Math.max(0, options.minIntervalMs - (now() - lastRequestAt));
        if (delay) await sleep(delay);
      }
      requests += 1;
      lastRequestAt = now();
      try {
        page = await source.fetchPage({ cursor, signal });
        if (!page || !Array.isArray(page.items)) throw new TypeError('fetchPage deve retornar { items: [], nextCursor }.');
        break;
      } catch (error) {
        const retryable = error?.retryable === true || [408, 429, 500, 502, 503, 504].includes(error?.status);
        await store.logError({ sourceId: source.id, cursor, attempt, code: error?.code ?? 'page_fetch_failed', message: String(error?.message ?? error) });
        if (!retryable || attempt >= options.maxRetries) {
          status = 'error';
          break;
        }
        if (requests >= options.maxRequests) {
          status = 'paused';
          break;
        }
        attempt += 1;
        const retryAfter = Number(error?.retryAfterMs);
        const backoff = Number.isFinite(retryAfter) ? Math.max(0, retryAfter) : Math.min(30_000, 500 * (2 ** (attempt - 1)));
        await sleep(backoff);
      }
    }
    if (!page) break;

    let candidates;
    try {
      candidates = page.items.map(item => {
        const mapped = source.mapItem ? source.mapItem(item) : item;
        if (!mapped || typeof mapped !== 'object' || Array.isArray(mapped)) {
          throw new TypeError('Cada item precisa ser um objeto de produto.');
        }
        return normalizeCandidate({
          ...mapped,
          sourcePageUrl: mapped.sourcePageUrl ?? page.pageUrl ?? null,
          sourceCursor: mapped.sourceCursor ?? cursor,
      }, { source, taxonomy: activeTaxonomy, capturedAt: new Date(now()).toISOString() });
      });
    } catch (error) {
      await store.logError({ sourceId: source.id, cursor, code: 'page_transform_failed', message: String(error?.message ?? error) });
      await store.saveCollectionState(source.id, { cursor, pageCount, seenCursors: [...seenCursors], done: false, sourceKind: source.kind, lastPageUrl: page.pageUrl ?? null });
      status = 'error';
      break;
    }
    seenCursors.add(currentKey);
    await store.upsertCandidates(candidates);
    products += candidates.length;
    pageCount += 1;
    const nextCursor = page.nextCursor ?? null;
    const done = nextCursor == null;
    const nextKey = cursorKey(nextCursor);
    if (!done && seenCursors.has(nextKey)) {
      await store.logError({ sourceId: source.id, cursor: nextCursor, code: 'repeated_next_cursor', message: 'A paginação retornou um cursor já visitado; coleta interrompida para evitar loop.' });
      status = 'error';
      await store.saveCollectionState(source.id, { cursor, pageCount, seenCursors: [...seenCursors], done: false, sourceKind: source.kind });
      break;
    }
    cursor = nextCursor;
    await store.saveCollectionState(source.id, { cursor, pageCount, seenCursors: [...seenCursors], done, sourceKind: source.kind, lastPageUrl: page.pageUrl ?? null });
    await store.setDuplicatePairs(findDuplicatePairs(store.listCandidates()));
    if (done) {
      status = 'complete';
      break;
    }
    if (requests >= options.maxRequests) {
      status = 'paused';
      break;
    }
  }

  if (pageCount === runStartCount && status === 'paused' && requests >= options.maxRequests) {
    await store.saveCollectionState(source.id, { cursor, pageCount, seenCursors: [...seenCursors], done: false, sourceKind: source.kind });
  }
  return { status, pages: pageCount - runStartCount, requests, products, cursor };
}
