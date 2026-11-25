import { createHash } from 'node:crypto';
import { normalizeKey } from './taxonomy.mjs';

const TEAM_ALIASES = {
  'atletico madrid': 'Atlético de Madrid',
  'atletico de madrid': 'Atlético de Madrid',
  'man city': 'Manchester City',
  'manchester city fc': 'Manchester City',
  'man utd': 'Manchester United',
  'man united': 'Manchester United',
  'manchester united fc': 'Manchester United',
  'fc barcelona': 'Barcelona',
  'barcelona fc': 'Barcelona',
  'real madrid cf': 'Real Madrid',
  'real madrid fc': 'Real Madrid',
  'arsenal fc': 'Arsenal',
  'chelsea fc': 'Chelsea',
  'liverpool fc': 'Liverpool',
  'juventus fc': 'Juventus',
  'inter': 'Inter de Milão',
  'spurs': 'Tottenham',
  'tottenham hotspur': 'Tottenham',
  'bayern munich': 'Bayern de Munique',
  'fc bayern munich': 'Bayern de Munique',
  'borussia monchengladbach': 'Borussia Mönchengladbach',
  'inter milan': 'Inter de Milão',
  'internazionale': 'Inter de Milão',
  'ac milan': 'Milan',
  'paris saint germain': 'Paris Saint-Germain',
  'psg': 'Paris Saint-Germain',
  'olympique lyonnais': 'Lyon',
  'athletico mineiro': 'Atlético Mineiro',
  'atletico mineiro': 'Atlético Mineiro',
  'sao paulo fc': 'São Paulo',
  'gremio': 'Grêmio',
  'internacional porto alegre': 'Internacional',
  'red bull bragantino': 'Red Bull Bragantino',
  'rb bragantino': 'Red Bull Bragantino',
  'sporting cp': 'Sporting',
  'sporting lisbon': 'Sporting',
  'sporting clube de portugal': 'Sporting',
  'fc porto': 'Porto',
  'sl benfica': 'Benfica',
  'psv eindhoven': 'PSV',
  'al hilal': 'Al-Hilal',
  'al nassr': 'Al-Nassr',
  'river plate': 'River Plate',
  'boca juniors': 'Boca Juniors',
  'united states': 'Estados Unidos',
  'usa': 'Estados Unidos',
  'usmnt': 'Estados Unidos',
  'south korea': 'Coreia do Sul',
  'korea republic': 'Coreia do Sul',
  'ivory coast': 'Costa do Marfim',
  'cote divoire': 'Costa do Marfim',
  'the netherlands': 'Holanda',
  'netherlands': 'Holanda',
  'holland': 'Holanda',
  'czech republic': 'República Tcheca',
  'czechia': 'República Tcheca',
  'wales': 'País de Gales',
  'turkiye': 'Turquia',
  'turkey': 'Turquia',
  'deutschland': 'Alemanha',
  'england national team': 'Inglaterra',
  'brazil': 'Brasil',
  'france': 'França',
  'germany': 'Alemanha',
  'spain': 'Espanha',
  'italy': 'Itália',
  'argentina national team': 'Argentina',
  'portugal national team': 'Portugal',
};

const LEAGUE_ALIASES = new Map(Object.entries({
  'la liga': 'laliga',
  'laliga': 'laliga',
  'premier league': 'premier',
  'english premier league': 'premier',
  'bundesliga': 'bundesliga',
  'serie a': 'seriea',
  'serie a italy': 'seriea',
  'ligue 1': 'ligue1',
  'ligue 1 france': 'ligue1',
  'campeonato brasileiro': 'brasileirao',
  'brasileirao': 'brasileirao',
  'brazilian serie a': 'brasileirao',
  'international': 'selecoes',
  'national teams': 'selecoes',
}).map(([alias, id]) => [normalizeKey(alias), id]));

const VERSION_TERMS = [
  ['third', ['third', 'third kit', '3rd', 'terceira', 'third shirt']],
  ['away', ['away', 'away kit', 'visitor', 'visita', 'visitante', 'fora', 'away shirt']],
  ['home', ['home', 'home kit', 'titular', 'casa', 'primary', 'home shirt']],
  ['special', ['special', 'special edition', 'especial', 'limited edition', 'commemorative']],
];

