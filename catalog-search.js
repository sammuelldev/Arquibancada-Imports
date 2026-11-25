/* Pure rules: filter the complete compact index before paginating. */
(function(root) {
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
  const values = value => (Array.isArray(value) ? value : [value]).filter(value => value != null && value !== '');
  const price = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
  function retro(p) { return p.retro === true || values(p.classificacoes).some(v => normalize(v) === 'retro') || /\bretro\b/.test(normalize([p.nome,p.titleOriginal,p.legendaOriginal,p.versao].join(' '))); }
  function section(p) {
    if (p.tipoProduto === 'kit_treino') return 'kits_treino';
    if (p.tipoProduto === 'kit_camisa_calcao') return 'kits_camisa_calcao';
    return p.secaoLiga || p.liga || 'outros';
  }
  function facetValues(product, field) {
    if (field === 'retro') return retro(product) ? ['Retrô'] : [];
    if (field === 'versao') return values(product.versoes || product.versao);
    return values(product[field]);
  }
  function searchText(p) { return normalize([p.nome,p.titleOriginal,p.legendaOriginal,p.time,p.selecao,p.temporada,p.codigo,p.codigoFornecedor,p.supplierId,p.sourceProductId,p.id,p.modelo,p.versao,retro(p) ? 'Retrô' : '',...values(p.classificacoes)].join(' ')); }
  function filter(products, state = {}) {
    const words=normalize(state.search).split(/\s+/).filter(Boolean);
    return products.filter(p => {
      if (state.section && state.section !== 'todos') {
        const matches = state.section === 'femininas' ? p.secao === 'femininas'
          : state.section === 'retro' ? retro(p)
          : [section(p), p.secaoLiga, p.liga].includes(state.section);
        if (!matches) return false;
      }
      if (state.team && normalize(p.time) !== normalize(state.team)) return false;
      if (!words.every(w => (p._searchText || searchText(p)).includes(w))) return false;
      return Object.entries(state.facets || {}).every(([field, selected]) => !selected || facetValues(p,field).some(v => normalize(v) === normalize(selected)));
    });
  }
  function facets(products, fields) { return Object.fromEntries(fields.map(field => [field,[...new Set(products.flatMap(p => facetValues(p,field)))].sort((a,b) => String(a).localeCompare(String(b),'pt-BR',{numeric:true}))])); }
  function totals(items) { return {subtotal:items.reduce((sum,i) => sum+(price(i.price)||0)*i.qty,0),pending:items.some(i => price(i.price) === null)}; }
  function order(products, by) {
    return products.slice().sort((a,b) => {
      if (by === 'menor' || by === 'maior') {
        const first = price(a.preco), second = price(b.preco);
        if (first !== second) {
          if (first === null) return 1;
          if (second === null) return -1;
          return by === 'menor' ? first - second : second - first;
        }
      }
      return a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }) || String(a.id).localeCompare(String(b.id));
    });
  }
  root.CatalogSearch={order,normalize,price,retro,section,filter,facets,searchText,totals};
})(globalThis);
