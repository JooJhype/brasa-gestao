// Translate only the image search. Ingredient names and the database stay untouched.
// Prefer a local food glossary: it is fast, works offline, and avoids ambiguous
// translations such as Portuguese "prato" becoming a photo of a dinner plate.
const GLOSSARY = [
  [
    'buffalo mozzarella cheese',
    ['mucarela de bufala', 'mussarela de bufala', 'mozarela de bufala', 'mozzarella de bufala'],
  ],
  [
    'mozzarella cheese',
    [
      'queijo mucarela',
      'queijo mussarela',
      'queijo mozarela',
      'mucarela',
      'mussarela',
      'mozarela',
      'mozzarella',
    ],
  ],
  ['Prato cheese', ['queijo prato']],
  ['cheddar cheese', ['queijo cheddar', 'cheddar']],
  ['parmesan cheese', ['queijo parmesao', 'parmesao']],
  ['provolone cheese', ['queijo provolone', 'provolone']],
  ['Swiss cheese', ['queijo suico', 'queijo emmental', 'emmental']],
  ['gorgonzola cheese', ['queijo gorgonzola', 'gorgonzola']],
  ['Minas cheese', ['queijo minas', 'queijo frescal']],
  ['cream cheese', ['queijo cremoso', 'requeijao cremoso', 'requeijao', 'catupiry']],
  ['cheese slices', ['queijo fatiado', 'fatias de queijo']],
  ['cheese', ['queijo', 'queijos']],
  ['Brazilian cheese bread', ['pao de queijo', 'paes de queijo']],
  ['brioche hamburger buns', ['pao de hamburguer brioche', 'pao brioche', 'brioche']],
  [
    'hamburger buns',
    [
      'pao de hamburguer',
      'pao para hamburguer',
      'pao de hamburger',
      'pao hamburger',
      'pao hamburguer',
      'pao com gergelim',
    ],
  ],
  ['bread', ['pao', 'paes']],
  ['chicken burger patties', ['hamburguer de frango', 'hamburguer frango', 'hamburger de frango']],
  [
    'pork burger patties',
    [
      'hamburguer de carne suina',
      'hamburguer de carne de porco',
      'hamburguer de porco',
      'hamburguer suino',
      'hamburger de porco',
    ],
  ],
  [
    'vegetarian burger patties',
    [
      'hamburguer de vegetais',
      'hamburguer vegetariano',
      'hamburguer vegetal',
      'hamburguer vegano',
      'hamburguer de grao de bico',
      'hamburguer de soja',
      'hamburguer de lentilha',
    ],
  ],
  [
    'hamburger patties',
    [
      'hamburguer bovino',
      'hamburguer de carne bovina',
      'hamburguer de carne',
      'carne de hamburguer',
      'carne para hamburguer',
      'hamburguer',
      'hamburger',
    ],
  ],
  [
    'ground chicken',
    ['carne moida de frango', 'carne de frango moida', 'carne moida frango', 'frango moido'],
  ],
  [
    'ground pork',
    [
      'carne moida suina',
      'carne suina moida',
      'carne moida de porco',
      'carne de porco moida',
      'carne moida porco',
      'pernil moido',
    ],
  ],
  ['plant-based ground meat', ['carne moida vegetal', 'carne moida de soja']],
  ['plant-based meat', ['carne vegetal', 'carne de soja']],
  ['ground beef', ['carne bovina moida', 'carne moida bovina', 'carne moida', 'carne bovina']],
  ['beef chuck', ['acem']],
  ['beef brisket', ['peito bovino', 'peito de boi']],
  ['beef sirloin', ['contra file', 'contrafile']],
  ['beef', ['carne de boi', 'carne']],
  ['chicken breast', ['peito de frango']],
  ['shredded chicken', ['frango desfiado']],
  ['chicken', ['frango']],
  ['pork leg', ['carne suina pernil', 'pernil suino', 'pernil de porco', 'pernil']],
  ['pork loin', ['lombo suino', 'lombo de porco', 'lombo']],
  ['pork', ['carne suina', 'carne de porco']],
  ['bacon slices', ['bacon fatiado', 'bacon em fatias']],
  ['bacon', ['bacon']],
  ['smoked sausage', ['linguica calabresa', 'calabresa']],
  ['sausage', ['linguica']],
  ['iceberg lettuce', ['alface americana']],
  ['lettuce', ['alface', 'alfaces']],
  ['arugula', ['rucula']],
  ['watercress', ['agriao']],
  ['red onion', ['cebola roxa', 'cebolas roxas']],
  ['onion', ['cebola', 'cebolas']],
  ['cherry tomatoes', ['tomate cereja', 'tomates cereja']],
  ['tomato', ['tomate', 'tomates']],
  ['pickled cucumbers', ['picles de pepino', 'pepino em conserva', 'picles', 'pickles']],
  ['cucumber', ['pepino', 'pepinos']],
  ['garlic', ['alho']],
  ['potato', ['batata inglesa', 'batata', 'batatas']],
  ['French fries', ['batata frita', 'batatas fritas', 'batata palito', 'batata congelada']],
  ['straw potatoes', ['batata palha']],
  ['sweet potato', ['batata doce']],
  ['corn', ['milho verde', 'milho']],
  ['bell pepper', ['pimentao', 'pimentoes']],
  ['black pepper', ['pimenta do reino']],
  ['paprika', ['paprica defumada', 'paprica']],
  ['chili pepper', ['pimenta dedo de moca', 'pimenta']],
  ['chipotle pepper', ['pimenta chipotle']],
  ['parsley', ['salsinha', 'salsa']],
  ['chives', ['cebolinha']],
  ['oregano', ['oregano']],
  ['eggs', ['ovo', 'ovos']],
  ['mayonnaise', ['maionese caseira', 'maionese']],
  ['ketchup', ['ketchup', 'catchup']],
  ['mustard', ['mostarda']],
  ['barbecue sauce', ['molho barbecue', 'barbecue', 'bbq']],
  ['soy sauce', ['molho de soja', 'shoyu']],
  ['hot sauce', ['molho de pimenta']],
  ['chipotle sauce', ['molho de pimenta chipotle', 'molho de chipotle', 'molho chipotle']],
  ['garlic sauce', ['molho de alho', 'molho alho']],
  ['cheese sauce', ['molho de queijo', 'molho de cheddar']],
  ['mustard sauce', ['molho de mostarda']],
  ['mayonnaise', ['molho de maionese']],
  ['sweet and sour sauce', ['molho agridoce']],
  ['Worcestershire sauce', ['molho ingles']],
  ['tomato sauce', ['molho de tomate']],
  ['olive oil', ['azeite de oliva', 'azeite']],
  ['soybean oil', ['oleo de soja']],
  ['sunflower oil', ['oleo de girassol']],
  ['vegetable oil', ['oleo vegetal', 'oleo']],
  ['butter', ['manteiga']],
  ['margarine', ['margarina']],
  ['milk', ['leite integral', 'leite']],
  ['heavy cream', ['creme de leite']],
  ['wheat flour', ['farinha de trigo']],
  ['breadcrumbs', ['farinha de rosca']],
  ['corn starch', ['amido de milho', 'maisena', 'maizena']],
  ['sugar', ['acucar']],
  ['salt', ['sal refinado', 'sal grosso', 'sal']],
  ['vinegar', ['vinagre']],
  [
    'hamburger takeaway box',
    [
      'caixa para hamburguer',
      'caixa de hamburguer',
      'embalagem de hamburguer',
      'embalagem para hamburguer',
    ],
  ],
  ['paper bag', ['saco de papel', 'sacola de papel', 'saco kraft', 'sacola kraft']],
  ['paper napkins', ['guardanapo', 'guardanapos']],
  ['disposable cup', ['copo descartavel', 'copos descartaveis']],
  ['aluminum foil', ['papel aluminio']],
  ['parchment paper', ['papel manteiga']],
  ['soft drink', ['refrigerante']],
  ['mineral water', ['agua mineral']],
  ['fruit juice', ['suco']],
];

