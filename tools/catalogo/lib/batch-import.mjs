import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertImageProcessingAllowed } from './images.mjs';

const VERSION_LABEL = { home: 'Casa', away: 'Fora', third: 'Terceira', special: 'Especial' };

export function buildPublicProductDraft(candidate, { id, imageReference = null } = {}) {
  if (!Number.isInteger(id) || id < 1) throw new TypeError('Informe um id numérico disponível para o rascunho.');
  const identity = candidate.identity;
  const team = identity.team.canonicalName;
  const isSelection = identity.team.kind === 'national_team' || identity.category.primaryId === 'selecoes';
  let chosenImage = null;
  let imagePath = 'img/product-placeholder.svg';
  if (imageReference) {
    chosenImage = imageReference.reference
      ? {
        ...imageReference.reference,
        match: imageReference.match,
        authorization: imageReference.authorization ?? imageReference.reference.authorization,
      }
      : imageReference;
    if (!['strong_candidate', 'approved_match'].includes(chosenImage.match?.status)) {
      throw new Error('A imagem precisa ter uma correspondência confirmada por equipe, temporada e versão antes de entrar no rascunho.');
    }
    assertImageProcessingAllowed(chosenImage);
    if (!chosenImage.localPath) throw new Error('A imagem autorizada ainda não possui um caminho local; URL externa não será usada como hotlink.');
    const candidatePath = String(chosenImage.localPath);
    const normalizedPath = path.normalize(candidatePath).replace(/\\/g, '/');
    if (path.isAbsolute(candidatePath) || /^[a-z][a-z0-9+.-]*:/i.test(candidatePath) || normalizedPath === '..' || normalizedPath.startsWith('../')) {
      throw new Error('O caminho da imagem precisa ser relativo e permanecer dentro dos arquivos locais da loja.');
    }
    imagePath = normalizedPath;
  }
  const version = identity.kit.slot ? VERSION_LABEL[identity.kit.slot] : identity.kit.retro ? 'Retrô' : null;
  const season = identity.season.label;
  const publicName = identity.title || `Camisa${version ? ` ${version}` : ''}${identity.kit.retro && season ? ` Retrô ${season}` : ''}`;
  const needsReview = candidate.review.status !== 'reviewed' || !team || !identity.team.country || !identity.category.leagueId || !season || !version;

  return {
    sourceRecordId: candidate.recordId,
    product: {
      id,
      time: team ?? identity.team.displayName,
      categoria: isSelection ? 'selecao' : 'clube',
      liga: identity.category.primaryId === 'selecoes' ? 'selecoes' : identity.category.leagueId,
      pais: identity.team.country ?? null,
      temporada: season,
      versao: version,
      nome: publicName,
      preco: 130,
      disponibilidade: 'encomenda',
      tamanhos: [],
      img: imagePath,
      imgs: [imagePath],
      ...(identity.category.additionalClassifications.length
        ? { classificacoes: [...identity.category.additionalClassifications] }
        : {}),
    },
    review: {
      required: needsReview,
      reasons: candidate.review.reasons,
      additionalClassifications: identity.category.additionalClassifications,
      imageAuthorizationStatus: chosenImage?.authorization?.status ?? 'not_selected',
    },
  };
}

export async function exportBatchDrafts(candidates, { filename, firstId = 1000 } = {}) {
  if (!filename) throw new TypeError('Informe um caminho de saída separado do catálogo público.');
  const allowedRoot = path.resolve(process.cwd(), 'data', 'catalogo-local') + path.sep;
  const resolvedFilename = path.resolve(filename);
  if (!resolvedFilename.toLowerCase().startsWith(allowedRoot.toLowerCase())) {
    throw new Error('Rascunhos só podem ser exportados dentro de data/catalogo-local/.');
  }
  const drafts = candidates.map((candidate, index) => buildPublicProductDraft(candidate, { id: firstId + index }));
  await mkdir(path.dirname(resolvedFilename), { recursive: true });
  await writeFile(resolvedFilename, `${JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), drafts }, null, 2)}\n`, 'utf8');
  return drafts;
}
