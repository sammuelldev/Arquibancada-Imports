import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { classifyProduct, parseKitVersion, parseSeason } from './normalization.mjs';

export async function loadCurrentProducts(root = process.cwd()) {
  const filename = path.join(root, 'produtos.js');
  const source = await readFile(filename, 'utf8');
  const context = vm.createContext({});
  return Array.from(vm.runInContext(`${source}\n;produtos`, context, { filename }));
}

export async function auditCurrentCatalog(root, taxonomy) {
  const products = await loadCurrentProducts(root);
  const rows = [];
  for (const product of products) {
    const classification = classifyProduct({ team: product.time, declaredKind: product.categoria === 'selecao' ? 'national_team' : 'club', league: product.liga, retro: parseKitVersion(product.versao, product.nome).retro }, taxonomy);
    const season = parseSeason(product.temporada);
    const imagePaths = [...new Set([product.img, ...(product.imgs ?? [])].filter(Boolean))];
    const missingImages = [];
    for (const image of imagePaths) {
      try { await access(path.resolve(root, image)); } catch { missingImages.push(image); }
    }
    rows.push({ id: product.id, team: product.time, category: classification.primaryId, retro: classification.retro, season: season.label, missingImages });
  }
  return {
    productCount: products.length,
    categoryCounts: Object.fromEntries([...new Set(rows.map(row => row.category))].map(id => [id, rows.filter(row => row.category === id).length])),
    retroCount: rows.filter(row => row.retro).length,
    missingImageCount: rows.reduce((sum, row) => sum + row.missingImages.length, 0),
    rows,
  };
}
