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


function autoAdaptPenalties(scoredProducts) {
  const non = scoredProducts.filter(p => !p.isSprinkler);
  const total = non.length || 1;
  const catCounts = {};
  const colorCounts = {};
  for (const p of non) {
    const nc = normCat(p.category || "");
    catCounts[nc] = (catCounts[nc] || 0) + 1;
    const cl = normText(p.color || "unknown");
    colorCounts[cl] = (colorCounts[cl] || 0) + 1;
  }
  const topCatRatio   = Math.max(...Object.values(catCounts),   0) / total;
  // Exclude "unknown" (products without color data) from color dominance check
  const realColorCounts = Object.fromEntries(Object.entries(colorCounts).filter(([k]) => k !== "unknown"));
  const realColorTotal  = Object.values(realColorCounts).reduce((s, v) => s + v, 0);
  const hasColorData    = realColorTotal / total > 0.3; // at least 30% of products have color
  const topColorRatio   = hasColorData
    ? Math.max(...Object.values(realColorCounts), 0) / realColorTotal
    : 0.15; // no color data → neutral multiplier
  const scores = non.map(p => p.score || 0).filter(s => s >= 0);
  const scoreRange = scores.length ? Math.max(...scores) - Math.min(...scores) : 0;

  // category penalty multiplier
  let cm = topCatRatio > 0.50 ? 1.6 : topCatRatio > 0.35 ? 1.3 : topCatRatio < 0.15 ? 0.8 : 1.0;
  // color penalty multiplier (neutral if no color data)
  let lm = topColorRatio > 0.50 ? 1.5 : topColorRatio > 0.35 ? 1.25 : topColorRatio < 0.15 ? 0.8 : 1.0;

  // Mala kolekcija — ne amplifikuj penale, nema dovoljno alternativa
  if (total < 25) { cm = Math.min(cm, 1.0); lm = Math.min(lm, 1.0); }

  const r = (v, m) => Math.round(v * m * 10) / 10;

  // jitter: compressed scores → more jitter for variety; wide range → less (preserve ranking)
  const jitter = scoreRange < 1.5 ? 0.40 : scoreRange < 3 ? 0.30 : scoreRange < 5 ? 0.22 : 0.15;

  // relaxStep: small collection or few categories → relax faster to fill slots
  const uniqueCats = Object.keys(catCounts).length;
  const relaxStep  = total < 40 ? 0.72 : total < 80 ? 0.76 : uniqueCats < 4 ? 0.75 : 0.80;

  return {
    penaltySameCategory:    Math.max(12, r(14, cm)),
    penaltySameColor:       Math.max(8,  r(10, lm)),
    penaltySameType:        5,
    penaltyInLast2Category: r(7,  cm),
    penaltyInLast2Color:    r(5,  lm),
    penaltyInLast2Type:     2,
    penaltyInLast3Category: r(3,  cm),
    penaltyInLast3Color:    r(2,  lm),
    penaltyInLast3Type:     0.8,
    penaltyInLast4Category: r(1.3, cm),
    penaltyInLast4Color:    r(0.8, lm),
    penaltyInLast4Type:     0.3,
    penaltyInLast5Category: 0,
    penaltyInLast5Color:    0,
    penaltyInLast5Type:     0,
    jitter,
    relaxStep,
  };
}

function autoDetectFallbacks(cnt) {
  const counts = { women: cnt.W, men: cnt.M, unisex: cnt.U, girls: cnt.G, boys: cnt.B, babies: cnt.BB };
  // Build fallback list: siblings ordered by count desc, then rest ordered by count desc, always end with "other"
  function build(siblings, rest) {
    const ord = (arr) => arr.filter(t => counts[t] > 0).sort((a, b) => counts[b] - counts[a]);
    return [...ord(siblings), ...ord(rest), "other"];
  }
  return {
    women:  build(["unisex"], ["men", "other"]),
    men:    build(["unisex"], ["women", "other"]),
    girls:  [...build(["boys", "babies"], []), "women", "men", "other"].filter((v,i,a)=>a.indexOf(v)===i),
    boys:   [...build(["girls", "babies"], []), "men", "women", "other"].filter((v,i,a)=>a.indexOf(v)===i),
    babies: [...build(["girls", "boys"], []), "women", "men", "other"].filter((v,i,a)=>a.indexOf(v)===i),
    accW:   build(["women", "unisex"], ["men"]),
    accM:   build(["men",   "unisex"], ["women"]),
  };
}

