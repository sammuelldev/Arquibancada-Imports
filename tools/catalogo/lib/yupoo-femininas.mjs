import { CATEGORY_URL, CATALOG_ID } from '../../../catalogo-femininas.mjs';
import { classifyProduct, normalizeTeam, parseKitVersion, parseSeason } from './normalization.mjs';

const source = new URL(CATEGORY_URL);
const labels = { home: 'Titular', away: 'Visitante', third: 'Terceiro uniforme', special: 'Edição especial' };
const views = { front: 'Vista frontal da camisa', back: 'Costas da camisa', side: 'Vista lateral da camisa',
  collar: 'Detalhe da gola', crest: 'Detalhe do escudo', fabric: 'Detalhe do tecido', print: 'Detalhe da estampa',
  detail: 'Detalhe da camisa' };
const translatedViews = { 'front view': views.front, front: views.front, back: views.back, 'back view': views.back,
  'side view': views.side, 'collar detail': views.collar, 'crest detail': views.crest, 'fabric detail': views.fabric };
const trim = s => typeof s === 'string' ? s.trim() : '';
const useful = s => /\p{L}{2}/u.test(trim(s)) && !/^(IMG|DSC|PXL|微信图片)[-_\d.]+/i.test(s);
const fold = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const articles = { Arsenal: 'do', Palmeiras: 'do', Juventus: 'da', Roma: 'da', França: 'da', Espanha: 'da',
  Alemanha: 'da', Inglaterra: 'da', Itália: 'da', Argentina: 'da', Holanda: 'da', Brasil: 'do', Portugal: 'de' };

export function albumId(url) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/albums\/(\d+)\/?$/);
  if (parsed.origin !== source.origin || !match) throw new Error('Álbum fora da Rainha JIN: ' + url);
  return match[1];
}

function pageNumber(url) {
  const page = new URL(url);
  if (page.origin !== source.origin || page.pathname.replace(/\/$/, '') !== source.pathname ||
      [...page.searchParams.keys()].some(key => key !== 'page') || page.searchParams.getAll('page').length > 1) {
    throw new Error('Página fora da seção Femininas: ' + url);
  }
  const value = page.searchParams.get('page') ?? '1';
  if (!/^[1-9]\d*$/.test(value)) throw new Error('Número de página inválido');
  return Number(value);
}

// Follow the exported category pagination; unrelated albums in a supplier export never enter the queue.
export function inventory(input) {
  if (input.categoryUrl !== CATEGORY_URL || !Array.isArray(input.pages) || !input.pages.length) {
    throw new Error('A exportação precisa começar na categoria feminina 5070410.');
  }
  const pages = new Map();
  for (const page of input.pages) {
    const number = pageNumber(page.url);
    if (pages.has(number)) throw new Error('Página repetida: ' + number);
    pages.set(number, page);
  }
  const albums = new Map();
  for (const album of input.albums ?? []) {
    const id = albumId(album.url);
    if (albums.has(id)) throw new Error('Álbum repetido na exportação: ' + id);
    albums.set(id, album);
  }
  const ids = new Set();
  let number = 1;
  for (;;) {
    const page = pages.get(number);
    if (!page) return { ids: [...ids], albums, missingPage: number };
    if (!Array.isArray(page.albumUrls) || !Object.hasOwn(page, 'nextPageUrl')) throw new Error('Página incompleta: ' + number);
    for (const url of page.albumUrls) ids.add(albumId(url));
    if (page.nextPageUrl === null) break;
    if (pageNumber(page.nextPageUrl) !== number + 1) throw new Error('Paginação descontínua na página ' + number);
    number++;
  }
  if (pages.size !== number) throw new Error('Existem páginas desconectadas da categoria.');
  return { ids: [...ids], albums, missingPage: null };
}

function findTeam(text, taxonomy) {
  const words = fold(text).split(' ');
  const matches = new Map();
  for (let start = 0; start < words.length; start++) {
    for (let size = Math.min(5, words.length - start); size > 0; size--) {
      const candidate = normalizeTeam(words.slice(start, start + size).join(' '), taxonomy);
      if (candidate.canonicalName) {
        matches.set(candidate.canonicalName, candidate);
        start += size - 1;
        break;
      }
    }
  }
  return matches.size === 1 ? [...matches.values()][0].canonicalName : '';
}

function identify(model, originals, taxonomy) {
  const text = originals.join(' ');
  const team = Object.hasOwn(model, 'time') ? trim(model.time) : findTeam(text, taxonomy);
  const category = classifyProduct({ team, league: model.liga, declaredKind: model.selecao ? 'national_team' : '' }, taxonomy);
  const normalized = normalizeTeam(team, taxonomy, model.selecao ? 'national_team' : '');
  const name = normalized.canonicalName || team;
  const isNational = Boolean(model.selecao || category.primaryId === 'selecoes');
  const kit = parseKitVersion(text);
  const uniforme = trim(model.modelo) || labels[kit.slot] || '';
  const season = trim(model.temporada) || parseSeason(text).label || '';
  const version = trim(model.versao) || (/\b(fan|torcedor)\b/i.test(text) ? 'Versão torcedor' : /\b(player|jogador)\b/i.test(text) ? 'Versão jogador' : '');
  const retro = model.retro ?? kit.retro;
  const base = name ? 'Camisa feminina ' + (articles[name] ? articles[name] + ' ' : '– ') + name : 'Camisa feminina';
  const suffix = [retro ? 'Retrô' : '', uniforme, season, version, trim(model.cor), trim(model.edicao)].filter(Boolean).join(' ');
  const ptTitle = /^camisa feminina\b/i.test(trim(model.title)) ? model.title.trim() : '';
  const nome = trim(model.nome) || ptTitle || (suffix ? base + ' – ' + suffix : base);
  return { nome, time: name, selecao: isNational ? name : '', categoria: isNational ? 'selecao' : (name ? 'clube' : ''),
    liga: category.primaryId, competicao: trim(model.competicao), pais: trim(model.pais) || (isNational ? name : taxonomy.countriesByLeague[category.leagueId] || ''),
    temporada: season, modelo: uniforme, versao: version, retro, cor: trim(model.cor), edicao: trim(model.edicao) };
}

