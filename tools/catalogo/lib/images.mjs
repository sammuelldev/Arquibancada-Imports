import path from 'node:path';
import { normalizeTeam, parseKitVersion, parseSeason } from './normalization.mjs';
import { normalizeKey } from './taxonomy.mjs';

function referenceIdentity(reference, taxonomy) {
  const label = reference.fileName ?? reference.name ?? reference.url ?? reference.localPath ?? '';
  let teamValue = reference.team ?? reference.club ?? reference.countryTeam ?? null;
  if (!teamValue) {
    const key = normalizeKey(label);
    const names = [...taxonomy.nationalTeams, ...Object.values(taxonomy.teamsByLeague).flat()]
      .sort((a, b) => normalizeKey(b).length - normalizeKey(a).length);
    teamValue = names.find(name => key.includes(normalizeKey(name))) ?? null;
  }
  const team = normalizeTeam(teamValue, taxonomy, reference.entityKind);
  const season = parseSeason(reference.season ?? label);
  const kit = parseKitVersion(reference.version, reference.versao, label);
  const basename = path.basename(String(label));
  if (!kit.slot && /(^|[^a-z0-9])(titular|home|casa)([^a-z0-9]|$)/.test(basename.toLowerCase())) kit.slot = 'home';
  if (!kit.slot && /(^|[^a-z0-9])(away|fora|visitor|visitante)([^a-z0-9]|$)/.test(basename.toLowerCase())) kit.slot = 'away';
  if (!kit.slot && /(^|[^a-z0-9])(third|terceira|3rd)([^a-z0-9]|$)/.test(basename.toLowerCase())) kit.slot = 'third';
  return { team, season, kit, label };
}

export function scoreImageMatch(product, imageReference, taxonomy) {
  const image = referenceIdentity(imageReference, taxonomy);
  const productTeam = product.identity?.team;
  const productSeason = product.identity?.season;
  const productKit = product.identity?.kit;
  const reasons = [];
  let score = 0;
  if (productTeam?.key && image.team.key && productTeam.key === image.team.key && productTeam.canonicalName) {
    score += 50;
    reasons.push('team_exact');
  } else {
    return { score: 0, status: 'unmatched', reasons: ['team_not_confirmed'] };
  }
  if (productSeason?.label && image.season.label && productSeason.label === image.season.label) {
    score += 30;
    reasons.push('season_exact');
  } else if (!image.season.label || !productSeason?.label) {
    score += 5;
    reasons.push('season_missing');
  } else {
    return { score: 0, status: 'unmatched', reasons: ['season_differs'] };
  }
  if (productKit?.slot && image.kit.slot && productKit.slot === image.kit.slot) {
    score += 15;
    reasons.push('kit_version_exact');
  } else if (productKit?.retro && image.kit.retro && productKit.slot === image.kit.slot) {
    score += 15;
    reasons.push('retro_marker_exact');
  } else if (!productKit?.slot || !image.kit.slot) {
    score += 5;
    reasons.push('kit_version_missing');
  } else {
    return { score: 0, status: 'unmatched', reasons: ['kit_version_differs'] };
  }
  const exact = score === 95 || score === 100;
  const status = exact ? 'strong_candidate' : score >= 55 ? 'needs_review' : 'weak_candidate';
  return { score, status, reasons, exactIdentityFields: reasons.filter(item => item.endsWith('_exact')) };
}

export function rankImageAssociations(product, references, taxonomy) {
  return references.map(reference => {
    let match = scoreImageMatch(product, reference, taxonomy);
    if (reference.match?.reviewedBy && reference.match.status === 'rejected_match') {
      match = { ...match, status: 'rejected_match', reasons: [...match.reasons, 'manually_rejected'] };
    } else if (reference.match?.reviewedBy && reference.match.status === 'approved_match') {
      match = { ...match, status: 'strong_candidate', reasons: [...match.reasons, 'manually_approved'] };
    }
    const authorization = reference.authorization ?? { status: 'unknown' };
    return {
      reference,
      match,
      authorization,
      canUseInStore: match.status === 'strong_candidate'
        && authorization.status === 'authorized'
        && Boolean(authorization.evidenceUrl || authorization.evidenceNote)
        && Boolean(reference.localPath),
      requiresHumanReview: match.status !== 'rejected_match' && (match.status !== 'strong_candidate'
        || authorization.status !== 'authorized'
        || !(authorization.evidenceUrl || authorization.evidenceNote)
        || !reference.localPath),
    };
  }).filter(item => item.match.status !== 'unmatched')
    .sort((a, b) => b.match.score - a.match.score);
}

export function assertImageProcessingAllowed(reference) {
  const authorization = reference.authorization;
  if (authorization?.status !== 'authorized' || !(authorization.evidenceUrl || authorization.evidenceNote)) {
    throw new Error('Imagem recusada: autorização documentada é obrigatória antes de copiar, converter ou incorporar o arquivo.');
  }
}
