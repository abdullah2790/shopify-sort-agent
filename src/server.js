require("dotenv").config();
const express   = require("express");
const cors      = require("cors");
const helmet    = require("helmet");
const rateLimit = require("express-rate-limit");
const cron      = require("node-cron");
const path      = require("path");
const db        = require("./db");
const { verifyWebhook, registerWebhooks, handleAppUninstalled } = require("./webhooks/handler");
const { buildInstallUrl, exchangeCodeForToken, getCollections } = require("./api/shopifyClient");
const { runSort, runSortAllCollections, runSortPreview } = require("./engine/sortService");
const { syncCategories, getCategories, saveSeasonScores } = require("./engine/categoryService");
const { getWeatherConfig, saveWeatherConfig, readAndStoreWeather, getWeatherRangOverride } = require("./engine/weatherService");
const DEFAULTS = require("../config/defaults");

const app  = express();
const PORT = process.env.PORT || 3000;

function mergeWithDefaults(config) {
  const merged = { ...DEFAULTS, ...(config || {}) };
  merged.fallbacks = { ...DEFAULTS.fallbacks, ...(config?.fallbacks || {}) };
  return merged;
}

function getCredentials(appIndex) {
  if (appIndex === 3 && process.env.SHOPIFY_API_KEY_3) {
    return { key: process.env.SHOPIFY_API_KEY_3, secret: process.env.SHOPIFY_API_SECRET_3 };
  }
  if (appIndex === 2 && process.env.SHOPIFY_API_KEY_2) {
    return { key: process.env.SHOPIFY_API_KEY_2, secret: process.env.SHOPIFY_API_SECRET_2 };
  }
  return { key: process.env.SHOPIFY_API_KEY, secret: process.env.SHOPIFY_API_SECRET };
}

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, frameguard: false }));
app.use(cors());
app.use("/api/", rateLimit({ windowMs: 60_000, max: 200 }));
app.use((req, res, next) => {
  if (req.path.startsWith("/webhooks/")) {
    let data = ""; let size = 0;
    req.on("data", c => { size += c.length; if (size > 1e6) { res.status(413).send("Too large"); req.destroy(); return; } data += c; });
    req.on("end", () => { req.rawBody = data; next(); });
  } else { express.json()(req, res, next); }
});

const frontendBuild = path.join(__dirname, "../frontend/build");
app.use(express.static(frontendBuild));

// ── OAuth ──────────────────────────────────────────────────────────────────
function makeInstallHandler(appIndex) {
  return (req, res) => {
    const { shop } = req.query;
    if (!shop) return res.status(400).send("Nedostaje shop");
    const { key } = getCredentials(appIndex);
    const callbackUrl = appIndex === 3
      ? `${process.env.SHOPIFY_APP_URL}/auth/callback3`
      : appIndex === 2
      ? `${process.env.SHOPIFY_APP_URL}/auth/callback2`
      : `${process.env.SHOPIFY_APP_URL}/auth/callback`;
    const { url } = buildInstallUrl(shop, key, callbackUrl, "read_products,write_products,read_orders");
    res.redirect(url);
  };
}

function makeCallbackHandler(appIndex) {
  return async (req, res) => {
    const { shop, code } = req.query;
    if (!shop || !code) return res.status(400).send("Nevaljani parametri");
    try {
      const { key, secret } = getCredentials(appIndex);
      const accessToken = await exchangeCodeForToken(shop, key, secret, code);
      const result = await db.query(`INSERT INTO shops (shop_domain, access_token) VALUES ($1, $2) ON CONFLICT (shop_domain) DO UPDATE SET access_token=$2, active=TRUE RETURNING id`, [shop, accessToken]);
      const shopId = result.rows[0].id;
      await db.query(`INSERT INTO shop_configs (shop_id, config) VALUES ($1, $2) ON CONFLICT (shop_id) DO NOTHING`, [shopId, JSON.stringify(DEFAULTS)]);
      await registerWebhooks(shop, accessToken, process.env.SHOPIFY_APP_URL);
      syncCategories(shop, accessToken, shopId).catch(console.error);
      res.redirect(`/dashboard?shop=${shop}`);
    } catch (err) { res.status(500).send("Greška: " + err.message); }
  };
}

