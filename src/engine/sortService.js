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

function normText(t) { return String(t||"").trim().toLowerCase().replace(/č/g,"c").replace(/ć/g,"c").replace(/š/g,"s").replace(/đ/g,"dj").replace(/ž/g,"z"); }
function normCat(c) { const n=normText(c); if(n==="polo majica"||n==="polo majice")return "majice"; return n; }

function autoAdaptConfig(scoredProducts, config) {
  const cfg = { ...config };
  const W = cfg.womenType||"Žene", M = cfg.menType||"Muškarci", U = cfg.unisexType||"Unisex";
  const G = cfg.girlsType||"Djevojčice", B = cfg.boysType||"Dječaci", BB = cfg.babyType||"Bebe";
  const ACC = new Set((cfg.accessoryCategories||[]).map(normCat));
  const PAGE = 24;

  const cnt = { W:0, M:0, U:0, G:0, B:0, BB:0, accW:0, accM:0 };
  const catCounts = {};

  for (const p of scoredProducts) {
    if (p.isSprinkler) continue;
    const nc = normCat(p.category||"");
    const isAcc = ACC.has(nc);
    const type = p.type||"";
    if (!isAcc) catCounts[nc] = (catCounts[nc]||0) + 1;
    if (isAcc) { if (type===M) cnt.accM++; else cnt.accW++; }
    else if (type===W) cnt.W++;
    else if (type===M) cnt.M++;
    else if (type===U) cnt.U++;
    else if (type===G) cnt.G++;
    else if (type===B) cnt.B++;
    else if (type===BB) cnt.BB++;
  }

  // Unisex rasporedi proporcionalno između W i M
  const adWM = cnt.W + cnt.M;
  const uToW = adWM > 0 ? Math.round(cnt.U * cnt.W / adWM) : Math.round(cnt.U / 2);
  const uToM = cnt.U - uToW;
  const effW = cnt.W + uToW, effM = cnt.M + uToM;
  const adults = effW + effM;
  const kids = cnt.G + cnt.B + cnt.BB;
  const accs = cnt.accW + cnt.accM;
  const nonAcc = adults + kids;
  if (nonAcc === 0) return cfg;

  // Acc slotovi (max 6, proporcionalni)
  let accSlots = accs > 0 ? Math.min(6, Math.round(PAGE * accs / (nonAcc + accs))) : 0;
  const main = PAGE - accSlots;

  // Adults vs kids
  let adultSlots = adults > 0 && kids > 0 ? Math.round(main * adults / nonAcc) : adults > 0 ? main : 0;
  let kidsSlots  = main - adultSlots;

  // W vs M
  let wSlots = effW > 0 && effM > 0 ? Math.round(adultSlots * effW / adults) : effW > 0 ? adultSlots : 0;
  let mSlots = adultSlots - wSlots;

  // G, B, BB
  const kt = kids || 1;
  let gSlots  = cnt.G  > 0 ? Math.round(kidsSlots * cnt.G  / kt) : 0;
  let bSlots  = cnt.B  > 0 ? Math.round(kidsSlots * cnt.B  / kt) : 0;
  let bbSlots = cnt.BB > 0 ? kidsSlots - gSlots - bSlots : 0;
  if (bbSlots < 0) { bbSlots = 0; bSlots = kidsSlots - gSlots; }

  // AccW vs AccM
  let accWSlots = accs > 0 ? Math.round(accSlots * cnt.accW / accs) : 0;
  let accMSlots = accSlots - accWSlots;

  // Koriguj zaokruživanje da suma bude tačno 24
  const sum = wSlots + mSlots + gSlots + bSlots + bbSlots + accWSlots + accMSlots;
  const diff = PAGE - sum;
  if (diff !== 0) {
    const candidates = [{k:"w",v:wSlots},{k:"m",v:mSlots},{k:"g",v:gSlots},{k:"b",v:bSlots},{k:"bb",v:bbSlots}]
      .filter(s=>s.v>0).sort((a,b)=>b.v-a.v);
    if (candidates.length) {
      if (candidates[0].k==="w") wSlots+=diff;
      else if (candidates[0].k==="m") mSlots+=diff;
      else if (candidates[0].k==="g") gSlots+=diff;
      else if (candidates[0].k==="b") bSlots+=diff;
      else bbSlots+=diff;
    }
  }

  cfg.womenAdultsPerPage        = Math.max(0, wSlots);
  cfg.menAdultsPerPage          = Math.max(0, mSlots);
  cfg.girlsPerPage              = Math.max(0, gSlots);
  cfg.boysPerPage               = Math.max(0, bSlots);
  cfg.babiesPerPage             = Math.max(0, bbSlots);
  cfg.femaleAccessoriesPerPage  = Math.max(0, accWSlots);
  cfg.maleAccessoriesPerPage    = Math.max(0, accMSlots);

  // Auto firstGender
  if (effW > 0 && effM === 0)       cfg.firstGender = "W";
  else if (effM > 0 && effW === 0)  cfg.firstGender = "M";
  else if (effW > effM * 2)         cfg.firstGender = "W";
  else if (effM > effW * 2)         cfg.firstGender = "M";
  else                              cfg.firstGender = "auto";

  // Auto minCategoryGap — ako jedna kategorija dominira, poveći gap
  if ((cfg.minCategoryGap || 0) === 0) {
    const total = Object.values(catCounts).reduce((s,v)=>s+v,0) || 1;
    const topRatio = Math.max(...Object.values(catCounts), 0) / total;
    if (topRatio > 0.4)      cfg.minCategoryGap = 6;
    else if (topRatio > 0.25) cfg.minCategoryGap = 4;
    else if (topRatio > 0.15) cfg.minCategoryGap = 3;
  }

  return cfg;
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

function calculateScores(products, categoryScores = {}, rangOverride = null, config = {}) {
  const rang = rangOverride || getCurrentRang();
  const variantCounts   = products.map(p => p.variants?.length || 0);
  const inventoryCounts = products.map(p => (p.variants || []).reduce((s, v) => s + (v.inventory_quantity || 0), 0));
  const p95Var = percentile(variantCounts,   config.variantPercentile   ?? 95);
  const p95Inv = percentile(inventoryCounts, config.inventoryPercentile ?? 95);

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
    const rawCat = config.scoreWeightCategory ?? 65;
    const rawVar = config.scoreWeightVariants  ?? 25;
    const rawInv = config.scoreWeightInventory ?? 10;
    const wCat = rawCat <= 1 ? rawCat : rawCat / 100;
    const wVar = rawVar <= 1 ? rawVar : rawVar / 100;
    const wInv = rawInv <= 1 ? rawInv : rawInv / 100;
    const score = parseFloat((12 * (((catScore - 1) / 9) * wCat + varScore * wVar + invScore * wInv)).toFixed(1));

    return { ...p, category, score, isSprinkler: false };
  });
}