function containsTerm(text, term) {
  const normalizedText = String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const normalizedTerm = String(term).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const pattern = normalizedTerm.split(/[^a-z0-9]+/).filter(Boolean).join('[^a-z0-9]+');
  return new RegExp(`(^|[^a-z0-9])${pattern}($|[^a-z0-9])`).test(normalizedText);
}

function asText(value) {
  return String(value ?? '').trim();
}

function canonicalLookup(taxonomy) {
  const clubs = new Map();
  for (const [league, teams] of Object.entries(taxonomy.teamsByLeague)) {
    for (const name of teams) clubs.set(normalizeKey(name), { name, league });
  }
  const nations = new Map(taxonomy.nationalTeams.map(name => [normalizeKey(name), name]));
  const aliases = new Map(Object.entries(TEAM_ALIASES).map(([name, canonical]) => [normalizeKey(name), canonical]));
  return { clubs, nations, aliases };
}

export function normalizeTeam(value, taxonomy, declaredKind = '') {
  const displayName = asText(value);
  const key = normalizeKey(displayName);
  const manual = taxonomy.manualTeamAliases?.[key];
  if (manual?.canonicalName) {
    return {
      displayName,
      canonicalName: manual.canonicalName,
      key: normalizeKey(manual.canonicalName),
      kind: manual.kind ?? 'club',
      leagueId: manual.leagueId ?? null,
      country: manual.country ?? null,
      confidence: 'manual',
    };
  }
  const lookup = canonicalLookup(taxonomy);
  const aliasName = lookup.aliases.get(key);
  const normalizedKey = aliasName ? normalizeKey(aliasName) : key;
  const national = lookup.nations.get(normalizedKey);
  const club = lookup.clubs.get(normalizedKey);

  if (national && (declaredKind === 'national_team' || !club)) {
    return { displayName, canonicalName: national, key: normalizedKey, kind: 'national_team', leagueId: null, confidence: aliasName ? 'high' : 'exact' };
  }
  if (club) {
    return { displayName, canonicalName: club.name, key: normalizedKey, kind: 'club', leagueId: club.league, confidence: aliasName ? 'high' : 'exact' };
  }
  if (national) {
    return { displayName, canonicalName: national, key: normalizedKey, kind: 'national_team', leagueId: null, confidence: aliasName ? 'high' : 'exact' };
  }
  return {
    displayName,
    canonicalName: null,
    key,
    kind: declaredKind === 'national_team' ? 'national_team' : declaredKind === 'club' ? 'club' : 'unknown',
    leagueId: null,
    confidence: 'unmatched',
  };
}

function expandShortYear(twoDigits, referenceYear = new Date().getFullYear()) {
  const number = Number(twoDigits);
  const currentCentury = Math.floor(referenceYear / 100) * 100;
  const currentShort = referenceYear % 100;
  return number > currentShort + 35 ? currentCentury - 100 + number : currentCentury + number;
}

export function parseSeason(value, referenceYear = new Date().getFullYear()) {
  const raw = asText(value);
  if (!raw) return { label: null, startYear: null, endYear: null, type: 'unknown', confidence: 'missing' };
  const text = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const range = text.match(/(?<!\d)((?:19|20)\d{2}|\d{2})\s*[/-]\s*((?:19|20)\d{2}|\d{2})(?!\d)/);
  if (range) {
    const startYear = range[1].length === 2 ? expandShortYear(range[1], referenceYear) : Number(range[1]);
    let endYear = range[2].length === 2 ? Math.floor(startYear / 100) * 100 + Number(range[2]) : Number(range[2]);
    if (endYear < startYear) endYear += 100;
    const label = `${startYear}/${String(endYear).slice(-2)}`;
    return { label, startYear, endYear, type: 'season', confidence: range[1].length === 2 ? 'inferred' : 'high' };
  }
  const year = text.match(/(?<!\d)((?:19|20)\d{2})(?!\d)/);
  if (year) return { label: year[1], startYear: Number(year[1]), endYear: null, type: 'year', confidence: 'high' };
  return { label: null, startYear: null, endYear: null, type: 'unparsed', confidence: 'low', raw };
}

