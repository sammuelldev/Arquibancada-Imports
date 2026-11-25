import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore } from 'firebase/firestore/lite';
import app, { useEmulators } from './firebase-app.js';
import { CATALOG_PATH, isCatalogProduct } from './catalogo-femininas.mjs';

const db = getFirestore(app);
if (useEmulators) connectFirestoreEmulator(db, '127.0.0.1', 8080);

function bounded(request) {
  let timer;
  return Promise.race([request, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Tempo de leitura excedido')), 30000);
  })]).finally(() => clearTimeout(timer));
}

window.catalogLoadProduct = async id => {
  const snapshot = await bounded(getDoc(doc(db, CATALOG_PATH, 'fichas', id)));
  if (!snapshot.exists() || !isCatalogProduct(snapshot.data())) throw new Error('Ficha indisponível');
  return snapshot.data();
};

function status(state, message = '') {
  document.dispatchEvent(new CustomEvent('catalog:status', { detail: { state, message } }));
}

async function loadCatalog() {
  status('loading');
  try {
    const result = await bounded(getDocs(collection(db, CATALOG_PATH, 'itens')));
    const products = result.docs.map(item => ({ id: item.id, data: item.data() }))
      .filter(item => isCatalogProduct(item.data));
    document.dispatchEvent(new CustomEvent('catalog:firestore-products', { detail: products }));
    status('ready');
  } catch {
    status('error', 'Não foi possível carregar as camisas. Tente novamente.');
  }
}

document.getElementById('catalogRetry').addEventListener('click', loadCatalog);
loadCatalog();
