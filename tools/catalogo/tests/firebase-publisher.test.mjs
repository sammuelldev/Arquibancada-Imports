import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { CATALOG_ID, CATEGORY_URL } from '../../../catalogo-femininas.mjs';
import { parseAlbum, parseCategory } from '../lib/yupoo-pages.mjs';
import { inventory, prepareAlbum } from '../lib/yupoo-femininas.mjs';
import { loadStoreTaxonomy } from '../lib/taxonomy.mjs';
import { importExport } from '../lib/yupoo-import.mjs';
import { compactProduct, mergePreservingManual, sha256 } from '../lib/firebase-publisher.mjs';

const taxonomy = await loadStoreTaxonomy();
const url = 'https://rainhajin.x.yupoo.com/albums/101';
function fixture() {
  const photos = [{ id: 'b', file: 'costas.png', view: 'back', caption: 'Back view', verified: true },
    { id: 'f', file: 'frente.png', view: 'front', caption: 'Arsenal Women Away Jersey 2024/25', verified: true },
    { id: 'd', file: 'frente.png', view: 'front', verified: true }];
  return { categoryUrl: CATEGORY_URL, authorization: { status: 'authorized', evidenceNote: 'Amostra sintética de teste' },
    pages: [{ url: CATEGORY_URL, albumUrls: [url], nextPageUrl: CATEGORY_URL + '?page=2' },
      { url: CATEGORY_URL + '?page=2', albumUrls: [url], nextPageUrl: null }],
    albums: [{ url, title: '12345', identityVerified: true, photos }] };
}
test('apenas álbuns vinculados à paginação feminina entram na seleção', () => {
  const input = fixture();
  input.albums.push({ url: url.replace('101','202') });
  assert.deepEqual(inventory(input).ids, ['101']);
  input.pages.pop();
  assert.equal(inventory(input).missingPage, 2);
  input.pages[0].nextPageUrl = 'https://rainhajin.x.yupoo.com/categories/1?page=2';
  assert.throws(() => inventory(input), /fora da seção/);
});
test('título numérico usa a legenda interna, variantes exigem vínculos inequívocos', () => {
  const album = fixture().albums[0];
  const [p] = prepareAlbum(album,taxonomy);
  assert.equal(p.id,'101');
  assert.equal(p.fields.nome,'Camisa feminina do Arsenal – Visitante 2024/25');
  assert.equal(p.fields.tipoLegenda,'traduzida');
  assert.equal(p.fields.liga,'premier');
  assert.equal(p.images[0].id,'f');
  assert.equal(p.images.find(photo => photo.id === 'b').legenda,'Costas da camisa');
  album.variants = [{ key:'verde', time:'Palmeiras', retro:true, photoIds:['d'], identityVerified:true },
    { key:'azul', nome:'Camisa feminina azul e branca', photoIds:['b'], identityVerified:true }];
  const [palmeiras,azul] = prepareAlbum(album,taxonomy);
  assert.equal(palmeiras.fields.tipoLegenda,'gerada');
  assert.equal(palmeiras.fields.liga,'brasileirao');
  assert.equal(palmeiras.fields.retro,true);
  assert.ok(azul.pending.includes('Identificação do produto'));
  assert.equal(azul.id,'101_azul');
  album.variants[1].photoIds = ['d'];
  assert.throws(() => prepareAlbum(album,taxonomy), /dois modelos/);
});
test('correções de título, preços e legendas individuais sobrevivem à troca de capa', () => {
  const data = { origem: CATALOG_ID, albumId:'101', variante:'', nome:'Nome da fonte', preco:null,
    galeria:[{id:'front',legenda:'Frente'},{id:'back',legenda:'Costas'}] };
  const existing = mergePreservingManual(null,data);
  existing.nome = 'Título revisado'; existing.preco = 179;
  existing.galeria[1].legenda = 'Número nas costas';
  const merged = mergePreservingManual(existing,{ ...data,nome:'Nova tradução',galeria:data.galeria.toReversed() });
  assert.equal(merged.nome,'Título revisado');
  assert.equal(merged.preco,179);
  assert.equal(merged.galeria[0].id,'back');
  assert.equal(merged.galeria[0].legenda,'Número nas costas');
  assert.deepEqual(merged.camposManuais,['nome']);
  assert.ok(!Object.hasOwn(compactProduct(merged),'galeria'));
});
test('retoma falha de Storage, deduplica por conteúdo e só conta após releitura', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(),'arquibancada-femininas-'));
  try {
    const inputFile = path.join(root,'export.json'), stateFile = path.join(root,'checkpoint.json');
    await writeFile(inputFile,JSON.stringify(fixture()));
    for (const [file,background] of [['frente.png','red'],['costas.png','blue']]) {
      await sharp({create:{width:10,height:10,channels:3,background}}).png().toFile(path.join(root,file));
    }
    let fail = true;
    const assets = new Set(), products = new Map();
    const backend = {
      async readVerified(id,sig) { const p = products.get(id); return p?.assinatura === sig ? p : null; },
      async storeImage(id,bytes) {
        if (fail && assets.size) throw new Error('Falha simulada');
        const key = sha256(bytes); assets.add(key); return { path:key,url:'https://test.invalid/' + key };
      },
      async commitProduct(id,data) { products.set(id,data); return products.get(id); }
    };
    const opts = {inputFile,stateFile,backend,taxonomy,target:'teste'};
    const first = await importExport(opts);
    assert.equal(first.verificados,0); assert.equal(products.size,0); assert.equal(assets.size,1);
    assert.match(first.falhas[0].motivo,/Foto b/);
    fail = false;
    for (const force of [false,false,true]) {
      const run = await importExport({...opts,force});
      assert.equal(run.traduzidos,1); assert.equal(run.fotosVerificadas,2);
      assert.equal(products.size,1); assert.equal(assets.size,2);
    }
    assert.equal(JSON.parse(await readFile(stateFile)).albums['101'].produtos['101'].estado,'verificado');
  } finally { await rm(root,{recursive:true,force:true}); }
});


test('HTML exportado mantém legenda, original e vínculo de categoria', () => {
  const page = parseCategory('<div class="showindex__parent"><a href="/albums/101?referrercate=5070410"></a><a href="/albums/500?referrercate=6"></a></div><a href="?page=2">2</a>',CATEGORY_URL);
  assert.deepEqual(page.albumUrls,[url]);
  assert.equal(page.nextPageUrl,CATEGORY_URL+'?page=2');
  const album = parseAlbum('<h1>12345</h1><div class="showalbum__children" data-id="88"><div data-origin-src="//photo.yupoo.com/test/front-original.jpg"><img src="//photo.yupoo.com/test/thumb.jpg"></div><span class="image__title">Front view</span></div>',url);
  assert.deepEqual(album.photos,[{ id:'88',url:'https://photo.yupoo.com/test/front-original.jpg',caption:'Front view',verified:false }]);
  assert.throws(() => parseAlbum('<p>Área restrita</p>',url),/não reconhecida/);
});