export function parseKitVersion(...values) {
  const raw = values.map(asText).filter(Boolean).join(' ');
  const isRetro = /\bretro\b|\bclassic\b|retr[oô]/i.test(raw);
  const edition = /\b(world cup|worldcup|euro\s?\d{2,4}|copa america|centenary|anniversary|commemorative|special edition|limited edition)\b/i.exec(raw)?.[0] ?? null;
  const fit = /\b(player|authentic|match|jogador|torcedor|fan|replica|replica|infantil|kids|junior|goalkeeper|goleiro|training|treino)\b/i.exec(raw)?.[0] ?? null;
  let slot = null;
  let confidence = 'missing';
  for (const [candidate, terms] of VERSION_TERMS) {
    if (terms.some(term => containsTerm(raw, term))) {
      slot = candidate;
      confidence = 'high';
      break;
    }
  }
  return {
    raw: raw || null,
    slot,
    retro: isRetro,
    edition,
    fit,
    confidence,
  };
}

export function normalizeLeague(value) {
  const text = asText(value);
  if (!text) return null;
  const id = LEAGUE_ALIASES.get(normalizeKey(text));
  if (id) return id;
  const key = normalizeKey(text);
  const known = ['brasileirao', 'laliga', 'premier', 'bundesliga', 'seriea', 'ligue1', 'selecoes', 'primeira_liga', 'eredivisie', 'saudi_pro_league', 'campeonato_argentino', 'campeonato_escoces'];
  return known.find(item => normalizeKey(item) === key) ?? (key || null);
}

export function classifyProduct({ team, declaredKind, league, retro = false }, taxonomy) {
  const normalizedTeam = normalizeTeam(team, taxonomy, declaredKind);
  const explicitLeague = normalizeLeague(league);
  const leagueId = explicitLeague || normalizedTeam.leagueId;
  const primaryId = normalizedTeam.kind === 'national_team' || explicitLeague === 'selecoes'
    ? 'selecoes'
    : taxonomy.leaguesWithTabs.includes(leagueId) ? leagueId : 'outros';
  const isRetro = Boolean(retro);
  const reasons = [];
  const knownLeagues = new Set([
    ...taxonomy.leaguesWithTabs,
    ...Object.keys(taxonomy.teamsByLeague),
    'selecoes',
    ...Object.keys(taxonomy.approvedLeagues ?? {}),
  ]);
  if (!normalizedTeam.canonicalName) reasons.push('team_unmatched');
  if (!leagueId && primaryId !== 'selecoes') reasons.push('league_unknown');
  if (league && explicitLeague && !knownLeagues.has(explicitLeague) && primaryId !== 'selecoes') reasons.push('league_unrecognized');
  if (normalizedTeam.leagueId && explicitLeague && normalizedTeam.leagueId !== explicitLeague && normalizedTeam.kind !== 'national_team') {
    reasons.push('team_league_conflict');
  }
  if (normalizedTeam.kind === 'unknown') reasons.push('entity_type_unknown');
  return {
    primaryId,
    leagueId: primaryId === 'selecoes' ? 'selecoes' : leagueId,
    retro: isRetro,
    additionalClassifications: isRetro ? ['retro'] : [],
    confidence: reasons.length ? 'review' : normalizedTeam.confidence,
    reviewReasons: reasons,
    entity: normalizedTeam,
  };
}

export function inferCountry(team, leagueId, explicitCountry, taxonomy) {
  const provided = asText(explicitCountry);
  if (provided) return provided;
  const normalizedTeam = normalizeTeam(team, taxonomy);
  if (normalizedTeam.kind === 'national_team' && normalizedTeam.canonicalName) return normalizedTeam.canonicalName;
  return taxonomy.countriesByLeague[leagueId] ?? null;
}

export function stableId(...parts) {
  return createHash('sha256').update(parts.map(part => String(part ?? '')).join('\u001f')).digest('hex').slice(0, 24);
}
