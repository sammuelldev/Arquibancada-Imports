/*
 * Taxonomia inicial do catálogo.
 * As listas indicam classificação para cadastros futuros; não representam estoque.
 */
const CATEGORIAS_CATALOGO = [
  { id: 'todos', label: 'Todos os produtos' },
  { id: 'femininas', label: 'Femininas' },
  { id: 'brasileirao', label: 'Brasileirão', icon: 'icon-brasileirao.png' },
  { id: 'laliga', label: 'La Liga', icon: 'icon-laliga.png' },
  { id: 'premier', label: 'Premier League', icon: 'icon-premier.png' },
  { id: 'bundesliga', label: 'Bundesliga', icon: 'icon-bundesliga.png' },
  { id: 'seriea', label: 'Serie A', icon: 'icon-seriea.png' },
  { id: 'ligue1', label: 'Ligue 1', icon: 'icon-ligue1.png' },
  { id: 'selecoes', label: 'Seleções', icon: 'icon-selecoes.png' },
  { id: 'retro', label: 'Retrô' },
  { id: 'kits_treino', label: 'Kits de treino' },
  { id: 'kits_camisa_calcao', label: 'Kits de camisa e calção' },
  { id: 'outros', label: 'Outros' },
];

const LIGAS_COM_ABA = new Set([
  'brasileirao', 'laliga', 'premier', 'bundesliga', 'seriea', 'ligue1',
]);

const TIMES_POR_LIGA = {
  laliga: [
    'Real Madrid', 'Barcelona', 'Atlético de Madrid', 'Athletic Bilbao',
    'Real Sociedad', 'Sevilla', 'Valencia', 'Villarreal', 'Real Betis',
    'Girona', 'Osasuna', 'Celta de Vigo', 'Getafe', 'Espanyol', 'Mallorca',
    'Rayo Vallecano',
  ],
  premier: [
    'Manchester City', 'Manchester United', 'Liverpool', 'Arsenal', 'Chelsea',
    'Tottenham', 'Newcastle United', 'Aston Villa', 'Everton', 'West Ham',
    'Brighton', 'Crystal Palace', 'Nottingham Forest', 'Fulham',
    'Wolverhampton', 'Bournemouth', 'Brentford', 'Sunderland',
    'Leeds United', 'Burnley',
  ],
  seriea: [
    'Juventus', 'Inter de Milão', 'Milan', 'Napoli', 'Roma', 'Lazio',
    'Atalanta', 'Fiorentina', 'Bologna', 'Torino', 'Genoa', 'Sampdoria',
    'Parma', 'Udinese', 'Cagliari', 'Como',
  ],
  bundesliga: [
    'Bayern de Munique', 'Borussia Dortmund', 'Bayer Leverkusen',
    'RB Leipzig', 'Stuttgart', 'Eintracht Frankfurt', 'Wolfsburg',
    'Borussia Mönchengladbach', 'Werder Bremen', 'Hoffenheim', 'Freiburg',
    'Mainz', 'Union Berlin', 'Schalke 04', 'Hamburg',
  ],
  ligue1: [
    'Paris Saint-Germain', 'Olympique de Marseille', 'Lyon', 'Monaco',
    'Lille', 'Nice', 'Lens', 'Rennes', 'Nantes', 'Strasbourg', 'Toulouse',
    'Montpellier', 'Saint-Étienne',
  ],
  brasileirao: [
    'Flamengo', 'Palmeiras', 'Corinthians', 'São Paulo', 'Santos', 'Vasco',
    'Fluminense', 'Botafogo', 'Grêmio', 'Internacional', 'Atlético Mineiro',
    'Cruzeiro', 'Bahia', 'Fortaleza', 'Sport', 'Vitória', 'Ceará',
    'Athletico Paranaense', 'Coritiba', 'Red Bull Bragantino',
  ],
  primeira_liga: [
    'Benfica', 'Porto', 'Sporting', 'Braga', 'Vitória de Guimarães',
    'Boavista',
  ],
  eredivisie: ['Ajax', 'PSV', 'Feyenoord', 'AZ Alkmaar', 'Twente'],
  saudi_pro_league: ['Al-Nassr', 'Al-Hilal'],
  campeonato_argentino: ['Boca Juniors', 'River Plate'],
  campeonato_escoces: ['Celtic', 'Rangers'],
};

