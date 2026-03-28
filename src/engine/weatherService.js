const https = require("https");
const db    = require("../db");

const DEFAULT_RANGES = [
  { name: "Cold", min: -20, max: 10 },
  { name: "Mild", min: 11,  max: 20 },
  { name: "Warm", min: 21,  max: 28 },
  { name: "Hot",  min: 29,  max: 45 },
];

const DEFAULT_WEATHER_CONFIG = {
  enabled:    false,
  city:       "Sarajevo",
  readHour:   13,
  ranges:     DEFAULT_RANGES,
  lastForecast: null,
};


// ── HTTP helper — prati redirecte (301/302) ────────────────────────────────
function httpsGet(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "SmartSort/1.0" } }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirectsLeft > 0) {
        return httpsGet(res.headers.location, redirectsLeft - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`Weather HTTP ${res.statusCode}`));
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    });
    req.setTimeout(12000, () => { req.destroy(); reject(new Error("Weather timeout")); });
    req.on("error", reject);
  });
}

// ── Fetch forecast for a specific hour of today from wttr.in ───────────────
// wttr.in hourly: time field "0"=00:00, "300"=03:00, "600"=06:00, "1200"=12:00, "1500"=15:00 itd.
async function fetchWeatherForecast(city, targetHour) {
  const url = `https://wttr.in/${encodeURIComponent(city.trim())}?format=j1`;
  const raw  = await httpsGet(url);
  const data = JSON.parse(raw);

  const cond = data.current_condition?.[0];
  if (!cond) throw new Error("Nevaljan odgovor weather API-ja");

  // Pokušaj naći hourly forecast za ciljani sat
  const hourly = data.weather?.[0]?.hourly;
  if (hourly && hourly.length && targetHour != null) {
    let closest = hourly[0];
    let minDiff = Infinity;
    for (const h of hourly) {
      const hHour = parseInt(h.time) / 100; // "1200" → 12
      const diff  = Math.abs(hHour - targetHour);
      if (diff < minDiff) { minDiff = diff; closest = h; }
    }
    return {
      temp:        parseInt(closest.tempC),
      description: closest.weatherDesc?.[0]?.value || cond.weatherDesc?.[0]?.value || "",
      feelsLike:   parseInt(closest.FeelsLikeC ?? closest.tempC),
      humidity:    parseInt(closest.humidity   ?? cond.humidity ?? 0),
    };
  }

  // Fallback: trenutno stanje
  return {
    temp:        parseInt(cond.temp_C),
    description: cond.weatherDesc?.[0]?.value || "",
    feelsLike:   parseInt(cond.FeelsLikeC ?? cond.temp_C),
    humidity:    parseInt(cond.humidity   ?? 0),
  };
}

// ── Map temperature to configured rang ─────────────────────────────────────
function getRangForTemp(temp, ranges) {
  const r = (ranges && ranges.length) ? ranges : DEFAULT_RANGES;
  for (const rang of r) {
    if (temp >= rang.min && temp <= rang.max) return rang.name;
  }
  return temp < r[0].min ? r[0].name : r[r.length - 1].name;
}


// ── DB helpers ─────────────────────────────────────────────────────────────
async function getWeatherConfig(shopId) {
  const r = await db.query(
    `SELECT weather_config FROM shop_configs WHERE shop_id = $1`,
    [shopId]
  );
  const stored = r.rows[0]?.weather_config;
  return { ...DEFAULT_WEATHER_CONFIG, ...(stored || {}) };
}

async function saveWeatherConfig(shopId, config) {
  await db.query(
    `UPDATE shop_configs SET weather_config = $1 WHERE shop_id = $2`,
    [JSON.stringify(config), shopId]
  );
}

// ── Read forecast for targetHour (or cfg.readHour) and persist to DB ───────
// targetHour: sat za koji čitamo prognozu (npr. 13). Ako nije dat, koristi cfg.readHour.
async function readAndStoreWeather(shopId, targetHour) {
  const cfg  = await getWeatherConfig(shopId);
  const city = cfg.city?.trim();
  if (!city) throw new Error("Grad nije konfigurisan u weather postavkama");

  const hour    = targetHour != null ? parseInt(targetHour) : parseInt(cfg.readHour ?? 13);
  const weather = await fetchWeatherForecast(city, hour);
  const rang    = getRangForTemp(weather.temp, cfg.ranges);

  const lastForecast = {
    temp:        weather.temp,
    rang,
    description: weather.description,
    feelsLike:   weather.feelsLike,
    humidity:    weather.humidity,
    forecastHour: hour,
    readAt:      new Date().toISOString(),
    city,
  };

  await saveWeatherConfig(shopId, { ...cfg, lastForecast });
  console.log(`🌤 [shopId=${shopId}] ${city} prognoza za ${hour}:00 → ${weather.temp}°C → ${rang}`);
  return lastForecast;
}

module.exports = {
  fetchWeatherForecast, getRangForTemp,
  getWeatherConfig, saveWeatherConfig,
  readAndStoreWeather,
  DEFAULT_RANGES, DEFAULT_WEATHER_CONFIG,
};
