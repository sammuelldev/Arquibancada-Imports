import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { applicationDefault, initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';
import { CATALOG_ID, CATALOG_PATH, STORE_PROJECT_ID } from '../../../catalogo-femininas.mjs';

const editable = ['nome','time','selecao','categoria','liga','competicao','pais','temporada','modelo','versao',
  'retro','cor','edicao','codigo','descricao','tipoLegenda','pendencias'];
const cardFields = ['nome','time','selecao','liga','competicao','pais','temporada','modelo','versao','retro',
  'codigo','preco','disponibilidade','secao','origem','img','categoria','tamanhos','esgotado'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pick = (obj, keys) => Object.fromEntries(keys.filter(k => Object.hasOwn(obj,k)).map(k => [k,obj[k]]));

export function compactProduct(product) {
  return pick(product, cardFields);
}

// Compare to the last imported values inside the transaction. A photo's stable ID follows its caption on reorder.
export function mergePreservingManual(existing, incoming) {
  if (existing && (existing.origem !== CATALOG_ID || existing.albumId !== incoming.albumId || existing.variante !== incoming.variante)) {
    throw new Error('ID ocupado por outra origem ou variante.');
  }
  const baseline = existing?.importado ?? {};
  const manual = new Set(existing?.camposManuais ?? []);
  const merged = { ...existing, ...incoming };
  for (const field of editable) {
    if (existing && Object.hasOwn(existing, field) &&
        (!isDeepStrictEqual(existing[field], baseline[field]) || manual.has(field))) {
      manual.add(field);
      merged[field] = existing[field];
    }
  }
  for (const field of ['preco','disponibilidade']) if (existing && Object.hasOwn(existing,field)) merged[field] = existing[field];
  const byId = new Map((existing?.galeria ?? []).map(photo => [photo.id, photo]));
  merged.galeria = incoming.galeria.map(photo => {
    const prior = byId.get(photo.id);
    if (prior && (prior.manual || prior.legenda !== prior.legendaImportada)) {
      return { ...photo, legendaImportada: photo.legenda, legenda: prior.legenda, manual: true, tipoLegenda: 'manual' };
    }
    return { ...photo, legendaImportada: photo.legenda };
  });
  merged.importado = pick(incoming, editable);
  merged.camposManuais = [...manual];
  return merged;
}

export async function createFirebaseBackend({ emulator = false } = {}) {
  const hosts = [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST];
  if (emulator && hosts.some(host => !/^(?:http:\/\/)?(?:127\.0\.0\.1|localhost):\d+$/.test(host || ''))) {
    throw new Error('Configure ambos os emuladores locais de Firestore e Storage.');
  }
  if (!emulator && (hosts.some(Boolean) || process.env.STORAGE_EMULATOR_HOST)) throw new Error('Use --emulador para gravar nos emuladores.');
  const projectId = emulator ? 'demo-arquibancada' : STORE_PROJECT_ID;
  const bucketName = emulator ? projectId + '.appspot.com' : projectId + '.firebasestorage.app';
  let credential;
  if (!emulator) {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const config = JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS,'utf8'));
      if (config.project_id && config.project_id !== projectId) throw new Error('Credencial de outro projeto Firebase.');
    }
    credential = applicationDefault();
    await credential.getAccessToken();
  }
  const app = initializeApp({ projectId, storageBucket: bucketName, ...(credential ? { credential } : {}) }, 'femininas-' + randomUUID());
  const db = getFirestore(app);
  const bucket = getStorage(app).bucket();
  const catalog = db.doc(CATALOG_PATH);

  async function storeImage(id, bytes) {
    const hash = sha256(bytes);
    const format = (await sharp(bytes, {limitInputPixels: 80000000}).metadata()).format;
    if (!['jpeg','png','webp','avif'].includes(format)) throw new Error('Formato de imagem não reconhecido.');
    const path = CATALOG_PATH + '/' + id + '/' + hash + '.' + format;
    const file = bucket.file(path);
    let metadata;
    try { [metadata] = await file.getMetadata(); } catch (error) { if (Number(error.code) !== 404) throw error; }
    if (!metadata) {
      try {
        await file.save(bytes, { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { contentType: 'image/' + format, cacheControl: 'public,max-age=31536000,immutable',
            metadata: { sha256: hash, firebaseStorageDownloadTokens: randomUUID() } } });
      } catch (error) { if (Number(error.code) !== 412) throw error; }
      [metadata] = await file.getMetadata();
    }
    const token = metadata.metadata?.firebaseStorageDownloadTokens?.split(',')[0];
    if (!token || Number(metadata.size) !== bytes.length || metadata.metadata?.sha256 !== hash) throw new Error('Verificação do arquivo falhou: ' + path);
    const endpoint = emulator ? 'http://' + hosts[1].replace(/^http:\/\//, '') : 'https://firebasestorage.googleapis.com';
    const url = endpoint + '/v0/b/' + bucketName + '/o/' + encodeURIComponent(path) + '?alt=media&token=' + encodeURIComponent(token);
    return { path, url, sha256: hash };
  }

  async function commitProduct(id, record) {
    const detail = catalog.collection('fichas').doc(id), summary = catalog.collection('itens').doc(id);
    await db.runTransaction(async transaction => {
      const current = await transaction.get(detail);
      const product = mergePreservingManual(current.data(), record);
      transaction.set(detail, product);
      transaction.set(summary, compactProduct(product));
    });
    const [doc, card] = await db.getAll(detail, summary);
    const product = doc.data();
    if (!product || !card.exists || !isDeepStrictEqual(compactProduct(product), card.data()) ||
        !isDeepStrictEqual(product.galeria.map(p => [p.id, p.path]), record.galeria.map(p => [p.id, p.path]))) {
      throw new Error('Falha na releitura da ficha, resumo ou galeria.');
    }
    return product;
  }
  async function readVerified(id, signature) {
    const [doc, card] = await db.getAll(catalog.collection('fichas').doc(id), catalog.collection('itens').doc(id));
    const product = doc.data();
    if (!product || product.assinatura !== signature || !isDeepStrictEqual(compactProduct(product), card.data())) return null;
    for (const photo of product.galeria) {
      try {
        const [metadata] = await bucket.file(photo.path).getMetadata();
        if (metadata.metadata?.sha256 !== photo.sha256) return null;
      } catch (error) { if (Number(error.code) === 404) return null; throw error; }
    }
    return product;
  }
  return { storeImage, commitProduct, readVerified, close: () => deleteApp(app) };
}