/**
 * Dohvati efektivni config za kolekciju:
 * shop config (default) + per-collection override
 */
function mergeConfig(shopConfig, collectionConfig) {
  const base = { ...DEFAULTS, ...(shopConfig || {}) };
  base.fallbacks = { ...DEFAULTS.fallbacks, ...(base.fallbacks || {}) };
  if (!collectionConfig) return base;
  const merged = { ...base, ...collectionConfig };
  // Ispravno: uzimamo shop-level fallbacks kao bazu, pa pregazimo samo ono što kolekcija eksplicitno definiše
  merged.fallbacks = { ...base.fallbacks, ...(collectionConfig?.fallbacks || {}) };
  return merged;
}

async function runSort({ shopId, shopDomain, accessToken, collectionId, shopConfig = {}, collectionConfig = null, trigger = "manual", rangOverride = null }) {
  const start = Date.now();
  try {
    const config = mergeConfig(shopConfig, collectionConfig);

    const categoryScores = await getCategoryScoresForSort(shopId);

    const products = await getCollectionProducts(shopDomain, accessToken, collectionId);
    if (!products.length) return log(shopId, collectionId, trigger, 0, Date.now()-start, "success");

    const scored = calculateScores(products, categoryScores, rangOverride, config);
    const adaptedConfig = autoAdaptConfig(scored, config);
    console.log(`🔧 [${shopDomain}/${collectionId}] Auto-adapt: Ž${adaptedConfig.womenAdultsPerPage} M${adaptedConfig.menAdultsPerPage} G${adaptedConfig.girlsPerPage} B${adaptedConfig.boysPerPage} BB${adaptedConfig.babiesPerPage} first=${adaptedConfig.firstGender} gap=${adaptedConfig.minCategoryGap}`);
    const sorted = sortProducts(scored, adaptedConfig);
    await updateCollectionProductPositions(shopDomain, accessToken, collectionId, sorted);
    await db.query(`UPDATE watched_collections SET last_sorted_at = NOW() WHERE shop_id = $1 AND collection_id = $2`, [shopId, collectionId]);
    console.log(`✅ [${shopDomain}] ${sorted.length} sortirano (${trigger})`);
    return log(shopId, collectionId, trigger, sorted.length, Date.now()-start, "success");
  } catch (err) {
    console.error(`❌ [${shopDomain}]:`, err.message);
    return log(shopId, collectionId, trigger, 0, Date.now()-start, "error", err.message);
  }
}

