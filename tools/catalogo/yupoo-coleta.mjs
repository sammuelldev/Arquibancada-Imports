import path from 'node:path';
import { mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import robotsParser from 'robots-parser';
import { CATEGORY_URL, CATALOG_ID } from '../../catalogo-femininas.mjs';
import { assertSourceAllowed } from './lib/collection-engine.mjs';
import { assertImageProcessingAllowed } from './lib/images.mjs';
import { albumId } from './lib/yupoo-femininas.mjs';
import { parseAlbum, parseCategory } from './lib/yupoo-pages.mjs';

const agent = 'ChatGPT-User';
const root = path.resolve('data/catalogo-local/yupoo-femininas');
const hosts = new Set([new URL(CATEGORY_URL).hostname, 'photo.yupoo.com']);
const rules = new Map();
const headers = { 'user-agent': agent };
async function local(name, fallback) {
  try { return JSON.parse(await readFile(path.join(root,name),'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
async function atomic(file, bytes) {
  await mkdir(path.dirname(file),{recursive:true});
  const temp = file + '.' + randomUUID() + '.tmp';
  await writeFile(temp, bytes);
  await rename(temp, file);
}
const persist = (name, obj) => atomic(path.join(root,name), JSON.stringify(obj,null,2));
function stop(message) { return Object.assign(new Error(message), { halt:true }); }
async function permit(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !hosts.has(parsed.hostname) || parsed.port) throw stop('Host fora da seleção.');
  if (!rules.has(parsed.origin)) {
    const address = parsed.origin + '/robots.txt';
    const res = await fetch(address,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});
    if (!res.ok && res.status !== 404) throw stop('robots.txt indisponível: HTTP ' + res.status);
    rules.set(parsed.origin,robotsParser(address, res.ok ? await res.text() : ''));
  }
  const policy = rules.get(parsed.origin);
  if (policy.isAllowed(url,agent) === false) throw stop('O robots.txt proíbe ' + agent + ' em ' + url);
  return Math.max(1,policy.getCrawlDelay(agent) || 0) * 1000;
}
async function request(url, image = false) {
  await wait(await permit(url));
  const res = await fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(45000)});
  if (!res.ok) {
    const message = 'HTTP ' + res.status + ' em ' + url;
    if ([401,403,429].includes(res.status)) throw stop(message);
    throw new Error(message);
  }
  const type = res.headers.get('content-type') || '';
  if (!(image ? /^image\/(jpeg|png|webp|avif)\b/i : /^text\/html\b/i).test(type)) throw new Error('Resposta inesperada em ' + url);
  const chunks = []; let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > (image ? 48 : 8) * 1024 * 1024) throw new Error('Resposta muito grande: ' + url);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function capture() {
  const flags = process.argv.slice(2);
  const update = flags.includes('--atualizar');
  const limitAt = flags.indexOf('--limite');
  const limit = limitAt < 0 ? Infinity : Number(flags[limitAt+1]);
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('Limite de álbuns inválido.');
  await permit(CATEGORY_URL);
  const auth = await local('autorizacao.json', null);
  if (!auth) throw new Error('Falta a autorização do fornecedor em ' + path.join(root,'autorizacao.json'));
  assertSourceAllowed({ id:CATALOG_ID,kind:'public_web',fetchPage:request,
    authorization:{status:auth.status === 'authorized' ? 'approved' : '',document:auth.evidenceNote,evidenceUrl:auth.evidenceUrl,robotsStatus:'allowed'} });
  assertImageProcessingAllowed({authorization:auth});
  const data = await local('export.json',{categoryUrl:CATEGORY_URL,pages:[],albums:[]});
  if (data.categoryUrl !== CATEGORY_URL) throw new Error('Exportação de outra categoria.');
  data.authorization = auth;
  const pages = update ? [] : data.pages;
  let url = pages.length ? pages.at(-1).nextPageUrl : CATEGORY_URL;
  while (url) {
    const page = parseCategory((await request(url)).toString('utf8'),url);
    pages.push(page);
    data.pages = pages;
    await persist('export.json',data);
    url = page.nextPageUrl;
  }
  const urls = [...new Set(pages.flatMap(page => page.albumUrls))];
  const failures = [], byId = new Map(data.albums.map(album => [albumId(album.url),album]));
  let examined = 0;
  for (const address of urls.slice(0,limit)) {
    const id = albumId(address);
    try {
      let album = byId.get(id);
      if (!album || update) {
        const fresh = parseAlbum((await request(address)).toString('utf8'),address);
        const prior = new Map(album?.photos.map(photo => [photo.id,photo]));
        const photos = fresh.photos.map(photo => {
          const old = prior.get(photo.id);
          return { ...old, ...photo, verified: old?.url === photo.url && old?.verified === true,
            file: old?.url === photo.url ? old.file : undefined };
        });
        const changed = album && (album.title !== fresh.title || album.description !== fresh.description);
        album = { ...album,...fresh,photos, identityVerified: !changed && album?.identityVerified === true };
        byId.set(id,album);
      }
      examined++;
      for (const photo of album.photos) {
        try {
          assertImageProcessingAllowed({authorization:photo.authorization ?? auth});
          if (!update && photo.file && /^fotos\/[0-9]+\/[a-f0-9]{64}$/.test(photo.file) && (await stat(path.join(root,photo.file)).catch(()=>null))?.size) continue;
          const bytes = await request(photo.url,true);
          const hash = createHash('sha256').update(bytes).digest('hex');
          const newFile = 'fotos/' + id + '/' + hash;
          if (photo.file && photo.file !== newFile) photo.verified = false;
          photo.file = newFile;
          await atomic(path.join(root,photo.file),bytes);
          delete photo.falha;
        } catch (error) {
          delete photo.file;
          photo.verified = false;
          photo.falha = error.message;
          failures.push({album:id,foto:photo.id,motivo:error.message});
          if (error.halt) throw error;
        }
      }
    } catch (error) {
      failures.push({album:id,url:address,motivo:error.message});
      if (error.halt) throw error;
    } finally {
      data.albums = [...byId.values()];
      data.capturedAt = new Date().toISOString();
      await persist('export.json',data);
      await persist('coleta.json',{examinados:examined,ultimoAlbum:id,identificados:urls.length,falhas:failures});
    }
  }
  console.log(JSON.stringify({examinados:examined,identificados:urls.length,falhas:failures},null,2));
  if (failures.length) process.exitCode = 2;
}
try { await capture(); }
catch (error) {
  console.error(error.message);
  await persist('interrupcao.json',{instante:new Date().toISOString(),categoria:CATEGORY_URL,motivo:error.message});
  process.exitCode = 1;
}
