import { classifyProduct, normalizeLeague, parseKitVersion, parseSeason, stableId } from './normalization.mjs';
import { normalizeKey } from './taxonomy.mjs';

export function normalizeCandidate(raw, { source, taxonomy, capturedAt = new Date().toISOString() }) {
  if (!source?.id) throw new TypeError('A origem precisa ter um id estável.');
  const title = String(raw?.name ?? raw?.title ?? '').trim();
  const teamText = String(raw?.team ?? raw?.club ?? raw?.countryTeam ?? '').trim();
  const declaredKind = raw?.entityKind === 'national_team' || raw?.categoria === 'selecao' || raw?.category === 'national_team' ? 'national_team' : raw?.entityKind;
  const season = parseSeason(raw?.season || raw?.temporada || title);
  const kit = parseKitVersion(raw?.version, raw?.versao, title);
  const classification = classifyProduct({
    team: teamText,
    declaredKind,
    league: raw?.league ?? raw?.liga,
    retro: kit.retro,
  }, taxonomy);
  const team = classification.entity;
  const leagueId = classification.leagueId || normalizeLeague(raw?.league ?? raw?.liga);
  const country = raw?.country ?? raw?.pais
    ?? (team.kind === 'national_team' && team.canonicalName
      ? team.canonicalName
      : team.country ?? taxonomy.countriesByLeague[leagueId] ?? taxonomy.countriesByLeague[team.leagueId] ?? null);
  const externalValue = raw?.externalId ?? raw?.sku ?? raw?.id ?? null;
  const externalId = externalValue == null || !String(externalValue).trim() ? null : String(externalValue).trim();
  const urlValue = raw?.productUrl ?? raw?.url ?? null;
  const productUrl = urlValue == null || !String(urlValue).trim() ? null : String(urlValue).trim();
  const stableSourceKey = externalId != null
    ? ['external', externalId]
    : productUrl
      ? ['url', productUrl]
      : ['fingerprint', team.key, season.label, kit.slot, normalizeKey(title)];
  const recordId = `candidate_${stableId(source.id, ...stableSourceKey)}`;
  const sourceImages = Array.isArray(raw?.images) ? raw.images : raw?.image ? [raw.image] : raw?.img ? [raw.img] : [];
  const reviewReasons = [...classification.reviewReasons];
  if (!season.label || season.confidence === 'low') reviewReasons.push('season_missing_or_unparsed');
  if (!kit.slot && !kit.retro) reviewReasons.push('kit_version_unresolved');
  if (!country) reviewReasons.push('country_missing');

  return {
    schemaVersion: 1,
    recordId,
    source: {
      id: source.id,
      name: source.name ?? source.id,
      kind: source.kind ?? 'unknown',
      authorizationStatus: source.authorization?.status ?? (source.kind === 'local_test' ? 'not_applicable' : 'unknown'),
      authorizationEvidence: source.authorization?.evidenceUrl ?? source.authorization?.document ?? null,
      externalId: externalId == null ? null : String(externalId),
      productUrl: productUrl == null ? null : String(productUrl),
      pageUrl: raw?.sourcePageUrl ?? raw?.pageUrl ?? null,
      pageCursor: raw?.sourceCursor ?? null,
      capturedAt,
      licenseReference: source.authorization?.evidenceUrl ?? source.authorization?.document ?? null,
    },
    raw: { ...raw },
    supplierOffer: {
      priceRaw: raw?.price ?? raw?.preco ?? null,
      currency: raw?.currency ?? null,
      availabilityRaw: raw?.availability ?? raw?.stock ?? null,
      sizes: Array.isArray(raw?.sizes) ? [...raw.sizes] : Array.isArray(raw?.tamanhos) ? [...raw.tamanhos] : [],
    },
    identity: {
      team: {
        displayName: team.displayName,
        canonicalName: team.canonicalName,
        key: team.key,
        kind: team.kind,
        country,
        confidence: team.confidence,
      },
      category: classification,
      season,
      kit,
      title,
      normalizedTitle: normalizeKey(title),
      model: raw?.model ?? raw?.fit ?? kit.fit ?? null,
      manufacturer: raw?.manufacturer ?? raw?.brand ?? null,
    },
    images: sourceImages.map((image, index) => normalizeImageReference(image, { source, index, capturedAt })),
    review: {
      status: reviewReasons.length ? 'pending' : 'ready_for_review',
      reasons: [...new Set(reviewReasons)],
      decisions: [],
    },
    import: { status: 'candidate', publicProductId: null },
  };
}

function normalizeImageReference(image, { source, index, capturedAt }) {
  const entry = typeof image === 'string' ? { url: image } : (image ?? {});
  return {
    imageId: `image_${stableId(source.id, entry.url ?? entry.src ?? entry.localPath, index)}`,
    url: entry.url ?? entry.src ?? null,
    localPath: entry.localPath ?? (typeof image === 'string' && !/^https?:\/\//i.test(image) ? image : null),
    fileName: entry.fileName ?? entry.name ?? null,
    team: entry.team ?? entry.club ?? entry.countryTeam ?? null,
    entityKind: entry.entityKind ?? null,
    season: entry.season ?? entry.temporada ?? null,
    version: entry.version ?? entry.versao ?? null,
    model: entry.model ?? entry.fit ?? null,
    angle: ['front', 'back', 'detail', 'unknown'].includes(entry.angle) ? entry.angle : 'unknown',
    ...(entry.downloadError ? { downloadError: entry.downloadError } : {}),
    source: entry.source ?? source.name ?? source.id,
    capturedAt,
    authorization: {
      status: entry.authorization?.status ?? 'unknown',
      evidenceUrl: entry.authorization?.evidenceUrl ?? null,
      evidenceNote: entry.authorization?.evidenceNote ?? null,
    },
    match: { status: 'unmatched', score: 0, reasons: [] },
  };
}
