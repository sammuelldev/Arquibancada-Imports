import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCurrentCatalog } from './lib/public-catalog.mjs';
import { loadStoreTaxonomy } from './lib/taxonomy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const command = process.argv[2] ?? 'help';

if (command === 'check') {
  const taxonomy = await loadStoreTaxonomy(root);
  const report = await auditCurrentCatalog(root, taxonomy);
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('Comandos disponíveis: npm run catalog:check | npm run catalog:test');
}
