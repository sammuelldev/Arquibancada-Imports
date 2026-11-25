import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { CATEGORY_URL } from '../../../catalogo-femininas.mjs';
import { albumId } from './yupoo-femininas.mjs';

const source = new URL(CATEGORY_URL);
const strip = value => (value || '').replace(/\s+/g, ' ').trim();
function resolve(value, base) {
  try { return value ? new URL(value, base) : null; } catch { return null; }
}

export function parseCategory(html, url) {
  const $ = load(html);
  const ids = new Set(), pages = new Set();
  const number = Number(new URL(url).searchParams.get('page') || 1);
  const grid = $('.showindex__parent, .category__main, .categories__main, .album__parent');
  const links = grid.length ? grid.find('a[href]') : $('a.album__main[href], .showindex__children a[href], a.showindex__children[href]');
  links.each((_, node) => {
    const link = resolve($(node).attr('href'), url);
    if (link?.origin !== source.origin || !/^\/albums\/\d+\/?$/.test(link.pathname)) return;
    if (link.searchParams.has('referrercate') && link.searchParams.get('referrercate') !== '5070410') return;
    ids.add(albumId(link.href));
  });
  if (!ids.size) throw new Error('Grade de álbuns não reconhecida; confira a página da categoria.');
  $('a[href]').each((_, node) => {
    const link = resolve($(node).attr('href'), url);
    if (link?.origin === source.origin && link.pathname === source.pathname) {
      const page = Number(link.searchParams.get('page'));
      if (Number.isInteger(page) && page > number) pages.add(page);
    }
  });
  const total = Number($('[data-total-page]').first().attr('data-total-page') ||
    $('.pagination input[max]').first().attr('max') || 0);
  if (!$('.pagination a[href], [class*="pagination"] a[href]').length &&
      $('[class*="pagination"] [rel="next"], [class*="pagination"] button:not(:disabled)').length && !total) {
    throw new Error('Confira a paginação antes de marcar a categoria como completa.');
  }
  const hasNext = pages.size > 0 || total > number;
  return { url, albumUrls: [...ids].map(id => source.origin + '/albums/' + id),
    nextPageUrl: hasNext ? CATEGORY_URL + '?page=' + (number + 1) : null };
}

export function parseAlbum(html, url) {
  albumId(url);
  const $ = load(html);
  const title = strip($('.showalbumheader__gallerytitle, .showalbumheader__gallerytitlecopy').first().text()
    || $('meta[property="og:title"]').attr('content') || $('h1').first().text());
  const description = strip($('.showalbumheader__gallerydec, .showalbumheader__gallerydesc').first().text());
  const photos = new Map();
  const items = $('.showalbum__children').length ? $('.showalbum__children') : $('.image__main');
  items.each((_, node) => {
    const el = $(node);
    const img = el.is('img') ? el : el.find('img').first();
    const sources = ['data-origin-src','data-original','data-big-src','data-src','src'];
    const best = sources.map(key => el.attr(key) || img.attr(key) || el.find('[' + key + ']').first().attr(key)).map(value => resolve(value, url))
      .find(link => link?.protocol === 'https:' && link.hostname === 'photo.yupoo.com');
    if (!best) return;
    const id = el.attr('data-photoid') || el.attr('data-id') || img.attr('data-id') ||
      createHash('sha256').update(best.origin + best.pathname).digest('hex').slice(0,24);
    if (photos.has(id)) return;
    const caption = strip(el.find('.image__title, .image__desc, figcaption').first().text() ||
      el.attr('data-caption') || img.attr('alt') || el.attr('title'));
    photos.set(id,{ id, url:best.href, caption, verified:false });
  });
  if (!photos.size) throw new Error('Galeria interna não reconhecida; revisão do álbum necessária.');
  return { url, title, description, capturedAt:new Date().toISOString(), photos:[...photos.values()] };
}
