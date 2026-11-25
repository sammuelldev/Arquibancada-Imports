const WPP = '5581998628808';
const PER_PAGE = 12;
const PRODUCT_FALLBACK_IMG = 'img/product-placeholder.svg';
const moneyFormat = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

let currentFilter = 'todos';
let currentSearch = '';
let currentTeam = '';
let selectedSize = '';
let currentProduct = null;
let currentPage = 1;
let galleryIndex = 0;
let detailRequest = 0;
let facetFilters = {};
const facetLabels = { pais: 'País', liga: 'Liga', time: 'Time ou seleção', temporada: 'Temporada', modelo: 'Uniforme', versao: 'Versão', retro: 'Retrô' };
let catalogState = 'loading';

/* ══════════════════════
   CARRINHO
══════════════════════ */
let cart = [];

function formatPrice(value) {
  return CatalogSearch.price(value) === null ? 'Preço sob consulta' : moneyFormat.format(Number(value));
}

function productPrice(product) {
  return CatalogSearch.price(product.preco);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function imageSource(path) {
  const value = String(path || '').trim();
  if (value.startsWith('https://') || value.startsWith('http://') || value.startsWith('img camisas/')) {
    return escapeHtml(value);
  }
  return PRODUCT_FALLBACK_IMG;
}

function productSizes(product) {
  if (!Array.isArray(product.tamanhos)) return [];
  return product.tamanhos.map(size => typeof size === 'string'
    ? { nome: size, status: 'disponivel' }
    : size
  ).filter(size => size && size.nome);
}

function isProductSoldOut(product) {
  if (product.esgotado === true || product.disponibilidade === 'esgotado') return true;
  const sizesForProduct = productSizes(product);
  return sizesForProduct.length > 0 && sizesForProduct.every(size => size.status === 'esgotado');
}

function availabilityLabel(product) {
  if (isProductSoldOut(product)) return 'Esgotado';
  return product.disponibilidade === 'pronta_entrega' ? 'Pronta entrega' : 'Encomenda';
}

function versionLabel(version) {
  return version || 'Camisa';
}

function addToCart(product, size) {
  if (isProductSoldOut(product)) {
    showCartToast('Este produto está esgotado');
    return;
  }
  const selectedSizeLabel = size || 'A confirmar';
  const existing = cart.find(i => String(i.id) === String(product.id) && i.size === selectedSizeLabel);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({
      id: product.id,
      time: product.time,
      nome: product.nome,
      img: imageSource(product.img),
      size: selectedSizeLabel,
      qty: 1,
      price: productPrice(product),
    });
  }
  renderCart();
  openCart();
  showCartToast('✅ Adicionado ao carrinho!');
}

function removeFromCart(id, size) {
  cart = cart.filter(i => !(String(i.id) === String(id) && i.size === size));
  renderCart();
}

function changeQty(id, size, delta) {
  const item = cart.find(i => String(i.id) === String(id) && i.size === size);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) removeFromCart(id, size);
  else renderCart();
}

function cartTotal() {
  const totals = CatalogSearch.totals(cart);
  return totals.pending ? null : totals.subtotal;
}