function autoAdaptConfig(scoredProducts, config) {
  const cfg = { ...config };
  const W = cfg.womenType||"Žene", M = cfg.menType||"Muškarci", U = cfg.unisexType||"Unisex";
  const G = cfg.girlsType||"Djevojčice", B = cfg.boysType||"Dječaci", BB = cfg.babyType||"Bebe";
  const ACC = new Set((cfg.accessoryCategories||[]).map(normCat));

  const cnt = { W:0, M:0, U:0, G:0, B:0, BB:0, accW:0, accM:0 };
  const catCounts = {};

  for (const p of scoredProducts) {
    if (p.isSprinkler) continue;
    const nc = normCat(p.category||"");
    const isAcc = ACC.has(nc);
    const type = p.product_type||"";
    if (!isAcc) catCounts[nc] = (catCounts[nc]||0) + 1;
    if (isAcc) { if (type===M) cnt.accM++; else cnt.accW++; }
    else if (type===W) cnt.W++;
    else if (type===M) cnt.M++;
    else if (type===U) cnt.U++;
    else if (type===G) cnt.G++;
    else if (type===B) cnt.B++;
    else if (type===BB) cnt.BB++;
  }

  // Unisex split proportionally for firstGender determination
  const adWM = cnt.W + cnt.M;
  const uToW = adWM > 0 ? Math.round(cnt.U * cnt.W / adWM) : Math.round(cnt.U / 2);
  const effW = cnt.W + uToW, effM = cnt.M + (cnt.U - uToW);

  // Redistribucija slotova bez proizvoda
  // Odrasli: ako nema žena → slotovi idu na muškarce i obrnuto
  if (effW === 0 && cfg.womenAdultsPerPage > 0 && effM > 0) {
    cfg.menAdultsPerPage += cfg.womenAdultsPerPage;
    cfg.womenAdultsPerPage = 0;
  }
  if (effM === 0 && cfg.menAdultsPerPage > 0 && effW > 0) {
    cfg.womenAdultsPerPage += cfg.menAdultsPerPage;
    cfg.menAdultsPerPage = 0;
  }

  // Provjeri ima li aksesoarnih proizvoda (uključujući sprinklere koji se ne broje u cnt)
  const ACC_SET = new Set((cfg.accessoryCategories || []).map(c => normCat(c)));
  const totalAccW = scoredProducts.filter(p => ACC_SET.has(normCat(p.category || extractCategory(p) || "")) && (p.product_type||"") === W).length;
  const totalAccM = scoredProducts.filter(p => ACC_SET.has(normCat(p.category || extractCategory(p) || "")) && (p.product_type||"") === M).length;

  // Aksesoari: samo ako NEMA NIJEDNOG (ni sprinklera) → +1 odgovarajućem spolu
  if (totalAccW === 0 && cfg.femaleAccessoriesPerPage > 0) {
    cfg.womenAdultsPerPage += cfg.femaleAccessoriesPerPage;
    cfg.femaleAccessoriesPerPage = 0;
  }
  if (totalAccM === 0 && cfg.maleAccessoriesPerPage > 0) {
    cfg.menAdultsPerPage += cfg.maleAccessoriesPerPage;
    cfg.maleAccessoriesPerPage = 0;
  }

  // Djeca i bebe: nema → split +1M +1Ž po svakom paru slotova
  let orphanKids = 0;
  if (cnt.G  === 0 && cfg.girlsPerPage   > 0) { orphanKids += cfg.girlsPerPage;   cfg.girlsPerPage   = 0; }
  if (cnt.B  === 0 && cfg.boysPerPage    > 0) { orphanKids += cfg.boysPerPage;    cfg.boysPerPage    = 0; }
  if (cnt.BB === 0 && cfg.babiesPerPage  > 0) { orphanKids += cfg.babiesPerPage;  cfg.babiesPerPage  = 0; }
  if (orphanKids > 0) {
    cfg.womenAdultsPerPage += Math.floor(orphanKids / 2);
    cfg.menAdultsPerPage   += Math.ceil(orphanKids  / 2);
  }

  // Auto firstGender
  if (effW > 0 && effM === 0)       cfg.firstGender = "W";
  else if (effM > 0 && effW === 0)  cfg.firstGender = "M";
  else if (effW > effM * 2)         cfg.firstGender = "W";
  else if (effM > effW * 2)         cfg.firstGender = "M";
  else                              cfg.firstGender = "auto";


  // Cross-group redistribucija: 100% dječija kolekcija (nema odraslih)
  // Grid postaje: 8 djevojčice, 8 dječaci, 2 djev.aksesoari, 2 dječ.aksesoari, 2 bebe
  const hasAdults = effW > 0 || effM > 0;
  const hasKids   = cnt.G > 0 || cnt.B > 0 || cnt.BB > 0;
  if (!hasAdults && hasKids) {
    cfg.girlsPerPage             = 8;
    cfg.boysPerPage              = 8;
    cfg.femaleAccessoriesPerPage = 2;
    cfg.maleAccessoriesPerPage   = 2;
    cfg.babiesPerPage            = 2;
    cfg.womenAdultsPerPage       = 0;
    cfg.menAdultsPerPage         = 0;
    console.log(`👶 [kids-only] grid: girls=8 boys=8 accF=2 accM=2 babies=2`);
  }

  cfg.minCategoryGap = 0;

  // Auto fallbacks — ordered by actual product availability in this collection
  cfg.fallbacks = autoDetectFallbacks(cnt);

  // Auto penalties, jitter, relaxStep — derived from collection diversity + score spread
  try {
    Object.assign(cfg, autoAdaptPenalties(scoredProducts));
  } catch(e) {
    console.error("autoAdaptPenalties failed:", e.message);
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
    const accFromDB = Object.keys(categoryScores).filter(k => categoryScores[k].isAccessory);
    if (accFromDB.length > 0) config.accessoryCategories = accFromDB;

    const products = await getCollectionProducts(shopDomain, accessToken, collectionId);
    if (!products.length) return log(shopId, collectionId, trigger, 0, Date.now()-start, "success");

    const scored = calculateScores(products, categoryScores, rangOverride, config);
    const adaptedConfig = autoAdaptConfig(scored, config);
    console.log(`🔧 [${shopDomain}/${collectionId}] adapt: first=${adaptedConfig.firstGender} penCat=${adaptedConfig.penaltySameCategory} penColor=${adaptedConfig.penaltySameColor} penType=${adaptedConfig.penaltySameType} jitter=${adaptedConfig.jitter} relax=${adaptedConfig.relaxStep} fb_W=[${adaptedConfig.fallbacks?.women?.join(",")||""}] fb_M=[${adaptedConfig.fallbacks?.men?.join(",")||""}]`);
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
  const accFromDB = Object.keys(categoryScores).filter(k => categoryScores[k].isAccessory);
  if (accFromDB.length > 0) config.accessoryCategories = accFromDB;
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
      position:    item.position,
      shopifyId:   item.shopifyId,
      title:       titleMap.get(item.shopifyId)?.title || "",
      category:    item.category,
      type:        item.type,
      color:       titleMap.get(item.shopifyId)?.color || "",
      score:       item.score,
      isAccessory: item.isAccessory || false,
      isSprinkler: item.isSprinkler || false,
    })),
  };
}

async function log(shopId, colId, trigger, count, duration, status, err=null) {
  await db.query(`INSERT INTO sort_logs (shop_id, collection_id, trigger, products_sorted, duration_ms, status, error_message) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [shopId, colId, trigger, count, duration, status, err]).catch(()=>{});
  return { collectionId: colId, productsSorted: count, status, error: err };
}

module.exports = { runSort, runSortAllCollections, runSortPreview, getCurrentRang, mergeConfig };
