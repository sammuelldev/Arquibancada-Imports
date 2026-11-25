import path from 'node:path';
import { access } from 'node:fs/promises';
import { createFirebaseBackend } from './lib/firebase-publisher.mjs';
import { importExport } from './lib/yupoo-import.mjs';
import { loadStoreTaxonomy } from './lib/taxonomy.mjs';

const [command, ...args] = process.argv.slice(2);
const defaultFile = 'data/catalogo-local/yupoo-femininas/export.json';
const usage = 'npm run catalog:femininas -- conferir|importar [--arquivo ' + defaultFile +
  '] [--limite 3] [--album ID] [--reprocessar] [--emulador]';
let backend;
try {
  if (!['importar','conferir'].includes(command)) throw new Error(usage);
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (['--emulador','--reprocessar'].includes(key)) options[key] = true;
    else if (['--arquivo','--album','--limite'].includes(key) && args[0] && !args[0].startsWith('--')) options[key] = args.shift();
    else throw new Error(usage);
  }
  const limit = options['--limite'] === undefined ? Infinity : Number(options['--limite']);
  if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('Limite de álbuns inválido.');
  const inputFile = path.resolve(options['--arquivo'] || defaultFile);
  try { await access(inputFile); } catch { throw new Error('Exportação autorizada ausente: ' + inputFile); }
  const emulator = Boolean(options['--emulador']);
  const target = command === 'conferir' ? 'local' : emulator ? 'demo-arquibancada' : 'arquibancada-imports';
  if (command === 'importar') backend = await createFirebaseBackend({ emulator });
  const report = await importExport({ inputFile, stateFile: path.join(path.dirname(inputFile), 'checkpoint-' + target + '.json'),
    taxonomy: await loadStoreTaxonomy(), backend, onlyAlbum: options['--album'], limit, target, force: options['--reprocessar'] });
  console.log(JSON.stringify({ ambiente: target, ...report }, null, 2));
  if (report.falhas.length || report.paginaPendente || report.aguardandoRevisao) process.exitCode = 2;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await backend?.close();
}
