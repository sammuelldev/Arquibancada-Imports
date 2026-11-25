import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function storefront() {
  const elements=new Map(), handlers=new Map();
  const element=id => {
    if(!elements.has(id)) {
      const classes=new Set();
      elements.set(id,{innerHTML:'',textContent:'',value:'',hidden:false,style:{},dataset:{},setAttribute(){},removeAttribute(){},addEventListener(){},scrollIntoView(){},focus(){},querySelectorAll:()=>[],classList:{add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v),toggle:(v,on)=>on?classes.add(v):classes.delete(v)}});
    }
    return elements.get(id);
  };
  const document={getElementById:element,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(name,fn)=>handlers.set(name,fn),body:element('body')};
  const context=vm.createContext({document,window:{},console,setTimeout:()=>0,Intl});
  for(const file of ['catalogo-config.js','catalog-search.js','script.js']) vm.runInContext(fs.readFileSync(new URL('../../../'+file,import.meta.url),'utf8'),context);
  return {context,element,handlers,run:code=>vm.runInContext(code,context)};
}
test('a seção feminina fica vazia até a carga; limpar preserva a aba',()=>{
  const {run,context,element,handlers}=storefront();
  assert.equal(run('catalogProducts.length'),0);
  handlers.get('catalog:status')({detail:{state:'error',message:'Falha de leitura'}});
  assert.equal(element('grid').innerHTML,'');
  run("currentFilter='femininas';currentSearch='inexistente';facetFilters={temporada:'1990'};currentPage=9");
  handlers.get('catalog:status')({detail:{state:'ready'}});
  context.clearCatalogFilters();
  assert.equal(run('currentFilter'),'femininas');
  assert.equal(run('currentPage'),1);
  assert.match(element('grid').innerHTML,/Nenhum produto encontrado/);
});
test('null price renders consultation in grid, cart, WhatsApp and modal',async()=>{
  const {run,context,element}=storefront();
  run("catalogProducts=[prepareProduct({id:'sample',nome:'Camisa teste',time:'Flamengo',liga:'brasileirao',preco:null,img:'https://example.org/front.jpg',imgs:['https://example.org/front.jpg','https://example.org/back.jpg']})]");
  context.renderGrid();
  assert.match(element('grid').innerHTML,/Preço sob consulta/);
  assert.doesNotMatch(element('grid').innerHTML,/R\$\s*0,00/);
  run("cart=[{id:'sample',nome:'Camisa teste',time:'Flamengo',size:'M',price:null,qty:2,img:''},{id:'old',nome:'Antigo',time:'Brasil',size:'G',price:130,qty:1,img:''}]");
  context.renderCart();
  assert.equal(element('cartTotal').textContent,'Total a confirmar');
  assert.match(element('cartSubtotalNote').textContent,/130/);
  assert.match(decodeURIComponent(context.buildCartMsg()),/A confirmar com a loja/);
  await context.openModal('sample');
  assert.match(element('productPage').innerHTML,/Preço sob consulta/);
  assert.match(element('productPage').innerHTML,/back.jpg/);
});
test('remote gallery loads once on opening and late response cannot reopen closed details',async()=>{
  const {run,context,element,handlers}=storefront();
  handlers.get('catalog:firestore-products')({detail:[{id:'9001',data:{nome:'Camisa Fora',titleOriginal:'Flamengo Fora 2024 25 Torcedor',time:'Flamengo',liga:'brasileirao',preco:null,img:'https://example.org/thumbnail.jpg'}}]});
  context.filterProducts('Flamengo Fora 2024 25 Torcedor');
  assert.match(element('grid').innerHTML, /class="card-name">Camisa Fora<\/div>/);
  let calls=0, release;
  context.window.catalogLoadProduct=async id=>{assert.equal(id,'9001');calls++;return new Promise(resolve=>{release=resolve;});};
  const loading=context.openModal('firestore_9001');
  assert.equal(calls,1);
  assert.match(element('productPage').innerHTML,/Carregando fotos/);
  context.closePage();
  release({nome:'Original JIN',imgs:['https://example.org/full.jpg','https://example.org/back.jpg']});
  await loading;
  assert.equal(element('productPage').classList.contains('open'),false);
  context.window.catalogLoadProduct=async()=>{calls++;return {nome:'Original JIN',imgs:['https://example.org/full.jpg','https://example.org/back.jpg']};};
  await context.openModal('firestore_9001');
  await context.openModal('firestore_9001');
  assert.equal(calls,2);
  assert.match(element('productPage').innerHTML,/back.jpg/);
});
