import { stableId } from './normalization.mjs';

function canonicalUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    const query = [...url.searchParams.entries()]
      .filter(([key]) => !/^(utm_|fbclid|gclid)/i.test(key))
      .sort(([keyA, valueA], [keyB, valueB]) => keyA.localeCompare(keyB) || valueA.localeCompare(valueB));
    const search = new URLSearchParams(query).toString();
    return `${url.origin}${url.pathname.replace(/\/$/, '')}${search ? `?${search}` : ''}`;
  } catch {
    return String(value).trim().replace(/\/$/, '').toLowerCase() || null;
  }
}

function semanticIdentity(candidate) {
  const item = candidate.identity ?? {};
  const team = item.team?.canonicalName ? item.team.key : null;
  const season = item.season?.label;
  const version = item.kit?.slot;
  if (!team || !season || !version) return null;
  return {
    team,
    season,
    version,
    retro: Boolean(item.kit?.retro),
    edition: String(item.kit?.edition ?? '').toLowerCase(),
    model: String(item.model ?? '').toLowerCase(),
  };
}

export function compareCandidates(a, b) {
  if (a.recordId === b.recordId) return { kind: 'same_record', score: 1, reasons: ['same_record_id'] };
  if (a.source?.id && a.source.id === b.source?.id && a.source.externalId && a.source.externalId === b.source?.externalId) {
    return { kind: 'duplicate', score: 1, reasons: ['same_source_external_id'] };
  }
  const aUrl = canonicalUrl(a.source?.productUrl);
  const bUrl = canonicalUrl(b.source?.productUrl);
  if (aUrl && aUrl === bUrl) return { kind: 'duplicate', score: 1, reasons: ['same_product_url'] };

  const first = semanticIdentity(a);
  const second = semanticIdentity(b);
  if (!first || !second) return { kind: 'distinct_or_insufficient_data', score: 0, reasons: ['identity_incomplete'] };
  if (first.team !== second.team || first.season !== second.season || first.version !== second.version || first.retro !== second.retro) {
    return { kind: 'distinct', score: 0, reasons: ['team_season_kit_version_or_retro_status_differs'] };
  }
  const editionSame = first.edition === second.edition;
  const modelSame = first.model === second.model;
  const score = 0.82 + (editionSame ? 0.1 : 0) + (modelSame ? 0.08 : 0);
  return {
    kind: 'possible_duplicate',
    score: Math.min(score, 0.99),
    reasons: [
      'same_team_season_and_kit_version',
      ...(editionSame ? ['same_edition'] : []),
      ...(modelSame ? ['same_model'] : []),
      'manual_review_required',
    ],
  };
}

export function findDuplicatePairs(candidates) {
  const buckets = new Map();
  const add = (key, candidate) => {
    if (!key) return;
    const group = buckets.get(key) ?? [];
    group.push(candidate);
    buckets.set(key, group);
  };
  for (const candidate of candidates) {
    if (candidate.source?.id && candidate.source.externalId) {
      add(`source-id:${candidate.source.id}:${candidate.source.externalId}`, candidate);
    }
    const url = canonicalUrl(candidate.source?.productUrl);
    if (url) add(`product-url:${url}`, candidate);
    const identity = semanticIdentity(candidate);
    if (identity) add(`semantic:${identity.team}:${identity.season}:${identity.version}:${identity.retro}`, candidate);
  }

  const pairs = [];
  const examined = new Set();
  for (const group of buckets.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const first = group[i];
        const second = group[j];
        const [firstId, secondId] = [first.recordId, second.recordId].sort();
        const pairKey = `${firstId}\u001f${secondId}`;
        if (examined.has(pairKey)) continue;
        examined.add(pairKey);
        const result = compareCandidates(first, second);
        if (result.kind === 'duplicate' || result.kind === 'possible_duplicate') {
          pairs.push({
            pairId: `pair_${stableId(firstId, secondId)}`,
            firstId,
            secondId,
            ...result,
            reviewed: false,
          });
        }
      }
    }
  }
  return pairs;
}