function renderCart() {
  const el = document.getElementById('cartItems');
  const totalEl = document.getElementById('cartTotal');
  const badge = document.getElementById('cartBadge');
  const totalQty = cart.reduce((s, i) => s + i.qty, 0);

  badge.textContent = totalQty;
  badge.style.display = totalQty > 0 ? 'flex' : 'none';

  if (cart.length === 0) {
    el.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-icon">🛒</div>
        <div>Seu carrinho está vazio</div>
      </div>`;
    totalEl.textContent = 'R$ 0,00';
    const note = document.getElementById('cartSubtotalNote');
    if (note) note.hidden = true;
    return;
  }

  el.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-img">
        <img src="${item.img}" alt="${escapeHtml(item.nome)}" loading="lazy" onerror="this.onerror=null;this.src='${PRODUCT_FALLBACK_IMG}'">
      </div>
      <div class="cart-item-info">
        <div class="cart-item-team">${escapeHtml(item.time)}</div>
        <div class="cart-item-name">${escapeHtml(item.nome)}</div>
        <div class="cart-item-size">Tamanho: <strong>${escapeHtml(item.size)}</strong></div>
        <div class="cart-item-price">${formatPrice(item.price === null ? null : item.price * item.qty)}</div>
        <div class="cart-item-qty">
          <button type="button" data-cart-action="decrease" data-cart-id="${escapeHtml(item.id)}" data-cart-size="${escapeHtml(item.size)}" aria-label="Diminuir quantidade">−</button>
          <span>${item.qty}</span>
          <button type="button" data-cart-action="increase" data-cart-id="${escapeHtml(item.id)}" data-cart-size="${escapeHtml(item.size)}" aria-label="Aumentar quantidade">+</button>
          <button type="button" class="cart-item-remove" data-cart-action="remove" data-cart-id="${escapeHtml(item.id)}" data-cart-size="${escapeHtml(item.size)}" aria-label="Remover produto">🗑</button>
        </div>
      </div>
    </div>
  `).join('');

  const totals = CatalogSearch.totals(cart);
  el.querySelectorAll('[data-cart-action]').forEach(button => button.addEventListener('click', () => {
    const { cartAction, cartId, cartSize } = button.dataset;
    if (cartAction === 'remove') removeFromCart(cartId, cartSize);
    else changeQty(cartId, cartSize, cartAction === 'increase' ? 1 : -1);
  }));
  totalEl.textContent = totals.pending ? 'Total a confirmar' : formatPrice(totals.subtotal);
  const note = document.getElementById('cartSubtotalNote');
  if (note) { note.hidden = !totals.pending; note.textContent = totals.subtotal > 0 ? `Itens com preço definido: ${formatPrice(totals.subtotal)}. Os demais serão cotados pela loja.` : 'A loja confirmará os valores antes de finalizar o pedido.'; }
}

function buildCartMsg() {
  const lines = cart.map(i => {
    const product = catalogProducts.find(item => String(item.id) === String(i.id));
    const status = product ? availabilityLabel(product) : 'A confirmar';
    return `👕 *${i.time} - ${i.nome}*\n   Tamanho: ${i.size} | Qtd: ${i.qty} | ${formatPrice(i.price === null ? null : i.price * i.qty)}\n   Disponibilidade: ${status}`;
  }).join('\n\n');
  return encodeURIComponent(
    `Olá! Gostaria de fazer o seguinte pedido:\n\n${lines}\n\n` +
    `💰 *Total: ${cartTotal() === null ? 'A confirmar com a loja' : formatPrice(cartTotal())}*\n\n` +
    `Poderia me passar mais informações para finalizar?`
  );
}

function checkoutCart() {
  if (cart.length === 0) return;
  window.open(`https://wa.me/${WPP}?text=${buildCartMsg()}`, '_blank');
}

function openCart() {
  const drawer = document.getElementById('cartDrawer');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  const overlay = document.getElementById('cartOverlay');
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  const drawer = document.getElementById('cartDrawer');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  const overlay = document.getElementById('cartOverlay');
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = document.getElementById('productPage')?.classList.contains('open') ? 'hidden' : '';
}

