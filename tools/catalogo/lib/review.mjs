import { classifyProduct, inferCountry, normalizeLeague, normalizeTeam, parseKitVersion, parseSeason } from './normalization.mjs';
import { normalizeKey } from './taxonomy.mjs';

const REVIEW_FIELDS = new Set(['team', 'canonicalTeam', 'aliases', 'replaceAlias', 'league', 'country', 'season', 'version', 'retro']);

export function resolveCandidateReview(candidate, decision, taxonomy) {
  const reviewer = String(decision?.reviewer ?? '').trim();
  if (!reviewer) throw new TypeError('Informe quem fez a revisão.');
  const requestedFields = Object.keys(decision).filter(field => REVIEW_FIELDS.has(field));
  if (!requestedFields.length) throw new TypeError('A decisão precisa resolver team, league, season ou version.');

  const updated = structuredClone(candidate);
  if (decision.aliases !== undefined && (!Array.isArray(decision.aliases) || decision.aliases.some(alias => !String(alias).trim()))) {
    throw new TypeError('aliases precisa ser uma lista de nomes não vazios.');
  }
  const item = updated.identity;
  const resolvedReasons = new Set();

  if (decision.team) {
    let team = normalizeTeam(decision.team, taxonomy, decision.entityKind ?? item.team.kind);
    if (decision.canonicalTeam) {
      const canonicalName = String(decision.canonicalTeam).trim();
      if (!canonicalName) throw new TypeError('canonicalTeam não pode ficar vazio.');
      const kind = decision.entityKind ?? (team.kind !== 'unknown' ? team.kind : item.team.kind === 'national_team' ? 'national_team' : 'club');
      team = {
        displayName: String(decision.team).trim(),
        canonicalName,
        key: normalizeKey(canonicalName),
        kind,
        leagueId: kind === 'club' ? normalizeLeague(decision.league ?? item.category.leagueId) ?? team.leagueId : null,
        country: decision.country ?? team.country ?? null,
        confidence: 'manual',
      };
    }
    if (!team.canonicalName) throw new Error(`Equipe ou seleção não reconhecida: ${decision.team}`);
    item.team = { ...team, country: decision.country ?? item.team.country };
    resolvedReasons.add('team_unmatched');
    resolvedReasons.add('entity_type_unknown');
  }
  if (decision.league) {
    const leagueId = normalizeLeague(decision.league);
    if (!leagueId) throw new Error(`Liga não reconhecida: ${decision.league}`);
    item.category.leagueId = leagueId;
    resolvedReasons.add('league_unknown');
    resolvedReasons.add('league_unrecognized');
    resolvedReasons.add('team_league_conflict');
  }
  if (decision.country) {
    item.team.country = String(decision.country).trim();
    if (!item.team.country) throw new TypeError('País não pode ficar vazio.');
    resolvedReasons.add('country_missing');
  }
  if (decision.season) {
    const season = parseSeason(decision.season);
    if (!season.label || season.confidence === 'low') throw new Error(`Temporada não reconhecida: ${decision.season}`);
    item.season = season;
    resolvedReasons.add('season_missing_or_unparsed');
  }
  if (decision.version) {
    const kit = parseKitVersion(decision.version);
    if (!kit.slot && !kit.retro) throw new Error(`Versão não reconhecida: ${decision.version}`);
    if (decision.retro !== undefined) kit.retro = Boolean(decision.retro);
    else kit.retro ||= item.kit.retro;
    item.kit = kit;
    resolvedReasons.add('kit_version_unresolved');
  }
  if (decision.retro !== undefined) item.kit.retro = Boolean(decision.retro);

  const classification = classifyProduct({
    team: item.team.canonicalName ?? item.team.displayName,
    declaredKind: item.team.kind,
    league: decision.league ?? item.category.leagueId,
    retro: item.kit.retro,
  }, taxonomy);
  const manualTeam = Boolean(decision.team && decision.canonicalTeam);
  const classificationReasons = classification.reviewReasons.filter(reason => {
    if (decision.league && ['team_league_conflict', 'league_unrecognized'].includes(reason)) return false;
    if (manualTeam && ['team_unmatched', 'entity_type_unknown'].includes(reason)) return false;
    return true;
  });
  item.category = {
    ...classification,
    entity: item.team,
    reviewReasons: classificationReasons,
    confidence: classificationReasons.length ? 'review' : requestedFields.length ? 'manual' : classification.confidence,
  };
  item.team.country = item.team.country
    ?? inferCountry(item.team.canonicalName ?? item.team.displayName, classification.leagueId, decision.country, taxonomy);
  if (item.team.country) resolvedReasons.add('country_missing');

  const unresolved = new Set(updated.review.reasons.filter(reason => !resolvedReasons.has(reason)));
  for (const reason of classificationReasons) unresolved.add(reason);
  if (!item.season.label || item.season.confidence === 'low') unresolved.add('season_missing_or_unparsed');
  if (!item.kit.slot && !item.kit.retro) unresolved.add('kit_version_unresolved');
  if (!item.team.country) unresolved.add('country_missing');
  updated.review.reasons = [...unresolved];
  updated.review.status = unresolved.size ? 'pending' : 'reviewed';
  if (updated.review.status === 'pending') item.category.confidence = 'review';
  else if (requestedFields.length && !item.category.reviewReasons.length) item.category.confidence = 'manual';
  updated.review.decisions.push({
    reviewer,
    decidedAt: decision.decidedAt ?? new Date().toISOString(),
    fields: Object.fromEntries(requestedFields.map(field => [field, decision[field]])),
    note: decision.note ?? null,
  });
  return updated;
}

export function resolveDuplicatePair(pair, decision) {
  const reviewer = String(decision?.reviewer ?? '').trim();
  if (!reviewer) throw new TypeError('Informe quem revisou o par.');
  if (!['same_product', 'different_products'].includes(decision.outcome)) {
    throw new TypeError('outcome deve ser same_product ou different_products.');
  }
  return {
    ...structuredClone(pair),
    reviewed: true,
    outcome: decision.outcome,
    reviewDecision: {
      reviewer,
      decidedAt: decision.decidedAt ?? new Date().toISOString(),
      note: decision.note ?? null,
    },
  };
}

export function recordImageReview(imageReference, decision) {
  const reviewer = String(decision?.reviewer ?? '').trim();
  if (!reviewer) throw new TypeError('Informe quem revisou a correspondência da imagem.');
  if (!['approved_match', 'rejected_match'].includes(decision.outcome)) {
    throw new TypeError('outcome deve ser approved_match ou rejected_match.');
  }
  const updated = structuredClone(imageReference);
  updated.match = {
    ...updated.match,
    status: decision.outcome,
    reviewedBy: reviewer,
    reviewedAt: decision.decidedAt ?? new Date().toISOString(),
    reviewNote: decision.note ?? null,
  };
  return updated;
}