export function normalizeImageQuery(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(
      /\b\d+(?:[.,]\d+)?\s*(?:kg|quilogramas?|quilos?|gramas?|g|litros?|l|ml|mililitros?|unidades?|un|und)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const dictionary = GLOSSARY.flatMap(([query, aliases]) =>
  [...new Set([...aliases, query])].map((alias) => ({ alias: normalizeImageQuery(alias), query })),
).sort((a, b) => b.alias.length - a.alias.length);

function dictionaryMatch(normalized) {
  const surrounded = ` ${normalized} `;
  const contains = (phrase) => surrounded.includes(` ${phrase} `);
  const proteins = [
    contains('frango') && 'chicken',
    /\b(suin[oa]|porco|pernil|lombo)\b/.test(normalized) && 'pork',
    /\b(bovin[oa]|boi)\b/.test(normalized) && 'beef',
  ].filter(Boolean);
  if (proteins.length > 1) return null;
  const protein = proteins[0];
  const isBurger =
    /\b(hamburguer|hamburger)\b/.test(normalized) &&
    !/\b(pao|embalagem|caixa|saco|sacola|papel)\b/.test(normalized);
  const isGroundMeat = contains('carne moida') || /\b(moid[oa])\b/.test(normalized);
  // An explicit protein takes precedence over generic "carne moída" aliases,
  // even when a descriptor (e.g. "resfriada") interrupts the usual phrase.
  if (protein && isBurger)
    return { query: protein === 'beef' ? 'hamburger patties' : `${protein} burger patties` };
  if (protein && isGroundMeat) return { query: `ground ${protein}` };

  const known = dictionary.find(({ alias }) => contains(alias));
  if (!known) return null;
  // Refuse partial ingredient matches inside unfamiliar preparations. A sauce
  // must be translated as a sauce, not as its garlic or pepper ingredient.
  if (contains('molho') && !contains('molho de maionese') && !/sauce$/.test(known.query))
    return null;
  if (contains('pao') && !/bread|buns/.test(known.query)) return null;
  if (isBurger && !/patties/.test(known.query)) return null;
  if (
    isBurger &&
    /^(hamburguer|hamburger)$/.test(known.alias) &&
    /\b(hamburguer|hamburger) de\b/.test(normalized)
  )
    return null;
  if (known.alias === 'carne' && /\bcarne de\b/.test(normalized)) return null;
  return known;
}

// Do not select a band, city, person, or a plate just because it shares a name
// with an ingredient. Plant-only descriptions are intentionally insufficient.
const FOOD_DESCRIPTION =
  /\b(food|ingredient|edible|cheese|bread|bun|meat|beef|pork|poultry|vegetable|fruit|spice|condiment|sauce|cooking|culinary|beverage|drink|packaging|food container|paper bag|napkin)\b/i;
const NON_FOOD_DESCRIPTION =
  /\b(band|musician|person|actor|actress|film|movie|song|album|municipality|city|village|company|brand|surname|given name)\b/i;
const FALLBACK_WARNING =
  'Não foi possível traduzir este item com segurança. Ajuste o termo da busca em inglês ou envie sua própria imagem.';

/**
 * Pure search metadata: this function never reads or writes the ingredient store.
 * Wikidata matches Portuguese names and returns English labels when available.
 * https://www.mediawiki.org/wiki/Wikibase/API
 */
export async function resolveImageQuery(
  input,
  { fetchImpl = globalThis.fetch, signal, timeoutMs = 3500 } = {},
) {
  const originalQuery = String(input ?? '')
    .trim()
    .slice(0, 90);
  const normalized = normalizeImageQuery(originalQuery);
  const original = { originalQuery, query: originalQuery, translated: false, source: 'original' };
  if (normalized.length < 3) return original;

  const known = dictionaryMatch(normalized);
  if (known)
    return {
      originalQuery,
      query: known.query,
      translated: normalizeImageQuery(known.query) !== normalized,
      source: 'dictionary',
    };

  const fallback = { ...original, warning: FALLBACK_WARNING };
  if (typeof fetchImpl !== 'function' || signal?.aborted) return fallback;
  const timeout = AbortSignal.timeout(Math.max(1, Math.min(Number(timeoutMs) || 3500, 10000)));
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    format: 'json',
    search: originalQuery,
    language: 'pt',
    uselang: 'en',
    type: 'item',
    limit: '5',
    origin: '*',
  });
  try {
    const response = await fetchImpl(`https://www.wikidata.org/w/api.php?${params}`, {
      headers: { 'User-Agent': 'BrasaGestao/1.0 (local inventory app; image search)' },
      signal: requestSignal,
    });
    if (!response.ok) return fallback;
    const data = await response.json();
    const candidate = (Array.isArray(data.search) ? data.search : []).find((item) => {
      const label = item.display?.label;
      const description = item.display?.description;
      const matched = normalizeImageQuery(item.match?.text || '');
      return (
        label?.language === 'en' &&
        typeof label.value === 'string' &&
        label.value.trim().length >= 3 &&
        label.value.trim().length <= 90 &&
        /^[\p{L}\p{N} '().,&-]+$/u.test(label.value) &&
        matched === normalized &&
        description?.language === 'en' &&
        FOOD_DESCRIPTION.test(description.value) &&
        !NON_FOOD_DESCRIPTION.test(description.value)
      );
    });
    if (candidate)
      return {
        originalQuery,
        query: candidate.display.label.value.trim(),
        translated: normalizeImageQuery(candidate.display.label.value) !== normalized,
        source: 'wikidata',
      };
  } catch {
    // Network failure must not block ingredient registration or local uploads.
  }
  return fallback;
}
