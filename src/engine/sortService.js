const { getCollectionProducts, updateCollectionProductPositions } = require("../api/shopifyClient");
const { sortProducts } = require("./sorter");
const { getCategoryScoresForSort } = require("./categoryService");
const db = require("../db");
const DEFAULTS = require("../../config/defaults");

// Kalendarski fallback rang kada nije dostupna vremenska prognoza
function getCurrentRang() {
  const m = new Date().getMonth() + 1;
  if (m >= 12 || m <= 2) return "Cold";  // Dec–Feb
  if (m >= 3  && m <= 5) return "Mild";  // Mar–Maj
  if (m >= 6  && m <= 8) return "Hot";   // Jun–Aug
  return "Mild";                          // Sep–Nov
}

function percentile(arr, p) {
  const valid = arr.filter(n => !isNaN(n) && n >= 0);
  if (!valid.length) return 1;
  const sorted = [...valid].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] || 1;
}

function extractCategory(p) {
  // Pokušaj iz metafielda (ako je dohvaćen)
  if (p.kategorija) return p.kategorija;
  // Iz taga kategorija:Jakne
  const tags = (p.tags || "").split(",").map(t => t.trim());
  for (const tag of tags) {
    const m = tag.match(/^(kategorija|category|kat):(.+)$/i);
    if (m) return m[2].trim();
  }
  return String(p.product_type || "").trim();
}

function calculateScores(products, categoryScores = {}, rangOverride = null) {
  const rang = rangOverride || getCurrentRang();
  const variantCounts   = products.map(p => p.variants?.length || 0);
  const inventoryCounts = products.map(p => (p.variants || []).reduce((s, v) => s + (v.inventory_quantity || 0), 0));
  const p95Var = percentile(variantCounts, 95);
  const p95Inv = percentile(inventoryCounts, 95);

  return products.map(p => {
    const tags = (p.tags || "").toLowerCase().split(",").map(t => t.trim());
    if (tags.includes("sprinkler") || tags.includes("spotlight")) return { ...p, score: -1, isSprinkler: true };

    const category = extractCategory(p);
    const catInfo = categoryScores[category] || {};
    if (catInfo.isSprinkler) return { ...p, category, score: -1, isSprinkler: true };
    const catScore = catInfo[rang] ?? 5;
    const variants  = p.variants?.length || 0;
    const inventory = (p.variants || []).reduce((s, v) => s + (v.inventory_quantity || 0), 0);
    const varScore = Math.min(variants,  p95Var) / Math.max(p95Var, 1);
    const invScore = Math.min(inventory, p95Inv) / Math.max(p95Inv, 1);
    const score = parseFloat((12 * (((catScore - 1) / 9) * 0.65 + varScore * 0.25 + invScore * 0.10)).toFixed(1));

    return { ...p, category, score, isSprinkler: false };
  });
}

/**
 * Dohvati efektivni config za kolekciju:
 * shop config (default) + per-collection override
 */
function mergeConfig(shopConfig, collectionConfig) {
  const base = { ...DEFAULTS, ...(shopConfig || {}) };
  if (!collectionConfig) return base;
  return { ...base, ...collectionConfig };
}

async function runSort({ shopId, shopDomain, accessToken, collectionId, shopConfig = {}, collectionConfig = null, trigger = "manual", rangOverride = null }) {
  const start = Date.now();
  try {
    const config = mergeConfig(shopConfig, collectionConfig);

    // Dohvati kategorije iz baze
    const categoryScores = await getCategoryScoresForSort(shopId);

    const products = await getCollectionProducts(shopDomain, accessToken, collectionId);
    if (!products.length) return log(shopId, collectionId, trigger, 0, Date.now()-start, "success");

    const scored = calculateScores(products, categoryScores, rangOverride);
    const sorted = sortProducts(scored, config);
    await updateCollectionProductPositions(shopDomain, accessToken, collectionId, sorted);
    await db.query(`UPDATE watched_collections SET last_sorted_at = NOW() WHERE shop_id = $1 AND collection_id = $2`, [shopId, collectionId]);
    console.log(`✅ [${shopDomain}] ${sorted.length} sortirano (${trigger})`);
    return log(shopId, collectionId, trigger, sorted.length, Date.now()-start, "success");
  } catch (err) {
    console.error(`❌ [${shopDomain}]:`, err.message);
    return log(shopId, collectionId, trigger, 0, Date.now()-start, "error", err.message);
  }
}

async function runSortAllCollections({ shopId, shopDomain, accessToken, shopConfig = {}, trigger = "manual", rangOverride = null }) {
  const res = await db.query(
    `SELECT collection_id, collection_config FROM watched_collections WHERE shop_id = $1 AND active = TRUE`,
    [shopId]
  );
  const results = [];
  for (const row of res.rows) {
    results.push(await runSort({
      shopId, shopDomain, accessToken,
      collectionId: row.collection_id,
      shopConfig,
      collectionConfig: row.collection_config,
      trigger,
      rangOverride,
    }));
    await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

async function log(shopId, colId, trigger, count, duration, status, err=null) {
  await db.query(`INSERT INTO sort_logs (shop_id, collection_id, trigger, products_sorted, duration_ms, status, error_message) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [shopId, colId, trigger, count, duration, status, err]).catch(()=>{});
  return { collectionId: colId, productsSorted: count, status, error: err };
}

module.exports = { runSort, runSortAllCollections, getCurrentRang, mergeConfig };