app.get("/auth/install", makeInstallHandler(1));
app.get("/auth/install2", makeInstallHandler(2));
app.get("/auth/install3", makeInstallHandler(3));
app.get("/auth/callback", makeCallbackHandler(1));
app.get("/auth/callback2", makeCallbackHandler(2));
app.get("/auth/callback3", makeCallbackHandler(3));

// ── Webhooks ───────────────────────────────────────────────────────────────
app.post("/webhooks/app-uninstalled", async (req, res) => {
  const hmac = req.headers["x-shopify-hmac-sha256"], shop = req.headers["x-shopify-shop-domain"];
  const { secret: s1 } = getCredentials(1);
  const { secret: s2 } = getCredentials(2);
  if (!verifyWebhook(req.rawBody, hmac, s1) && !verifyWebhook(req.rawBody, hmac, s2)) return res.status(401).send("Unauthorized");
  res.status(200).send("OK"); handleAppUninstalled(shop).catch(console.error);
});
app.post("/webhooks/orders-create", (req, res) => res.status(200).send("OK"));
app.post("/webhooks/products-update", async (req, res) => {
  const hmac = req.headers["x-shopify-hmac-sha256"], shop = req.headers["x-shopify-shop-domain"];
  if (!hmac || !shop) return res.status(401).send("Unauthorized");
  const { secret: s1 } = getCredentials(1);
  const { secret: s2 } = getCredentials(2);
  if (!verifyWebhook(req.rawBody, hmac, s1) && !verifyWebhook(req.rawBody, hmac, s2)) return res.status(401).send("Unauthorized");
  res.status(200).send("OK");
  // Ne syncaj kategorije na products/update — sort triggeruje ovaj webhook za svaki proizvod
});

