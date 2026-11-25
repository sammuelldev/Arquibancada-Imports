import { readFile, realpath, mkdir, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { assertImageProcessingAllowed } from './images.mjs';
import { inventory, prepareAlbum } from './yupoo-femininas.mjs';
import { sha256 } from './firebase-publisher.mjs';
import { CATALOG_ID } from '../../../catalogo-femininas.mjs';

async function readPhoto(root, photo) {
  try {
    if (!photo.file || path.isAbsolute(photo.file)) throw new Error('Original local ausente');
    const file = await realpath(path.resolve(root, photo.file));
    const relative = path.relative(root, file);
    if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Arquivo fora da exportação');
    if ((await stat(file)).size > 48 * 1024 * 1024) throw new Error('Original excede 48 MiB');
    return await readFile(file);
  } catch (error) { throw new Error('Foto ' + photo.id + ': ' + error.message); }
}

async function checkpoint(file, state) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(state, null, 2));
  await rename(temp, file);
}

export async function importExport({ inputFile, stateFile, taxonomy, backend, limit = Infinity, onlyAlbum, force = false, target = 'local' }) {
  const input = JSON.parse(await readFile(inputFile, 'utf8'));
  const root = await realpath(path.dirname(inputFile));
  const { ids, albums, missingPage } = inventory(input);
  assertImageProcessingAllowed({ authorization: input.authorization });
  if (onlyAlbum && !ids.includes(onlyAlbum)) throw new Error('Álbum fora das páginas exportadas.');
  const selected = (onlyAlbum ? [onlyAlbum] : ids).slice(0, limit);
  let state = { origem: CATALOG_ID, target, albums: {} };
  try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (state.origem !== CATALOG_ID || state.target !== target) throw new Error('Checkpoint de outro catálogo ou ambiente.');
  const report = { encontrados: ids.length, examinados: 0, paginaPendente: missingPage, preparados: 0, aguardandoRevisao: 0,
    verificados: 0, fotosVerificadas: 0, traduzidos: 0, gerados: 0, originaisPt: 0, revisao: [], falhas: [] };
  for (const id of selected) {
    const album = albums.get(id);
    const result = { url: 'https://rainhajin.x.yupoo.com/albums/' + id, produtos: {}, falhas: [] };
    const previous = state.albums[id]?.produtos ?? {};
    state.albums[id] = result;
    try {
      if (!album) throw new Error('Álbum referenciado sem conteúdo na exportação.');
      report.examinados++;
      for (const product of prepareAlbum(album, taxonomy, input.authorization)) {
        try {
          const item = { nome: product.fields.nome, identificacao: product.fields, pendencias: product.pending,
            legendas: product.images.map(({id, file, legenda, legendaOriginal, tipoLegenda}) => ({id, file, legenda, legendaOriginal, tipoLegenda})) };
          result.produtos[product.id] = item;
          if (product.pending.length) report.revisao.push({ id: product.id, url: result.url, pendencias: product.pending });
          if (!product.reviewed || !product.images.length) {
            report.aguardandoRevisao++;
            if (!product.images.length) throw new Error('Nenhuma foto confirmada para a peça.');
            item.estado = 'aguarda_identificacao';
            continue;
          }
          const gallery = [], hashes = new Set();
          for (const image of product.images) {
            assertImageProcessingAllowed({ authorization: image.authorization ?? input.authorization });
            const bytes = await readPhoto(root, image);
            const hash = sha256(bytes);
            if (hashes.has(hash)) continue;
            hashes.add(hash);
            const metadata = await sharp(bytes, { limitInputPixels: 80000000 }).metadata();
            if (!['jpeg','png','webp','avif'].includes(metadata.format)) throw new Error('Formato inválido na foto ' + image.id);
            gallery.push({ id: image.id, file: image.file, sha256: hash, angle: image.view || '',
              legendaOriginal: image.legendaOriginal, legenda: image.legenda, tipoLegenda: image.tipoLegenda });
          }
          item.assinatura = sha256(JSON.stringify([product.fields, product.pending, gallery, input.authorization]));
          item.fotos = gallery.length;
          report.preparados++;
          if (!backend) { item.estado = 'preparado'; continue; }
          let verified;
          if (!force && previous[product.id]?.assinatura === item.assinatura) {
            verified = await backend.readVerified(product.id, item.assinatura);
          }
          if (!verified) {
            const photos = [];
            for (const { file, ...photo } of gallery) {
              const bytes = await readPhoto(root, { id: photo.id, file });
              if (sha256(bytes) !== photo.sha256) throw new Error('Foto alterada durante a importação: ' + photo.id);
              try { photos.push({ ...photo, ...await backend.storeImage(product.id, bytes), ordem: photos.length }); }
              catch (error) { throw new Error('Foto ' + photo.id + ': ' + error.message); }
            }
            verified = await backend.commitProduct(product.id, { ...product.fields,
              galeria: photos, img: photos[0].url, capaPath: photos[0].path, pendencias: product.pending,
              autorizacao: input.authorization.evidenceNote || input.authorization.evidenceUrl,
              capturadoEm: album.capturedAt || input.capturedAt || null, assinatura: item.assinatura });
          }
          item.estado = 'verificado';
          report.verificados++;
          report.fotosVerificadas += verified.galeria.length;
          if (verified.tipoLegenda === 'traduzida') report.traduzidos++;
          if (verified.tipoLegenda === 'gerada') report.gerados++;
          if (verified.tipoLegenda === 'original_pt') report.originaisPt++;
        } catch (error) { result.falhas.push({ id: product.id, motivo: error.message }); }
      }
    } catch (error) { result.falhas.push({ id, motivo: error.message }); }
    report.falhas.push(...result.falhas);
    await checkpoint(stateFile, state);
  }
  state.ultimaExecucao = report;
  await checkpoint(stateFile, state);
  return report;
}