const SELECOES_POSSIVEIS = [
  'Brasil', 'Argentina', 'França', 'Alemanha', 'Espanha', 'Portugal',
  'Inglaterra', 'Itália', 'Holanda', 'Bélgica', 'Croácia', 'Uruguai',
  'Colômbia', 'México', 'Estados Unidos', 'Japão', 'Coreia do Sul',
  'Marrocos', 'Senegal', 'Nigéria', 'Camarões', 'Costa do Marfim', 'Gana',
  'Egito', 'Austrália', 'Arábia Saudita', 'Suíça', 'Áustria', 'Dinamarca',
  'Suécia', 'Noruega', 'Polônia', 'Sérvia', 'Turquia', 'Grécia', 'Chile',
  'Paraguai', 'Equador', 'Peru', 'Costa Rica', 'Canadá', 'País de Gales',
  'Escócia', 'Irlanda', 'Ucrânia', 'República Tcheca', 'Romênia', 'Rússia',
];

const CLUBES_EM_DESTAQUE = [
  'Real Madrid', 'Barcelona', 'Atlético de Madrid', 'Manchester City',
  'Manchester United', 'Liverpool', 'Arsenal', 'Chelsea', 'Tottenham',
  'Bayern de Munique', 'Borussia Dortmund', 'Juventus', 'Inter de Milão',
  'Milan', 'Napoli', 'Paris Saint-Germain', 'Olympique de Marseille',
  'Flamengo', 'Palmeiras', 'Corinthians', 'São Paulo', 'Santos', 'Vasco',
  'Fluminense', 'Botafogo', 'Grêmio', 'Internacional', 'Benfica', 'Porto',
  'Sporting', 'Ajax', 'PSV', 'Al-Nassr', 'Al-Hilal', 'Boca Juniors',
  'River Plate', 'Celtic', 'Rangers',
];

const PAIS_POR_LIGA = {
  laliga: 'Espanha',
  premier: 'Inglaterra',
  seriea: 'Itália',
  bundesliga: 'Alemanha',
  ligue1: 'França',
  brasileirao: 'Brasil',
  primeira_liga: 'Portugal',
  eredivisie: 'Países Baixos',
  saudi_pro_league: 'Arábia Saudita',
  campeonato_argentino: 'Argentina',
  campeonato_escoces: 'Escócia',
};

function normalizarNome(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]/g, '');
}

const SELECOES_NORMALIZADAS = new Set(SELECOES_POSSIVEIS.map(normalizarNome));
const TIME_PARA_LIGA = new Map(
  Object.entries(TIMES_POR_LIGA).flatMap(([liga, times]) =>
    times.map(time => [normalizarNome(time), liga])
  )
);
const TIME_DESTAQUE_NORMALIZADO = new Set(CLUBES_EM_DESTAQUE.map(normalizarNome));

function classificarProduto(produto) {
  const time = normalizarNome(produto.time);
  if (produto.categoria === 'selecao' || SELECOES_NORMALIZADAS.has(time)) {
    return 'selecoes';
  }

  const liga = TIME_PARA_LIGA.get(time) || produto.liga || 'outros';
  return LIGAS_COM_ABA.has(liga) ? liga : 'outros';
}

function paisDoProduto(produto) {
  if (produto.categoria === 'selecao' || SELECOES_NORMALIZADAS.has(normalizarNome(produto.time))) {
    return produto.pais || produto.time;
  }

  const liga = TIME_PARA_LIGA.get(normalizarNome(produto.time)) || produto.liga;
  return produto.pais || PAIS_POR_LIGA[liga] || 'Não informado';
}
