import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';

export async function loadStoreTaxonomy(root = process.cwd()) {
  const filename = path.join(root, 'catalogo-config.js');
  const source = await readFile(filename, 'utf8');
  const context = vm.createContext({});
  const result = vm.runInContext(
    `${source}\n;({\n` +
      `categories: CATEGORIAS_CATALOGO,\n` +
      `leaguesWithTabs: [...LIGAS_COM_ABA],\n` +
      `teamsByLeague: TIMES_POR_LIGA,\n` +
      `nationalTeams: SELECOES_POSSIVEIS,\n` +
      `countriesByLeague: PAIS_POR_LIGA\n` +
    `})`,
    context,
    { filename },
  );

  return {
    categories: Array.from(result.categories, item => ({ id: item.id, label: item.label })),
    leaguesWithTabs: Array.from(result.leaguesWithTabs),
    teamsByLeague: Object.fromEntries(
      Object.entries(result.teamsByLeague).map(([league, teams]) => [league, Array.from(teams)]),
    ),
    nationalTeams: Array.from(result.nationalTeams),
    countriesByLeague: { ...result.countriesByLeague },
  };
}

export function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]/g, '');
}

export function withManualTeamAliases(taxonomy, aliases = {}, approvedLeagues = {}) {
  return {
    ...taxonomy,
    manualTeamAliases: { ...aliases },
    approvedLeagues: { ...approvedLeagues },
  };
}
