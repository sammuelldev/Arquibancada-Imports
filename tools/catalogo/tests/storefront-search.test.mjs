import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../../../catalog-search.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);
const catalog = context.CatalogSearch;
test('search combines section, accent folding, season and version beyond first page', () => {
  const products = Array.from({length:60}, (_,i) => ({id:i,nome:'Camisa',time:'Palmeiras',liga:'brasileirao',temporada:'2025',versao:'Torcedor'}));
  products.push({id:'match',nome:'Flamengo edição especial',codigo:'JIN-678',time:'Flamengo',liga:'brasileirao',temporada:'2026',versao:'Feminino'});
  assert.equal(catalog.filter(products,{section:'brasileirao',search:'flamengo edicao',facets:{temporada:'2026',versao:'Feminino'}})[0].id,'match');
  assert.equal(catalog.filter(products,{search:'jin-678'}).length,1);
  assert.equal(catalog.filter(products,{section:'premier',search:'Flamengo'}).length,0);
});
test('retro is independent of kit composition, model, version and league', () => {
  const kit={id:'kit',nome:'PSG RETRÔ 1990',tipoProduto:'kit_treino',liga:'ligue1',modelo:'Treino',versao:'Feminino'};
  assert.equal(catalog.section(kit),'kits_treino');
  assert.equal(catalog.filter([kit],{section:'kits_treino',facets:{retro:'Retrô',liga:'ligue1'}}).length,1);
  assert.equal(catalog.filter([kit],{section:'retro'}).length,1);
  assert.equal(catalog.section({...kit,tipoProduto:'kit_camisa_calcao'}),'kits_camisa_calcao');
  assert.equal(catalog.section({...kit,tipoProduto:'camisa'}),'ligue1');
});
test('unknown prices remain unknown and never lower an order total to zero', () => {
  for(const value of [null,undefined,'',0,'invalid',-1]) assert.equal(catalog.price(value),null);
  assert.equal(catalog.price(130),130);
  const totals=catalog.totals([{price:130,qty:2},{price:null,qty:1}]);
  assert.equal(totals.subtotal,260);
  assert.equal(totals.pending,true);
});
test('facets derive from all eligible indexed items and preserve feminine and retro', () => {
  const options=catalog.facets([{versao:'Feminino',classificacoes:['retro'],temporada:'1998'},{versao:'Jogador',temporada:'2026'}],['versao','temporada','retro']);
  assert.equal(options.versao.includes('Feminino'),true);
  assert.equal(options.retro.includes('Retrô'),true);
  assert.equal(options.temporada.length,2);
});