// ── Kolekcije ──────────────────────────────────────────────────────────────
app.get("/api/collections", async (req, res) => {
  const { shop } = req.query;
  try { const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" }); res.json({ collections: await getCollections(shop, s.access_token) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/watched-collections", async (req, res) => {
  const { shop } = req.query;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    const r = await db.query(`SELECT * FROM watched_collections WHERE shop_id = $1 ORDER BY id`, [s.id]);
    res.json({ collections: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/watched-collections", async (req, res) => {
  const { shop, collectionId, collectionTitle, active } = req.body;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    await db.query(`INSERT INTO watched_collections (shop_id, collection_id, collection_title, active) VALUES ($1,$2,$3,$4) ON CONFLICT (shop_id, collection_id) DO UPDATE SET active=$4, collection_title=$3`, [s.id, collectionId, collectionTitle, active !== false]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/watched-collections/add-all", async (req, res) => {
  const { shop } = req.body;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    const cols = await getCollections(shop, s.access_token);
    for (const col of cols) {
      await db.query(
        `INSERT INTO watched_collections (shop_id, collection_id, collection_title, active) VALUES ($1,$2,$3,true) ON CONFLICT (shop_id, collection_id) DO UPDATE SET active=true, collection_title=$3`,
        [s.id, col.id, col.title]
      );
    }
    res.json({ ok: true, added: cols.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/collection-config", async (req, res) => {
  const { shop, collectionId } = req.query;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    const r = await db.query(`SELECT collection_config FROM watched_collections WHERE shop_id = $1 AND collection_id = $2`, [s.id, collectionId]);
    const shopCfg = mergeWithDefaults(s.config);
    const colCfg  = r.rows[0]?.collection_config || null;
    const merged  = { ...shopCfg, ...(colCfg || {}) };
    merged.fallbacks = { ...shopCfg.fallbacks, ...(colCfg?.fallbacks || {}) };
    res.json({ shopConfig: shopCfg, collectionConfig: colCfg, merged });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/collection-config", async (req, res) => {
  const { shop, collectionId, config } = req.body;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    await db.query(`UPDATE watched_collections SET collection_config = $1 WHERE shop_id = $2 AND collection_id = $3`, [config===null?null:JSON.stringify(config), s.id, collectionId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Shop config ────────────────────────────────────────────────────────────
app.get("/api/config", async (req, res) => {
  const { shop } = req.query;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    const cfg = mergeWithDefaults(s.config);
    res.json({ config: cfg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/config", async (req, res) => {
  const { shop, config } = req.body;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    const merged = mergeWithDefaults(config);
    await db.query(`UPDATE shop_configs SET config = $1, updated_at = NOW() WHERE shop_id = $2`, [JSON.stringify(merged), s.id]);
    res.json({ ok: true, config: merged });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Schedule ───────────────────────────────────────────────────────────────
app.get("/api/schedule", async (req, res) => {
  const { shop } = req.query;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    const r = await db.query(`SELECT schedule FROM shop_configs WHERE shop_id = $1`, [s.id]);
    res.json({ schedule: r.rows[0]?.schedule || { enabled: false, intervalDays: 1, hour: 3, minute: 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/schedule", async (req, res) => {
  const { shop, schedule } = req.body;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    await db.query(`UPDATE shop_configs SET schedule = $1 WHERE shop_id = $2`, [JSON.stringify(schedule), s.id]);
    // Restart cron taskova
    console.log(`💾 [PUT /api/schedule] shop=${shop} schedule=${JSON.stringify(schedule)}`);
    scheduleManager.update(shop, schedule);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Kategorije ─────────────────────────────────────────────────────────────
app.get("/api/categories", async (req, res) => {
  const { shop } = req.query;
  try { const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" }); res.json({ categories: await getCategories(s.id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Sync + opciono sačuvaj scoreve u istom pozivu
app.post("/api/categories/sync", async (req, res) => {
  const { shop, scores } = req.body;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    res.status(202).json({ message: "Sync pokrenut" });
    // Ako su poslati scorevi — sačuvaj ih prije synca
    if (scores && scores.length) await saveSeasonScores(s.id, scores);
    await syncCategories(shop, s.access_token, s.id);
  } catch (e) { console.error("Sync greška:", e.message); }
});

app.put("/api/categories/scores", async (req, res) => {
  const { shop, scores } = req.body;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    await saveSeasonScores(s.id, scores);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Sort ───────────────────────────────────────────────────────────────────
app.post("/api/sort", async (req, res) => {
  const { shop, collectionId } = req.body;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    const colRow = await db.query(`SELECT collection_config FROM watched_collections WHERE shop_id=$1 AND collection_id=$2`, [s.id, collectionId]);
    const rangOverride = await getWeatherRangOverride(s.id).catch(() => null);
    const result = await runSort({ shopId: s.id, shopDomain: shop, accessToken: s.access_token, collectionId, shopConfig: s.config||DEFAULTS, collectionConfig: colRow.rows[0]?.collection_config||null, trigger: "manual", rangOverride });
    if (result.status === "error") return res.status(500).json({ error: result.error || "Greška pri sortiranju" });
    res.json({ ok: true, productsSorted: result.productsSorted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/sort-all", async (req, res) => {
  const { shop } = req.body;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    const rangOverride = await getWeatherRangOverride(s.id).catch(() => null);
    res.status(202).json({ message: "Sort svih pokrenut" });
    await runSortAllCollections({ shopId: s.id, shopDomain: shop, accessToken: s.access_token, shopConfig: s.config||DEFAULTS, trigger: "manual", rangOverride });
  } catch (e) { console.error("Sort all greška:", e.message); }
});

app.get("/api/sort-preview", async (req, res) => {
  const { shop, collectionId } = req.query;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    const colRow = await db.query(`SELECT collection_config FROM watched_collections WHERE shop_id=$1 AND collection_id=$2`, [s.id, collectionId]);
    const rangOverride = await getWeatherRangOverride(s.id).catch(() => null);
    const result = await runSortPreview({ shopId: s.id, shopDomain: shop, accessToken: s.access_token, collectionId, shopConfig: s.config||DEFAULTS, collectionConfig: colRow.rows[0]?.collection_config||null, rangOverride });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/watched-collections/folder", async (req, res) => {
  const { shop, collectionId, folder } = req.body;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    await db.query(`UPDATE watched_collections SET folder = $1 WHERE shop_id = $2 AND collection_id = $3`, [folder || null, s.id, collectionId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/watched-collections/bulk-remove", async (req, res) => {
  const { shop, collectionIds, all } = req.body;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    if (all) {
      await db.query(`UPDATE watched_collections SET active=FALSE WHERE shop_id=$1`, [s.id]);
    } else if (Array.isArray(collectionIds) && collectionIds.length) {
      await db.query(`UPDATE watched_collections SET active=FALSE WHERE shop_id=$1 AND collection_id=ANY($2)`, [s.id, collectionIds]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/sync-all-collections", async (req, res) => {
  const { shop } = req.body;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    const allCols = await getCollections(shop, s.access_token, "published_status:published");
    const all = allCols.filter(col => col.productsCount > 0);
    let added = 0;
    for (const col of all) {
      const r = await db.query(
        `INSERT INTO watched_collections (shop_id, collection_id, collection_title, active)
         VALUES ($1,$2,$3,TRUE)
         ON CONFLICT (shop_id, collection_id) DO UPDATE SET active=TRUE, collection_title=$3
         RETURNING (xmax = 0) AS inserted`,
        [s.id, col.id, col.title]
      );
      if (r.rows[0]?.inserted) added++;
    }
    res.json({ ok: true, total: all.length, added });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Weather config ─────────────────────────────────────────────────────────
app.get("/api/weather-config", async (req, res) => {
  const { shop } = req.query;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    res.json({ weatherConfig: await getWeatherConfig(s.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/weather-config", async (req, res) => {
  const { shop, weatherConfig } = req.body;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    await saveWeatherConfig(s.id, weatherConfig);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/weather/read", async (req, res) => {
  const { shop } = req.body;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    const forecast = await readAndStoreWeather(s.id);
    res.json({ ok: true, forecast });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/logs", async (req, res) => {
  const { shop, limit = 50 } = req.query;
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    const r = await db.query(`SELECT * FROM sort_logs WHERE shop_id = $1 ORDER BY created_at DESC LIMIT $2`, [s.id, limit]);
    const count = await db.query(`SELECT COUNT(*) FROM sort_logs WHERE shop_id = $1`, [s.id]);
    res.json({ logs: r.rows, total: parseInt(count.rows[0].count) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/logs/cleanup", async (req, res) => {
  const { shop, olderThanDays } = req.body;
  const days = parseInt(olderThanDays);
  if (!days || days < 1) return res.status(400).json({ error: "Nevažeći broj dana" });
  try {
    const s = await getShop(shop); if (!s) return res.status(404).json({ error: "Shop nije nađen" });
    const r = await db.query(
      `DELETE FROM sort_logs WHERE shop_id = $1 AND created_at < NOW() - INTERVAL '1 day' * $2`,
      [s.id, days]
    );
    res.json({ ok: true, deleted: r.rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/health", (req, res) => res.json({ status: "ok", time: new Date() }));
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(frontendBuild, "index.html"), err => {
    if (err) { const { shop } = req.query; res.send(`<html><body><h2>Smart Sort</h2><p>${shop}</p></body></html>`); }
  });
});
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendBuild, "index.html"), err => { if (err) res.status(404).send("Not found"); });
});

// ── Schedule Manager ───────────────────────────────────────────────────────
// Drži aktivne cron taskove po shopu
const scheduleTasks = {};

const scheduleManager = {
  update(shopDomain, schedule) {
    // Zaustavi stari task
    if (scheduleTasks[shopDomain]) { scheduleTasks[shopDomain].stop(); delete scheduleTasks[shopDomain]; }
    if (!schedule?.enabled) return;

    const hour        = parseInt(schedule.hour   ?? 3);
    const minute      = parseInt(schedule.minute ?? 0);
    const intervalDays = parseInt(schedule.intervalDays ?? 1);

    const pattern = `${minute} ${hour} * * *`;

    scheduleTasks[shopDomain] = cron.schedule(pattern, async () => {
      try {
        // Provjeri interval — skip ako nije prošlo dovoljno vremena
        const s = await getShop(shopDomain).catch(()=>null);
        if (!s) return;

        if (intervalDays > 1) {
          const lastLog = await db.query(`SELECT created_at FROM sort_logs WHERE shop_id=$1 AND trigger='cron' ORDER BY created_at DESC LIMIT 1`, [s.id]);
          if (lastLog.rows.length) {
            const daysSince = (Date.now() - new Date(lastLog.rows[0].created_at).getTime()) / (1000*60*60*24);
            if (daysSince < intervalDays - 0.5) { console.log(`⏭ [${shopDomain}] Skip — interval ${intervalDays}d, prošlo ${daysSince.toFixed(1)}d`); return; }
          }
        }

        // Čitaj prognozu za konfigurisani sat (npr. 13:00) u trenutku pokretanja sorta
        const weatherReadHour = parseInt(schedule.weatherReadHour ?? 13);
        let rangOverride = null;
        const wCfg = await getWeatherConfig(s.id).catch(() => null);
        if (wCfg?.enabled) {
          try {
            const forecast = await readAndStoreWeather(s.id, weatherReadHour);
            rangOverride = forecast.rang;
            console.log(`🌡 [${shopDomain}] Prognoza za ${weatherReadHour}:00 → ${forecast.temp}°C → ${rangOverride}`);
          } catch (e) {
            console.error(`❌ [${shopDomain}] Weather greška (sort nastavlja bez prognoze):`, e.message);
          }
        }

        // Sortiraj sve kolekcije (sa pauzom između)
        const collectionDelayMs = parseInt(schedule.collectionDelaySeconds ?? 0) * 1000 || 300;
        console.log(`⏰ [${shopDomain}] Schedule sort pokrenut (pauza između kolekcija: ${collectionDelayMs/1000}s)`);
        await runSortAllCollections({ shopId: s.id, shopDomain, accessToken: s.access_token, shopConfig: s.config||DEFAULTS, trigger: "cron", rangOverride, collectionDelayMs });
      } catch (err) {
        console.error(`❌ [${shopDomain}] Schedule greška (cron ostaje aktivan):`, err.message);
      }
    }, { timezone: "Europe/Sarajevo" });

    const weatherReadHour = parseInt(schedule.weatherReadHour ?? 13);
    console.log(`📅 [${shopDomain}] Schedule aktivan: svaki ${intervalDays} dan(a) u ${hour}:${String(minute).padStart(2,"0")} | čita prognozu za ${weatherReadHour}:00`);
  },

  async init() {
    // Učitaj sve aktivne schedule-ove pri startu servera
    try {
      const col = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='shop_configs' AND column_name='schedule'`);
      if (!col.rows.length) {
        console.warn("⚠️  Kolona 'schedule' ne postoji u shop_configs — pokreni: node src/db/migrate.js");
        return;
      }
      const r = await db.query(`SELECT s.shop_domain, sc.schedule FROM shops s JOIN shop_configs sc ON sc.shop_id=s.id WHERE s.active=TRUE AND sc.schedule->>'enabled'='true'`);
      for (const row of r.rows) this.update(row.shop_domain, row.schedule);
      console.log(`📅 Schedule inicijalizovan za ${r.rows.length} shopova`);
    } catch (e) { console.error("Schedule init greška:", e.message); }
  }
};

async function getShop(domain) {
  const r = await db.query(`SELECT s.*, sc.config FROM shops s LEFT JOIN shop_configs sc ON sc.shop_id = s.id WHERE s.shop_domain = $1 AND s.active = TRUE`, [domain]);
  return r.rows[0] ?? null;
}

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`🚀 Server pokrenut na portu ${PORT}`);
  await scheduleManager.init();
});
module.exports = app;
