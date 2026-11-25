import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { recordImageReview, resolveCandidateReview, resolveDuplicatePair } from './review.mjs';
import { findDuplicatePairs } from './duplicates.mjs';
import { normalizeKey, withManualTeamAliases } from './taxonomy.mjs';

const EMPTY_DB = () => ({
  schemaVersion: 1,
  updatedAt: null,
  candidates: {},
  collectionStates: {},
  errors: [],
  duplicatePairs: [],
  teamAliases: {},
  approvedLeagues: {},
});

export class JsonCatalogStore {
  constructor(filename = path.join(process.cwd(), 'data', 'catalogo-local', 'state.json')) {
    this.filename = filename;
    this.data = null;
  }

  async open() {
    try {
      const parsed = JSON.parse(await readFile(this.filename, 'utf8'));
      this.data = { ...EMPTY_DB(), ...parsed };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.data = EMPTY_DB();
    }
    return this;
  }

  async save() {
    if (!this.data) throw new Error('Abra o armazenamento antes de salvar.');
    this.data.updatedAt = new Date().toISOString();
    await mkdir(path.dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    await rename(temporary, this.filename);
  }

  listCandidates() { return Object.values(this.data.candidates); }
  listCandidateReviewQueue() {
    return this.listCandidates().filter(candidate => ['pending', 'ready_for_review'].includes(candidate.review.status));
  }
  listDuplicateReviewQueue() { return this.data.duplicatePairs.filter(pair => !pair.reviewed); }
  taxonomyWithManualAliases(taxonomy) {
    return withManualTeamAliases(taxonomy, this.data.teamAliases, this.data.approvedLeagues);
  }
  listImageReviewQueue() {
    return this.listCandidates().flatMap(candidate => candidate.images
      .filter(image => image.match.status !== 'unmatched' && !image.match.reviewedBy)
      .map(image => ({ recordId: candidate.recordId, image })));
  }
  getCollectionState(sourceId) { return this.data.collectionStates[sourceId] ?? null; }

  async upsertCandidates(candidates) {
    for (const candidate of candidates) this.data.candidates[candidate.recordId] = candidate;
    await this.save();
  }

  async saveCollectionState(sourceId, state) {
    this.data.collectionStates[sourceId] = { ...state, savedAt: new Date().toISOString() };
    await this.save();
  }

  async logError(entry) {
    this.data.errors.push({ at: new Date().toISOString(), ...entry });
    await this.save();
  }

  async setDuplicatePairs(pairs) {
    const prior = new Map(this.data.duplicatePairs.map(pair => [pair.pairId, pair]));
    this.data.duplicatePairs = pairs.map(pair => {
      const existing = prior.get(pair.pairId);
      return existing?.reviewed ? { ...pair, reviewed: true, outcome: existing.outcome, reviewDecision: existing.reviewDecision } : pair;
    });
    await this.save();
  }

  async recordCandidateReview(recordId, decision, taxonomy) {
    const candidate = this.data.candidates[recordId];
    if (!candidate) throw new Error(`Candidato não encontrado: ${recordId}`);
    const activeTaxonomy = this.taxonomyWithManualAliases(taxonomy);
    const updated = resolveCandidateReview(candidate, decision, activeTaxonomy);
    if (decision.canonicalTeam && decision.team) {
      const aliasEntries = [decision.team, ...(decision.aliases ?? [])].map(alias => ({
        alias,
        canonicalName: decision.canonicalTeam,
        kind: updated.identity.team.kind,
        leagueId: null,
        country: updated.identity.team.country,
        reviewer: decision.reviewer,
        updatedAt: decision.decidedAt ?? new Date().toISOString(),
      }));
      const normalizedKeys = aliasEntries.map(entry => normalizeKey(entry.alias));
      for (let index = 0; index < aliasEntries.length; index += 1) {
        if (!normalizedKeys[index]) throw new TypeError('Os aliases precisam conter letras ou números.');
        const existing = this.data.teamAliases[normalizedKeys[index]];
        if (existing && normalizeKey(existing.canonicalName) !== normalizeKey(aliasEntries[index].canonicalName) && decision.replaceAlias !== true) {
          throw new Error(`Alias já vinculado a outra equipe: ${aliasEntries[index].alias}`);
        }
      }
      for (let index = 0; index < aliasEntries.length; index += 1) {
        this.data.teamAliases[normalizedKeys[index]] = aliasEntries[index];
      }
    }
    if (decision.league) {
      const leagueId = updated.identity.category.leagueId;
      const knownLeagues = new Set([
        ...activeTaxonomy.leaguesWithTabs,
        ...Object.keys(activeTaxonomy.teamsByLeague),
        'selecoes',
        ...Object.keys(activeTaxonomy.approvedLeagues),
      ]);
      if (leagueId && !knownLeagues.has(leagueId)) {
        this.data.approvedLeagues[leagueId] = {
          label: String(decision.league).trim(),
          reviewer: decision.reviewer,
          updatedAt: decision.decidedAt ?? new Date().toISOString(),
        };
      }
    }
    this.data.candidates[recordId] = updated;
    await this.setDuplicatePairs(findDuplicatePairs(this.listCandidates()));
    return this.data.candidates[recordId];
  }

  async recordDuplicateReview(pairId, decision) {
    const index = this.data.duplicatePairs.findIndex(pair => pair.pairId === pairId);
    if (index < 0) throw new Error(`Par de duplicados não encontrado: ${pairId}`);
    this.data.duplicatePairs[index] = resolveDuplicatePair(this.data.duplicatePairs[index], decision);
    await this.save();
    return this.data.duplicatePairs[index];
  }

  async recordImageReview(recordId, imageId, decision) {
    const candidate = this.data.candidates[recordId];
    if (!candidate) throw new Error(`Candidato não encontrado: ${recordId}`);
    const index = candidate.images.findIndex(image => image.imageId === imageId);
    if (index < 0) throw new Error(`Referência de imagem não encontrada: ${imageId}`);
    candidate.images[index] = recordImageReview(candidate.images[index], decision);
    await this.save();
    return candidate.images[index];
  }

  async saveImageMatch(recordId, imageId, match) {
    const candidate = this.data.candidates[recordId];
    if (!candidate) throw new Error(`Candidato não encontrado: ${recordId}`);
    const image = candidate.images.find(entry => entry.imageId === imageId);
    if (!image) throw new Error(`Referência de imagem não encontrada: ${imageId}`);
    image.match = { ...image.match, ...match };
    await this.save();
    return image;
  }
}