function showCartToast(msg) {
  const t = document.getElementById('cartToast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

/* ══════════════════════
   MAPA DE LABELS
══════════════════════ */
const ligaLabels = {
  ...Object.fromEntries(CATEGORIAS_CATALOGO.map(category => [category.id, category.label.toUpperCase()])),
};

function prepareProduct(product) {
  const result = { ...product, nome: product.nome, secaoLiga: classificarProduto(product), pais: product.pais || '', ligaLabel: product.competicao?.trim() || ligaLabels[product.liga] || 'OUTROS' };
  const legacyModels = { casa: 'Casa/Titular', titular: 'Casa/Titular', fora: 'Fora/Visitante', visitante: 'Fora/Visitante', terceira: 'Terceira', goleiro: 'Goleiro', especial: 'Especial', treino: 'Treino', windbreaker: 'Windbreaker' };
  if (!product.modelo && legacyModels[CatalogSearch.normalize(product.versao)]) {
    result.modelo = legacyModels[CatalogSearch.normalize(product.versao)];
    result.versao = '';
  }
  result._searchText = CatalogSearch.searchText(result);
  return result;
}
let catalogProducts = [];

document.addEventListener('catalog:status', event => {
  const status = document.getElementById('catalogLoadStatus');
  if (!status) return;
  const { state, message } = event.detail;
  catalogState = state;
  document.getElementById('countLabel').hidden = state !== 'ready';
  document.getElementById('catalogRetry').hidden = state !== 'error';
  renderGrid();
  status.hidden = !message && state !== 'loading';
  status.textContent = message || (state === 'loading' ? 'Carregando catálogo…' : '');
  status.setAttribute('role', state === 'error' ? 'alert' : 'status');
});

document.addEventListener('catalog:firestore-products', event => {
  const remoteProducts = event.detail.map(({ id, data }) => prepareProduct({
    ...data,
    id: `firestore_${id}`,
    firestoreId: id,
    img: data.thumbnail || data.img || data.imgs?.[0] || '',
    imgs: Array.isArray(data.imgs) ? data.imgs : (data.img ? [data.img] : []),
    ligaLabel: data.competicao?.trim() || ligaLabels[data.liga] || 'OUTROS',
  }));
  catalogProducts = remoteProducts;
  renderFacets();
  currentPage = 1;
  renderFeaturedTeams();
  renderGrid();
});

/* ══════════════════════
   HERO DINÂMICO
══════════════════════ */
const heroBgMap = {
  premier:     { img: 'hero-premier.jpg',     position: 'center 30%' },
  ligue1:      { img: 'hero-ligue1.jpg',      position: 'center 30%' },
  bundesliga:  { img: 'hero-bundesliga.jpg',  position: 'center 30%' },
  brasileirao: { img: 'hero-brasileirao.jpg', position: 'center 30%' },
  seriea:      { img: 'hero-seriea.jpg',      position: 'center 30%' },
  selecoes:    { img: 'hero-selecoes.jpg',    position: 'center 30%' },
  laliga:      { img: 'hero-laliga.jpg',      position: 'center 30%' },
};
const heroBgDefault = { img: 'hero-bg.jpg', position: 'center' };

function updateHeroBg(liga) {
  const config = heroBgMap[liga] || heroBgDefault;
  const bg = document.querySelector('.hero-bg');
  if (!bg) return;
  bg.style.opacity = '0';
  setTimeout(() => {
    bg.style.backgroundImage    = `url('${config.img}')`;
    bg.style.backgroundPosition = config.position;
    bg.style.opacity = '1';
  }, 300);
}

/* ══════════════════════
   VISIBILIDADE
══════════════════════ */
function updateSectionsVisibility(liga) {
  const showIntro = liga === 'todos' && !currentTeam && !currentSearch;
  const featured = document.getElementById('featuredTeamsSection');
  const about = document.querySelector('.quem-somos');
  const tagline = document.querySelector('.tagline-reveal');
  const notice = document.querySelector('.wpp-notice');
  if (featured) featured.hidden = !showIntro;
  if (about) about.hidden = liga !== 'todos' || Boolean(currentTeam);
  if (tagline) tagline.hidden = liga !== 'todos' || Boolean(currentTeam);
  if (notice) notice.hidden = liga !== 'todos' || Boolean(currentTeam);
}

/* ══════════════════════
   TÍTULO DINÂMICO
══════════════════════ */
function updateCatalogTitle(liga) {
  const titleEl   = document.getElementById('catalogTitle');
  const eyebrowEl = document.getElementById('catalogEyebrow');
  if (currentTeam) {
    titleEl.textContent = currentTeam.toLocaleUpperCase('pt-BR');
    eyebrowEl.textContent = 'Clube em destaque';
  } else if (liga === 'todos') {
    titleEl.textContent   = 'TODOS OS PRODUTOS';
    eyebrowEl.textContent = 'Catálogo';
  } else {
    titleEl.textContent   = ligaLabels[liga] || liga.toUpperCase();
    eyebrowEl.textContent = 'Produtos';
  }
}

/* ══════════════════════
   FILTER
══════════════════════ */
function getFiltered() {
  const matches = CatalogSearch.filter(catalogProducts, { section: currentFilter, search: currentSearch, team: currentTeam, facets: facetFilters });
  return CatalogSearch.order(matches, document.getElementById('catalogOrder').value);
}

function renderFacets() {
  const products = CatalogSearch.filter(catalogProducts, { section: currentFilter });
  const options = CatalogSearch.facets(products, Object.keys(facetLabels));
  document.getElementById('catalogFacets').innerHTML = Object.entries(facetLabels)
    .filter(([field]) => options[field].length)
    .map(([field, label]) => `<label class="catalog-field">${label}
      <select data-facet="${field}"><option value="">Todas as opções</option>
      ${options[field].map(value => `<option value="${escapeHtml(value)}" ${facetFilters[field] === value ? 'selected' : ''}>${escapeHtml(field === 'liga' ? ligaLabels[value] || value : value)}</option>`).join('')}
      </select></label>`).join('');
}

function toggleFilters(open) {
  const panel = document.getElementById('filterPanel');
  panel.classList.toggle('is-open', open);
  document.body.classList.toggle('catalog-filters-open', open);
  document.getElementById('filterOverlay').hidden = !open;
  document.getElementById('filterToggle').setAttribute('aria-expanded', String(open));
  document.getElementById(open ? 'catalogSearch' : 'filterToggle').focus();
}

function clearCatalogFilters() {
  facetFilters = {};
  currentSearch = '';
  currentTeam = '';
  currentPage = 1;
  document.getElementById('searchInput').value = '';
  document.getElementById('catalogSearch').value = '';
  renderFacets();
  syncFilterButtons();
  updateCatalogTitle(currentFilter);
  updateSectionsVisibility(currentFilter);
  renderGrid();
}

function syncFilterButtons() {
  document.querySelectorAll('[data-filter]').forEach(button => {
    const active = button.dataset.filter === currentFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-team]').forEach(button => {
    const active = normalizarNome(button.dataset.team) === normalizarNome(currentTeam);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function setFilter(liga) {
  currentFilter = liga;
  facetFilters = {};
  renderFacets();
  currentTeam = '';
  currentPage   = 1;
  syncFilterButtons();
  updateHeroBg(liga);
  updateSectionsVisibility(liga);
  updateCatalogTitle(liga);
  document.getElementById('catalogo').scrollIntoView({ behavior: 'smooth' });
  renderGrid();
}

function setTeamFilter(team) {
  currentFilter = 'todos';
  facetFilters = {};
  renderFacets();
  currentTeam = team;
  currentPage = 1;
  syncFilterButtons();
  updateHeroBg('todos');
  updateSectionsVisibility('todos');
  updateCatalogTitle('todos');
  renderGrid();
}

function filterProducts(value) {
  currentSearch = value ?? document.getElementById('searchInput').value;
  document.getElementById('searchInput').value = currentSearch;
  document.getElementById('catalogSearch').value = currentSearch;
  currentPage   = 1;
  updateSectionsVisibility(currentFilter);
  renderGrid();
}

function scrollToCatalog() {
  setTimeout(() => document.getElementById('catalogo').scrollIntoView({ behavior: 'smooth' }), 100);
}

/* ══════════════════════
   TIPO LABEL
══════════════════════ */
function renderFeaturedTeams() {
  const container = document.getElementById('featuredTeams');
  if (!container) return;

  const featuredProducts = catalogProducts.filter(product =>
    product.liga !== 'selecoes' && TIME_DESTAQUE_NORMALIZADO.has(normalizarNome(product.time))
  );
  const teams = [...new Map(featuredProducts.map(product => [normalizarNome(product.time), product.time])).values()];

  container.innerHTML = teams.map(team => `
    <button class="team-chip" type="button" data-team="${escapeHtml(team)}" aria-pressed="false">
      ${escapeHtml(team)}
    </button>`).join('');

  container.querySelectorAll('[data-team]').forEach(button => {
    button.addEventListener('click', () => setTeamFilter(button.dataset.team));
  });
}

/* ══════════════════════
   RENDER GRID
══════════════════════ */
function renderGrid() {
  const grid = document.getElementById('grid');
  const all = getFiltered();
  const totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  if (currentPage > totalPages) currentPage = 1;

  const start = (currentPage - 1) * PER_PAGE;
  const list = all.slice(start, start + PER_PAGE);
  document.getElementById('countLabel').textContent = `${all.length} produto${all.length !== 1 ? 's' : ''}`;

  if (!all.length && catalogState !== 'ready') {
    grid.innerHTML = '';
    renderPagination(0);
    return;
  }
  if (all.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div aria-hidden="true">⌕</div>
        <h3>Nenhum produto encontrado</h3>
        <p>Nenhum produto atende a esta combinação. Ajuste os filtros ou limpe a busca nesta seção.</p><button type="button" class="catalog-clear" onclick="clearCatalogFilters()">Limpar filtros</button>
        <a href="https://wa.me/${WPP}" target="_blank" rel="noopener noreferrer">Falar com a loja</a>
      </div>`;
    renderPagination(0);
    return;
  }

  grid.innerHTML = list.map(p => {
    const soldOut = isProductSoldOut(p);
    const statusClass = soldOut ? 'status-sold-out' : '';
    return `
      <article class="card" data-product-id="${escapeHtml(p.id)}" tabindex="0" role="button" aria-label="Ver ${escapeHtml(p.nome)} do ${escapeHtml(p.time)}" onclick="openModal(this.dataset.productId)" onkeydown="if(event.target===this&&(event.key==='Enter'||event.key===' ')){event.preventDefault();openModal(this.dataset.productId)}">
        <div class="card-img">
          <span class="liga-tag">${escapeHtml(p.ligaLabel)}</span>
          <img src="${imageSource(p.img)}" alt="${escapeHtml(p.time)}: ${escapeHtml(p.nome)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${PRODUCT_FALLBACK_IMG}'">
        </div>
        <div class="card-body">
          <div class="card-team">${escapeHtml(p.time)}</div>
          <div class="card-name">${escapeHtml(p.nome)}</div>
          <span class="product-status ${statusClass}">${availabilityLabel(p)}</span>
          <div class="card-tipo">${escapeHtml(versionLabel([p.modelo, p.versao].filter(Boolean).join(' · ')))}</div>
          <div class="card-footer">
            <div>
              <div class="price-pix">${formatPrice(productPrice(p))}</div>
              <div class="price-card">${productPrice(p) === null ? 'Consulte a loja' : 'Pix ou cartão em até 3x'}</div>
            </div>
            <button class="btn-wpp" type="button" ${soldOut ? 'disabled' : ''} data-buy-id="${escapeHtml(p.id)}">
              💬 ${soldOut ? 'Esgotado' : 'Comprar'}
            </button>
          </div>
        </div>
      </article>`;
  }).join('');

  grid.querySelectorAll('[data-buy-id]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    quickBuy(button.dataset.buyId);
  }));
  renderPagination(totalPages);
}

function initTaglineReveal() {
  const tagline = document.getElementById('taglineCopy');
  if (!tagline) return;

  const copy = tagline.textContent.trim();
  tagline.setAttribute('aria-label', copy);
  tagline.innerHTML = copy.split(/\s+/).map(word =>
    `<span class="tagline-word" aria-hidden="true">${escapeHtml(word)}</span>`
  ).join(' ');

  const words = tagline.querySelectorAll('.tagline-word');
  if (!('IntersectionObserver' in window)) {
    words.forEach(word => word.classList.add('is-active'));
    return;
  }

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-active');
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '-35% 0px -35% 0px', threshold: 0 });

  words.forEach(word => observer.observe(word));
}

/* ══════════════════════
   PAGINAÇÃO
══════════════════════ */
function renderPagination(totalPages) {
  const el = document.getElementById('pagination');
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  const pages = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages])].filter(page => page >= 1 && page <= totalPages).sort((a,b) => a-b);
  let html = `<button class="page-btn arrow" aria-label="Página anterior" onclick="goPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>&#8592;</button>`;
  pages.forEach((page,index) => {
    if (index > 0 && page - pages[index-1] > 1) html += '<span aria-hidden="true">…</span>';
    html += `<button class="page-btn ${page === currentPage ? 'active' : ''}" aria-label="Página ${page}" ${page === currentPage ? 'aria-current="page"' : ''} onclick="goPage(${page})">${page}</button>`;
  });
  html += `<button class="page-btn arrow" aria-label="Próxima página" onclick="goPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>&#8594;</button>`;
  el.innerHTML = html;
}

function goPage(page) {
  currentPage = page;
  renderGrid();
  document.getElementById('catalogo').scrollIntoView({ behavior: 'smooth' });
}

/* ══════════════════════
   PÁGINA DO PRODUTO
══════════════════════ */
async function openModal(id) {
  currentProduct = catalogProducts.find(p => String(p.id) === String(id));
  if (!currentProduct) return;
  const request = ++detailRequest;
  const item = currentProduct;
  const page = document.getElementById('productPage');
  page.classList.add('open');
  page.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  if (item.firestoreId && !item.detailsLoaded) {
    page.innerHTML = '<div class="pp-inner"><button class="pp-close" type="button" onclick="closePage()" aria-label="Fechar detalhes">✕</button><div class="catalog-detail-loading" role="status">Carregando fotos e detalhes…</div></div>';
    try {
      if (typeof window.catalogLoadProduct !== 'function') throw new Error('Catálogo ainda carregando');
      const details = await window.catalogLoadProduct(item.firestoreId);
      if (!details) throw new Error('Produto indisponível');
      if (request !== detailRequest) return;
      currentProduct = prepareProduct({ ...item, ...details, id: item.id, firestoreId: item.firestoreId, detailsLoaded: true });
      const index = catalogProducts.findIndex(p => p.id === item.id);
      if (index >= 0) catalogProducts[index] = currentProduct;
    } catch {
      if (request !== detailRequest) return;
      page.innerHTML = '<div class="pp-inner"><button class="pp-close" type="button" onclick="closePage()" aria-label="Fechar detalhes">✕</button><div class="catalog-detail-error" role="alert"><p>Não foi possível carregar esta galeria.</p><button class="catalog-clear" id="retryDetails" type="button">Tentar novamente</button></div></div>';
      document.getElementById('retryDetails').addEventListener('click', () => openModal(item.id));
      return;
    }
  }
  selectedSize = '';
  galleryIndex = 0;

  const p = currentProduct;
  const photos = productGallery(p);
  const imgs = photos.map(photo => photo.url);
  const sizesForProduct = productSizes(p);
  const soldOut = isProductSoldOut(p);

  page.innerHTML = `
    <div class="pp-inner">

      <button class="pp-close" type="button" onclick="closePage()" aria-label="Fechar detalhes">✕</button>

      <!-- GALERIA -->
      <div class="pp-gallery">
        <div class="pp-gallery-main" id="ppMain">
          <img id="ppMainImg" src="${imageSource(imgs[0])}" alt="${escapeHtml(photos[0]?.legenda || p.nome)}" onclick="zoomImg(this)" onerror="this.onerror=null;this.src='${PRODUCT_FALLBACK_IMG}'">
          <div class="pp-zoom-hint">Ampliar imagem</div>
        </div>
        <p id="ppCaption" class="pp-caption" aria-live="polite">${escapeHtml(photos[0]?.legenda)}</p>
        ${imgs.length > 1 ? `
        <div class="pp-thumbs" id="ppThumbs">
          ${imgs.map((src, i) => `
            <button class="pp-thumb ${i === 0 ? 'active' : ''}" type="button" onclick="setGalleryImg(${i})" aria-label="Ver imagem ${i + 1}">
              <img src="${imageSource(src)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='${PRODUCT_FALLBACK_IMG}'">
            </button>`).join('')}
        </div>` : ''}
      </div>

      <!-- INFOS -->
      <div class="pp-info">
        <div class="pp-liga">${escapeHtml(p.ligaLabel)}</div>
        <div class="pp-team">${escapeHtml(p.time)}</div>
        <h1 class="pp-title">${escapeHtml(p.nome)}</h1>
        <div class="pp-tipo">${escapeHtml(versionLabel([p.modelo, p.versao].filter(Boolean).join(' · ')))}</div>
        <p class="pp-descr">${escapeHtml(p.descricao || 'Consulte pelo WhatsApp os tamanhos, o prazo e os detalhes deste modelo.')}</p>
        <span class="product-status ${soldOut ? 'status-sold-out' : ''}">${availabilityLabel(p)}</span>

        <!-- PREÇOS -->
        <div class="pp-prices">
          <div class="pp-price-row">
            <span class="pp-price-label">${productPrice(p) === null ? 'Valor a confirmar' : 'Pix ou cartão em até 3x'}</span>
            <span class="pp-price-val green">${formatPrice(productPrice(p))}</span>
          </div>
        </div>

        <!-- TAMANHOS -->
        ${sizesForProduct.length ? `
          <div class="pp-size-label">Tamanhos cadastrados</div>
          <div class="pp-sizes">
            ${sizesForProduct.map(size => `
              <button class="pp-size-btn" type="button" data-size="${escapeHtml(size.nome)}" ${size.status === 'esgotado' ? 'disabled aria-label="' + escapeHtml(size.nome) + ', esgotado"' : ''}>
                ${escapeHtml(size.nome)}
              </button>`).join('')}
          </div>` : `
          <div class="pp-size-label">Tamanho</div>
          <p class="pp-size-note">Confirme os tamanhos disponíveis pelo WhatsApp.</p>`}

        <!-- CAMPO DE NOME -->
        <div class="pp-name-wrap">
          <input type="text" id="ppName" class="pp-name-input" autocomplete="name"
            placeholder="Seu nome (opcional)" oninput="updatePageWppBtn()">
        </div>

        <!-- BOTÕES -->
        <div class="pp-actions">
          <button class="pp-cart-btn" type="button" onclick="handleAddToCart()" ${soldOut ? 'disabled' : ''}>
            🛒 Adicionar ao carrinho
          </button>
          <a class="pp-wpp-btn" id="ppWppBtn" href="https://wa.me/${WPP}" target="_blank" rel="noopener noreferrer" ${soldOut ? 'aria-disabled="true"' : ''}>
            💬 ${soldOut ? 'Produto esgotado' : 'Consultar pelo WhatsApp'}
          </a>
        </div>

        <!-- VOLTAR -->
        <button class="pp-back-btn" onclick="closePage()">← Voltar ao catálogo</button>
      </div>

    </div>

    <!-- ZOOM -->
    <div class="pp-zoom-overlay" id="ppZoom" onclick="closeZoom()">
      <img id="ppZoomImg" src="" alt="">
    </div>
  `;

  updatePageWppBtn();
  page.classList.add('open');
  page.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  page.querySelectorAll('[data-size]').forEach(button => {
    button.addEventListener('click', () => selectPageSize(button.dataset.size, button));
  });
}

function handleAddToCart() {
  addToCart(currentProduct, selectedSize);
}

function productGallery(product) {
  return product.galeria?.length ? product.galeria : (product.imgs || [product.img]).filter(Boolean).map(url => ({ url, legenda: '' }));
}

function setGalleryImg(i) {
  galleryIndex = i;
  const photo = productGallery(currentProduct)[i];
  if (!photo) return;
  const main = document.getElementById('ppMainImg');
  main.src = photo.url;
  main.alt = photo.legenda || currentProduct.nome;
  document.getElementById('ppCaption').textContent = photo.legenda || '';
  document.querySelectorAll('.pp-thumb').forEach((t, idx) => t.classList.toggle('active', idx === i));
}

function selectPageSize(s, btn) {
  selectedSize = s;
  document.querySelectorAll('.pp-size-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  updatePageWppBtn();
}

function updatePageWppBtn() {
  const p    = currentProduct;
  if (!p) return;
  const nome = document.getElementById('ppName')?.value.trim() || '';
  const saudacao = nome ? `Olá, meu nome é *${nome}*!` : 'Olá!';
  const msg = encodeURIComponent(
    `${saudacao} Tenho interesse na seguinte camisa:\n\n` +
    `👕 *${p.time} - ${p.nome}*\n` +
    `📏 Tamanho: ${selectedSize || 'A confirmar'}\n` +
    `💰 Preço: ${formatPrice(productPrice(p))}\n` +
    `Disponibilidade: ${availabilityLabel(p)}\n\n` +
    `Poderia me passar mais informações?`
  );
  const btn = document.getElementById('ppWppBtn');
  if (!btn) return;
  if (isProductSoldOut(p)) {
    btn.removeAttribute('href');
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('tabindex', '-1');
    return;
  }
  btn.href = `https://wa.me/${WPP}?text=${msg}`;
  btn.removeAttribute('aria-disabled');
  btn.removeAttribute('tabindex');
}

function zoomImg(img) {
  const zoom = document.getElementById('ppZoom');
  document.getElementById('ppZoomImg').src = img.src;
  zoom.classList.add('open');
}
function closeZoom() {
  document.getElementById('ppZoom')?.classList.remove('open');
}

function closePage() {
  detailRequest++;
  const page = document.getElementById('productPage');
  page.classList.remove('open');
  page.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function quickBuy(id) {
  const p   = catalogProducts.find(x => String(x.id) === String(id));
  if (!p || isProductSoldOut(p)) return;
  const msg = encodeURIComponent(
    `Olá! Tenho interesse na seguinte camisa:\n\n` +
    `👕 *${p.time} - ${p.nome}*\n` +
    `📏 Tamanho: A confirmar\n` +
    `💰 Preço: ${formatPrice(productPrice(p))}\n` +
    `Disponibilidade: ${availabilityLabel(p)}\n\n` +
    `Poderia me passar mais informações?`
  );
  window.open(`https://wa.me/${WPP}?text=${msg}`, '_blank');
}

function closeModal(e) {
  if (e.target === document.getElementById('modal')) closePage();
}
function closeModalBtn() { closePage(); }

/* ══════════════════════
   TECLADO
══════════════════════ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.body.classList.contains('catalog-filters-open')) toggleFilters(false);
    else { closeZoom(); closePage(); closeCart(); }
  }
});

/* ══════════════════════
   INIT
══════════════════════ */
function initializeStorefront() {
  window.matchMedia?.('(max-width: 900px)').addEventListener('change', event => {
    if (!event.matches && document.body.classList.contains('catalog-filters-open')) toggleFilters(false);
  });
  document.getElementById('filterPanel').addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !document.body.classList.contains('catalog-filters-open')) return;
    const controls = [...event.currentTarget.querySelectorAll('button, input, select')];
    const edge = event.shiftKey ? controls[0] : controls.at(-1);
    if (document.activeElement === edge) {
      event.preventDefault();
      (event.shiftKey ? controls.at(-1) : controls[0]).focus();
    }
  });
  document.getElementById('filterToggle').addEventListener('click', () => toggleFilters(true));
  for (const id of ['filterClose', 'filterOverlay']) document.getElementById(id).addEventListener('click', () => toggleFilters(false));
  document.getElementById('catalogFacets').addEventListener('change', event => {
    if (!event.target.dataset.facet) return;
    facetFilters[event.target.dataset.facet] = event.target.value;
    currentPage = 1;
    renderGrid();
  });
  document.getElementById('catalogOrder').addEventListener('change', () => { currentPage = 1; renderGrid(); });
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.addEventListener('click', () => setFilter(button.dataset.filter));
  });
  document.getElementById('mobileMenuToggle')?.addEventListener('click', event => {
    const menu = document.getElementById('leagueShortcuts');
    const isOpen = menu.classList.toggle('is-open');
    event.currentTarget.setAttribute('aria-expanded', String(isOpen));
    event.currentTarget.setAttribute('aria-label', isOpen ? 'Fechar categorias' : 'Abrir categorias');
  });
  document.getElementById('leagueShortcuts')?.querySelectorAll('[data-filter]').forEach(button => {
    button.addEventListener('click', () => {
      document.getElementById('leagueShortcuts').classList.remove('is-open');
      document.getElementById('mobileMenuToggle')?.setAttribute('aria-expanded', 'false');
    });
  });

  syncFilterButtons();
  updateSectionsVisibility(currentFilter);
  updateCatalogTitle(currentFilter);
  renderFeaturedTeams();
  initTaglineReveal();
  renderGrid();
  renderCart();
  document.getElementById('copyrightYear').textContent = String(new Date().getFullYear());
}

initializeStorefront();