async function runSortAllCollections({ shopId, shopDomain, accessToken, shopConfig = {}, trigger = "manual", rangOverride = null, collectionDelayMs = 300 }) {
  const res = await db.query(
    `SELECT collection_id, collection_config FROM watched_collections WHERE shop_id = $1 AND active = TRUE`,
    [shopId]
  );
  const results = [];
  for (let i = 0; i < res.rows.length; i++) {
    const row = res.rows[i];
    results.push(await runSort({
      shopId, shopDomain, accessToken,
      collectionId: row.collection_id,
      shopConfig,
      collectionConfig: row.collection_config,
      trigger,
      rangOverride,
    }));
    if (i < res.rows.length - 1) await new Promise(r => setTimeout(r, collectionDelayMs));
  }
  return results;
}

async function runSortPreview({ shopId, shopDomain, accessToken, collectionId, shopConfig = {}, collectionConfig = null, rangOverride = null }) {
  const config = mergeConfig(shopConfig, collectionConfig);
  const rang = rangOverride || getCurrentRang();
  const categoryScores = await getCategoryScoresForSort(shopId);
  const products = await getCollectionProducts(shopDomain, accessToken, collectionId);
  if (!products.length) return { rang, total: 0, products: [] };
  const scored = calculateScores(products, categoryScores, rangOverride, config);
  const adaptedConfig = autoAdaptConfig(scored, config);
  const sorted = sortProducts(scored, adaptedConfig);
  const titleMap = new Map(scored.map(p => [p.id, { title: p.title, color: p.color }]));
  return {
    rang,
    total: sorted.length,
    products: sorted.map(item => ({
      position:  item.position,
      shopifyId: item.shopifyId,
      title:     titleMap.get(item.shopifyId)?.title || "",
      category:  item.category,
      type:      item.type,
      color:     titleMap.get(item.shopifyId)?.color || "",
      score:     item.score,
    })),
  };
}

async function log(shopId, colId, trigger, count, duration, status, err=null) {
  await db.query(`INSERT INTO sort_logs (shop_id, collection_id, trigger, products_sorted, duration_ms, status, error_message) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [shopId, colId, trigger, count, duration, status, err]).catch(()=>{});
  return { collectionId: colId, productsSorted: count, status, error: err };
}

module.exports = { runSort, runSortAllCollections, runSortPreview, getCurrentRang, mergeConfig };
