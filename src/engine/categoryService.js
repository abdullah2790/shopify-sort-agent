// categoryService.js
// Sync kategorija iz Shopify metafielda custom.kategorija

const { graphql } = require("../api/shopifyClient");
const db = require("../db");

/**
 * Sync sve kategorije iz Shopify metafielda
 * Čita unique vrijednosti metafielda custom.kategorija sa svih proizvoda
 */
async function syncCategories(shopDomain, accessToken, shopId) {
  console.log(`🔄 [${shopDomain}] Sync kategorija...`);

  try {
    const categories = await fetchCategoriesFromShopify(shopDomain, accessToken);

    if (!categories.length) {
      console.log(`⚠️ Nema kategorija u metafieldu`);
      return [];
    }

    // Dohvati postojeće kategorije iz baze sa season_scores
    const existing = await db.query(
      `SELECT handle, name, season_scores FROM categories WHERE shop_id = $1`,
      [shopId]
    );
    const existingMap = {};
    for (const row of existing.rows) existingMap[row.handle] = row;

    // Upiši nove, ostavi season_scores za postojeće
    for (const cat of categories) {
      const handle = toHandle(cat);
      const existingRow = existingMap[handle];

      await db.query(
        `INSERT INTO categories (shop_id, handle, name, season_scores, synced_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (shop_id, handle) DO UPDATE SET name = $3, synced_at = NOW()`,
        [
          shopId,
          handle,
          cat,
          existingRow ? existingRow.season_scores : JSON.stringify({ Cold: 5, Mild: 5, Warm: 5, Hot: 5 }),
        ]
      );
    }

    console.log(`✅ [${shopDomain}] ${categories.length} kategorija syncirano`);
    return categories;

  } catch (e) {
    console.error(`❌ Sync kategorija greška:`, e.message);
    throw e;
  }
}

/**
 * Dohvati sve unique vrijednosti metafielda custom.kategorija
 */
async function fetchCategoriesFromShopify(shopDomain, accessToken) {
  const query = `
    query($cursor: String) {
      products(first: 250, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            kategorija: metafield(namespace: "custom", key: "kategorija") { value }
            kategorija1: metafield(namespace: "custom", key: "kategorija1") { value }
          }
        }
      }
    }
  `;

  const categories = new Set();
  let cursor = null;
  let hasNext = true;

  while (hasNext) {
    const data = await graphql(shopDomain, accessToken, query, { cursor });
    const page = data?.products;
    if (!page) break;

    for (const edge of page.edges) {
      const val = (edge.node.kategorija?.value || edge.node.kategorija1?.value || "").trim();
      if (val) categories.add(val);
    }

    hasNext = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
    if (hasNext) await new Promise(r => setTimeout(r, 300));
  }

  return [...categories].sort();
}

/**
 * Dohvati kategorije iz baze za jedan shop
 */
async function getCategories(shopId) {
  const r = await db.query(
    `SELECT handle, name, season_scores, is_sprinkler FROM categories WHERE shop_id = $1 ORDER BY name`,
    [shopId]
  );
  return r.rows;
}

/**
 * Sačuvaj season_scores za kategorije
 */
async function saveSeasonScores(shopId, scores) {
  // scores = [{ handle, season_scores: { Cold, Mild, Warm, Hot }, is_sprinkler? }]
  if (!scores.length) return;
  const values = scores.map((_, i) => `($${i*4+1}::jsonb, $${i*4+2}::boolean, $${i*4+3}::int, $${i*4+4}::text)`).join(",");
  const params = scores.flatMap(({ handle, season_scores, is_sprinkler }) => [JSON.stringify(season_scores), is_sprinkler ?? false, shopId, handle]);
  await db.query(
    `UPDATE categories SET season_scores = v.season_scores, is_sprinkler = v.is_sprinkler
     FROM (VALUES ${values}) AS v(season_scores, is_sprinkler, shop_id, handle)
     WHERE categories.shop_id = v.shop_id AND categories.handle = v.handle`,
    params
  );
}

/**
 * Dohvati categoryScores objekt za sortiranje
 * Format: { "Jakne": { Cold: 10, Mild: 5, Warm: 2, Hot: 1 }, ... }
 */
async function getCategoryScoresForSort(shopId) {
  const cats = await getCategories(shopId);
  const result = {};
  for (const cat of cats) {
    result[cat.name] = { ...cat.season_scores, isSprinkler: cat.is_sprinkler || false };
  }
  return result;
}

function toHandle(str) {
  return str.toLowerCase().replace(/\s+/g, "-").replace(/[čć]/g, "c").replace(/š/g, "s").replace(/đ/g, "dj").replace(/ž/g, "z").replace(/[^a-z0-9-]/g, "");
}

module.exports = { syncCategories, getCategories, saveSeasonScores, getCategoryScoresForSort };
