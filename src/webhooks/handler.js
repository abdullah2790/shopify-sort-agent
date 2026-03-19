const crypto = require("crypto");
const db = require("../db");

function verifyWebhook(rawBody, hmac, secret) {
  const hash = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return hash === hmac;
}

async function registerWebhooks(shop, token, appUrl) {
  const topics = ["orders/create","products/update","app/uninstalled"];
  for (const topic of topics) {
    try {
      await fetch(`https://${shop}/admin/api/2024-01/webhooks.json`, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ webhook: { topic, address: `${appUrl}/webhooks/${topic.replace("/","-")}`, format: "json" } })
      });
    } catch(e) { console.error(`Webhook ${topic}:`, e.message); }
  }
}

async function handleOrderCreated(shop, data) {
  // Bez automatskog resort-a — korisnik ručno pokreće
}

async function handleProductUpdated(shop, data) {
  // Bez automatskog resort-a
}

async function handleAppUninstalled(shop) {
  await db.query(`UPDATE shops SET active = FALSE WHERE shop_domain = $1`, [shop]);
}

module.exports = { verifyWebhook, registerWebhooks, handleOrderCreated, handleProductUpdated, handleAppUninstalled };
