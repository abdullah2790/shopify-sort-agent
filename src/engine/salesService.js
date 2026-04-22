const db = require("../db");
const { graphql } = require("../api/shopifyClient");

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // re-sync svakih 12 sati

async function syncSales(shopId, shopDomain, accessToken) {
  try {
    const r = await db.query(`SELECT MAX(updated_at) as t FROM product_sales WHERE shop_id = $1`, [shopId]);
    const last = r.rows[0]?.t;
    if (last && (Date.now() - new Date(last).getTime()) < CACHE_TTL_MS) return;

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const q = `
      query($cursor: String) {
        orders(first: 250, after: $cursor, query: "created_at:>${since} financial_status:paid") {
          pageInfo { hasNextPage endCursor }
          edges { node { lineItems(first: 100) { edges { node { product { id } quantity } } } } }
        }
      }
    `;

    const salesMap = {};
    let cursor = null, hasNext = true;
    while (hasNext) {
      const data = await graphql(shopDomain, accessToken, q, { cursor });
      const page = data?.orders;
      if (!page) break;
      for (const e of page.edges) {
        for (const li of e.node.lineItems.edges) {
          const pid = li.node.product?.id?.replace("gid://shopify/Product/", "");
          if (pid) salesMap[pid] = (salesMap[pid] || 0) + (li.node.quantity || 1);
        }
      }
      hasNext = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor;
      if (hasNext) await new Promise(r => setTimeout(r, 300));
    }

    const entries = Object.entries(salesMap);
    await db.query(`DELETE FROM product_sales WHERE shop_id = $1`, [shopId]);
    if (entries.length > 0) {
      const BATCH = 200;
      for (let i = 0; i < entries.length; i += BATCH) {
        const batch = entries.slice(i, i + BATCH);
        const vals = batch.map((_, j) => `($1, $${j * 2 + 2}, $${j * 2 + 3})`).join(",");
        const params = [shopId, ...batch.flatMap(([pid, cnt]) => [pid, cnt])];
        await db.query(`INSERT INTO product_sales (shop_id, product_id, sales_30d) VALUES ${vals}`, params);
      }
    }

    console.log(`✅ [${shopDomain}] Sales sync: ${entries.length} proizvoda, zadnjih 30 dana`);
  } catch (e) {
    console.error(`⚠️ Sales sync greška [${shopDomain}]:`, e.message);
    // Greška nije fatalna — sort nastavlja bez sales signala
  }
}

async function getSalesMap(shopId) {
  try {
    const r = await db.query(`SELECT product_id, sales_30d FROM product_sales WHERE shop_id = $1`, [shopId]);
    const map = {};
    for (const row of r.rows) map[row.product_id] = row.sales_30d;
    return map;
  } catch { return {}; }
}

module.exports = { syncSales, getSalesMap };