function caption(photo, name, titleEvidence) {
  const original = trim(photo.caption);
  if (trim(photo.captionPt)) return { legenda: photo.captionPt.trim(), tipoLegenda: useful(original) ? 'traduzida' : 'gerada' };
  if (useful(original)) {
    const translation = translatedViews[fold(original)] || (original === titleEvidence ? name : '');
    if (translation) return { legenda: translation, tipoLegenda: 'traduzida' };
    if (Object.values(views).includes(original)) return { legenda: original, tipoLegenda: 'original_pt' };
    return { legenda: views[photo.view] || 'Foto da camisa', tipoLegenda: 'revisao' };
  }
  return { legenda: views[photo.view] || 'Foto da camisa', tipoLegenda: views[photo.view] ? 'gerada' : 'revisao' };
}

export function prepareAlbum(album, taxonomy, authorization = {}) {
  const id = albumId(album.url);
  if (!Array.isArray(album.photos) || !album.photos.length) throw new Error('Álbum sem fotos internas.');
  const photos = new Map();
  for (const photo of album.photos) {
    if (!trim(photo.id) || photos.has(photo.id)) throw new Error('Foto repetida ou sem ID.');
    photos.set(photo.id, photo);
  }
  const hasVariants = Array.isArray(album.variants);
  const models = hasVariants ? album.variants : [album];
  if (!models.length) throw new Error('As variantes ainda precisam de identificação.');
  const keys = new Set(), assigned = new Set();
  const products = models.map(model => {
    const variant = hasVariants ? trim(model.key) : '';
    if (hasVariants && (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(variant) || keys.has(variant))) throw new Error('Variante sem chave estável e única.');
    keys.add(variant);
    const ids = hasVariants ? model.photoIds : [...photos.keys()];
    if (!Array.isArray(ids) || !ids.length) throw new Error('Variante sem fotos identificadas.');
    const pending = [];
    const selected = [];
    for (const photoId of ids) {
      if (!photos.has(photoId) || assigned.has(photoId)) throw new Error('Foto ausente ou associada a dois modelos: ' + photoId);
      assigned.add(photoId);
      const photo = photos.get(photoId);
      if (photo.falha) pending.push('Falha da foto ' + photoId + ': ' + photo.falha);
      else if (photo.verified !== true) pending.push('Associação da foto ' + photoId);
      else selected.push(photo);
    }
    const originals = [model.title, model.description, ...selected.map(p => p.caption)].map(trim).filter(useful);
    const identity = identify(model, originals, taxonomy);
    const titleEvidence = trim(model.titleEvidence) || originals.find(s => findTeam(s, taxonomy)) || '';
    if (model.titleEvidence && ![...originals, album.title, album.description].includes(model.titleEvidence)) throw new Error('Evidência do título ausente no álbum.');
    const tipoLegenda = model.tipoLegenda || (/^camisa feminina\b/i.test(trim(model.title)) ? 'original_pt' : titleEvidence && identity.time ? 'traduzida' : identity.time || model.nome ? 'gerada' : 'revisao');
    if (!['gerada','traduzida','original_pt','revisao'].includes(tipoLegenda)) throw new Error('Origem da legenda desconhecida.');
    if (!identity.time || !model.identityVerified) pending.push('Identificação do produto');
    const useDescription = model.descriptionAuthorized ?? album.descriptionAuthorized ?? authorization.descriptions ?? false;
    if (useDescription && model.description && !model.descriptionPt) pending.push('Tradução da descrição');
    if (tipoLegenda === 'revisao') pending.push('Título em português');
    const images = selected.map(p => {
      const text = caption(p, identity.nome, titleEvidence);
      if (text.tipoLegenda === 'revisao') pending.push('Legenda da foto ' + p.id);
      return { ...p, ...text, legendaOriginal: trim(p.caption) };
    });
    if (model.coverId && !images.some(p => p.id === model.coverId)) throw new Error('Capa sem associação confirmada.');
    const rank = p => p.id === model.coverId ? -1 : p.view === 'front' && p.whole !== false
      ? (p.preferred ? 0 : 1) : p.view === 'back' ? 3 : 4;
    images.sort((a,b) => rank(a) - rank(b));
    return { id: id + (variant ? '_' + variant : ''), images, pending, reviewed: model.identityVerified === true,
      fields: { ...identity, secao: 'femininas', origem: CATALOG_ID, albumId: id, variante: variant,
        albumUrl: source.origin + '/albums/' + id, categoriaUrl: CATEGORY_URL, codigo: trim(model.codigo) || id + (variant ? '-' + variant : ''),
        titleOriginal: trim(album.title), legendaOriginal: titleEvidence, tipoLegenda,
        descricao: useDescription ? trim(model.descriptionPt) : '', descricaoOriginal: useDescription ? trim(model.description) : '',
        evidencia: trim(model.evidence) || titleEvidence, preco: null, disponibilidade: 'encomenda' } };
  });
  const unassigned = [...photos.keys()].filter(key => !assigned.has(key));
  if (unassigned.length) products[0].pending.push('Fotos sem variante: ' + unassigned.join(', '));
  return products;
}
