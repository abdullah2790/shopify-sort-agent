require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Shops
    await client.query(`CREATE TABLE IF NOT EXISTS shops (
      id SERIAL PRIMARY KEY, shop_domain VARCHAR(255) UNIQUE NOT NULL,
      access_token VARCHAR(255) NOT NULL, email VARCHAR(255),
      installed_at TIMESTAMPTZ DEFAULT NOW(), active BOOLEAN DEFAULT TRUE
    );`);

    // Shop-level config (defaults za sve kolekcije)
    await client.query(`CREATE TABLE IF NOT EXISTS shop_configs (
      id SERIAL PRIMARY KEY, shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
      config JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(shop_id)
    );`);

    // Watched collections + per-collection config override
    await client.query(`CREATE TABLE IF NOT EXISTS watched_collections (
      id SERIAL PRIMARY KEY, shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
      collection_id VARCHAR(50) NOT NULL, collection_title VARCHAR(255),
      active BOOLEAN DEFAULT TRUE, last_sorted_at TIMESTAMPTZ,
      collection_config JSONB DEFAULT NULL,
      UNIQUE(shop_id, collection_id)
    );`);

    // Kategorije (syncaju se iz Shopify metafielda)
    await client.query(`CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY, shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
      handle VARCHAR(255) NOT NULL, name VARCHAR(255) NOT NULL,
      season_scores JSONB NOT NULL DEFAULT '{"Cold":5,"Mild":5,"Warm":5,"Hot":5}',
      synced_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(shop_id, handle)
    );`);

    // Sort logs
    await client.query(`CREATE TABLE IF NOT EXISTS sort_logs (
      id SERIAL PRIMARY KEY, shop_id INTEGER REFERENCES shops(id) ON DELETE CASCADE,
      collection_id VARCHAR(50), trigger VARCHAR(50), products_sorted INTEGER,
      duration_ms INTEGER, status VARCHAR(20), error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );`);

    // Dodaj collection_config kolonu ako ne postoji (za postojeće baze)
    await client.query(`ALTER TABLE watched_collections ADD COLUMN IF NOT EXISTS collection_config JSONB DEFAULT NULL;`);

    // Indeksi
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sort_logs_shop ON sort_logs(shop_id);
      CREATE INDEX IF NOT EXISTS idx_sort_logs_created ON sort_logs(created_at DESC);
      ALTER TABLE shop_configs ADD COLUMN IF NOT EXISTS schedule JSONB DEFAULT '{"enabled":false,"intervalDays":1,"hour":3}';
    CREATE INDEX IF NOT EXISTS idx_categories_shop ON categories(shop_id);
    `);

    await client.query(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_sprinkler BOOLEAN DEFAULT FALSE;`);

    await client.query(`ALTER TABLE shop_configs ADD COLUMN IF NOT EXISTS weather_config JSONB DEFAULT NULL;`);

    // Migracija: pretvori stare season_scores (zima/proljece/ljeto/jesen) u rang formu (Cold/Mild/Warm/Hot)
    await client.query(`
      UPDATE categories
      SET season_scores = jsonb_build_object(
        'Cold', COALESCE((season_scores->>'zima')::numeric,    5),
        'Mild', ROUND(((COALESCE((season_scores->>'proljece')::numeric, 5) + COALESCE((season_scores->>'jesen')::numeric, 5)) / 2.0)::numeric, 1),
        'Warm', COALESCE((season_scores->>'ljeto')::numeric,   5),
        'Hot',  COALESCE((season_scores->>'ljeto')::numeric,   5)
      )
      WHERE season_scores ? 'zima';
    `);

    await client.query("COMMIT");
    console.log("✅ Migracija uspješna");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("❌ Greška:", e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
// Ovaj fajl se poziva ponovo — ALTER TABLE je idempotent
