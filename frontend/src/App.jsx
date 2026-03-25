import { useState, useEffect, useCallback, useRef } from "react";
import {
  AppProvider, Page, Card, Tabs, ResourceList, ResourceItem,
  Text, Button, Badge, Banner, Spinner, Select,
  VerticalStack, HorizontalStack, EmptyState, Modal, DataTable,
  TextField, FormLayout, Combobox, Listbox, AutoSelection,
} from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import en from "@shopify/polaris/locales/en.json";

const shop = new URLSearchParams(window.location.search).get("shop") || "";

const RANGS = ["Cold", "Mild", "Warm", "Hot"];
const RANG_INFO = {
  Cold: { emoji:"❄️",  label:"Cold",  bg:"#e8f4f8", border:"#b0d4e8", color:"#1a5f7a" },
  Mild: { emoji:"🌤",  label:"Mild",  bg:"#eaf7ee", border:"#a8d5b5", color:"#1a6b3a" },
  Warm: { emoji:"☀️",  label:"Warm",  bg:"#fffbe6", border:"#f0d070", color:"#7a5a00" },
  Hot:  { emoji:"🔥",  label:"Hot",   bg:"#fdecea", border:"#f0a0a0", color:"#7a1a1a" },
};

const DEFAULT_WEATHER_RANGES = [
  { name: "Cold", min: -20, max: 10 },
  { name: "Mild", min: 11,  max: 20 },
  { name: "Warm", min: 21,  max: 28 },
  { name: "Hot",  min: 29,  max: 45 },
];
const DEFAULT_WEATHER_CONFIG = {
  enabled: false, city: "Sarajevo", readHour: 6,
  ranges: DEFAULT_WEATHER_RANGES, lastForecast: null,
};

export default function App() {
  return <AppProvider i18n={en}><SortApp /></AppProvider>;
}

function SortApp() {
  const [tab, setTab]               = useState(0);
  const [collections, setCollections] = useState([]);
  const [watched, setWatched]       = useState([]);
  const [logs, setLogs]             = useState([]);
  const [shopConfig, setShopConfig] = useState(null);
  const [categories, setCategories] = useState([]);
  const [schedule, setSchedule]     = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [success, setSuccess]       = useState(null);
  const [sorting, setSorting]       = useState(null);
  const [selectedCols, setSelectedCols] = useState([]);
  const [weatherConfig, setWeatherConfig] = useState(null);
  const [addModal, setAddModal]     = useState(false);
  const [selected, setSelected]     = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [configModal, setConfigModal] = useState(null);

  // Ref na trenutne scoreve kategorija — za auto-save
  const catScoresRef = useRef({});
  const sprinklersRef = useRef({});

  const loadData = useCallback(async () => {
    if (!shop) return;
    setLoading(true);
    try {
      const [c, w, l, cfg, cats, sch, wth] = await Promise.all([
        fetch(`/api/collections?shop=${shop}`).then(r=>r.json()),
        fetch(`/api/watched-collections?shop=${shop}`).then(r=>r.json()),
        fetch(`/api/logs?shop=${shop}&limit=20`).then(r=>r.json()),
        fetch(`/api/config?shop=${shop}`).then(r=>r.json()),
        fetch(`/api/categories?shop=${shop}`).then(r=>r.json()),
        fetch(`/api/schedule?shop=${shop}`).then(r=>r.json()),
        fetch(`/api/weather-config?shop=${shop}`).then(r=>r.json()),
      ]);
      setCollections(c.collections||[]);
      setWatched(w.collections||[]);
      setLogs(l.logs||[]);
      setShopConfig(cfg.config||{});
      setCategories(cats.categories||[]);
      setSchedule(sch.schedule||{ enabled:false, intervalDays:1, hour:3, minute:0 });
      setWeatherConfig(wth.weatherConfig||DEFAULT_WEATHER_CONFIG);
    } catch { setError("Greška pri učitavanju."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-save scoreva i sprinklera prije osvježavanja
  async function saveCurrentScores() {
    const scores = Object.entries(catScoresRef.current).map(([handle, season_scores]) => ({
      handle,
      season_scores,
      is_sprinkler: sprinklersRef.current[handle] || false
    }));
    if (!scores.length) return;
    try {
      await fetch("/api/categories/scores", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, scores}) });
    } catch { /* tiha greška */ }
  }

  async function handleRefresh() {
    await saveCurrentScores();
    await loadData();
  }

  async function runSort(collectionId, title) {
    setSorting(collectionId); setError(null); setSuccess(null);
    try {
      const res = await fetch("/api/sort", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, collectionId}) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || `HTTP ${res.status}`); }
      setSuccess(`✅ Sortiranje "${title}" pokrenuto!`);
      setTimeout(loadData, 3000);
    } catch (e) { setError(e.message || "Greška."); } finally { setSorting(null); }
  }

  async function runSortAll() {
    setSorting("all"); setError(null); setSuccess(null);
    try {
      const res = await fetch("/api/sort-all", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop}) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || `HTTP ${res.status}`); }
      setSuccess("✅ Sortiranje svih kolekcija pokrenuto!");
      setTimeout(loadData, 5000);
    } catch (e) { setError(e.message || "Greška."); } finally { setSorting(null); }
  }

  async function addCollection() {
    const col = collections.find(c=>c.id===selected); if(!col) return;
    try {
      await fetch("/api/watched-collections", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, collectionId:col.id, collectionTitle:col.title, active:true}) });
      setAddModal(false); setSelected(""); setSearchValue(""); loadData();
    } catch { setError("Greška."); }
  }

  async function removeCollection(collectionId) {
    try {
      await fetch("/api/watched-collections", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, collectionId, active:false}) });
      loadData();
    } catch { setError("Greška."); }
  }

  // Sync + auto-save trenutnih scoreva i sprinklera
  async function syncCategories() {
    setError(null); setSuccess(null);
    const scores = Object.entries(catScoresRef.current).map(([handle, season_scores]) => ({
      handle,
      season_scores,
      is_sprinkler: sprinklersRef.current[handle] || false
    }));
    try {
      await fetch("/api/categories/sync", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, scores}) });
      setSuccess("✅ Scorevi sačuvani i sync kategorija pokrenut! Osvježi za par sekundi.");
      setTimeout(loadData, 5000);
    } catch { setError("Greška."); }
  }

  async function bulkRemove(removeAll) {
    const ids = removeAll ? [] : selectedCols;
    setError(null); setSuccess(null);
    try {
      const res = await fetch("/api/watched-collections/bulk-remove", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ shop, collectionIds: ids, all: removeAll }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Greška");
      setSelectedCols([]);
      await loadData();
    } catch (e) { setError(e.message); }
  }

  if (!shop) return <Page title="Smart Sort"><Banner tone="critical"><p>Pristupite kroz Shopify Admin.</p></Banner></Page>;

  if (loading) return (
    <Page title="Smart Sort">
      <div style={{textAlign:"center",padding:"80px"}}>
        <Spinner size="large"/><br/><br/>
        <Text tone="subdued">Učitavam podatke...</Text>
      </div>
    </Page>
  );

  const activeWatched = watched.filter(w=>w.active);
  const availableCollections = collections.filter(c=>!activeWatched.find(w=>w.collection_id===c.id));
  const filteredCollections = searchValue
    ? availableCollections.filter(c=>c.title.toLowerCase().includes(searchValue.toLowerCase()))
    : availableCollections;
  const selectedCollectionTitle = selected ? (collections.find(c=>c.id===selected)?.title || "") : "";

  const tabs = [
    { id:"collections", content:"Kolekcije" },
    { id:"categories",  content:`Kategorije (${categories.length})` },
    { id:"config",      content:"Opće postavke" },
    { id:"schedule",    content:"Raspored" },
    { id:"weather",     content:"Prognoza" },
    { id:"logs",        content:"Logovi" },
  ];

  return (
    <Page
      title="Smart Sort"
      subtitle={shop}
      primaryAction={tab===0 ? { content:sorting==="all"?"Sortira se...":"Sortiraj sve", loading:sorting==="all", onAction:runSortAll, disabled:activeWatched.length===0 } : undefined}
      secondaryActions={[
        { content:"Osvježi", onAction:handleRefresh },
        ...(tab===1 ? [{ content:"Sync kategorije", onAction:syncCategories }] : []),
      ]}
    >
      <VerticalStack gap="400">
        {error   && <Banner tone="critical" onDismiss={()=>setError(null)}><p>{error}</p></Banner>}
        {success && <Banner tone="success"  onDismiss={()=>setSuccess(null)}><p>{success}</p></Banner>}

        <Tabs tabs={tabs} selected={tab} onSelect={setTab} />

        {/* ── Tab 0: Kolekcije ── */}
        {tab===0 && (
          <Card>
            <VerticalStack gap="400">
              <HorizontalStack align="space-between">
                <Text as="h2" variant="headingMd">Praćene kolekcije</Text>
                <Button variant="plain" onClick={()=>setAddModal(true)}>+ Dodaj</Button>
              </HorizontalStack>
              {activeWatched.length===0 ? (
                <EmptyState heading="Nema praćenih kolekcija" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <Button onClick={()=>setAddModal(true)}>Dodaj kolekciju</Button>
                </EmptyState>
              ) : (
                <ResourceList
                  idForItem={(item) => item.collection_id}
                  items={activeWatched}
                  selectedItems={selectedCols}
                  onSelectionChange={(sel) => setSelectedCols(sel === "All" ? activeWatched.map(w => w.collection_id) : sel)}
                  selectable
                  promotedBulkActions={[
                    { content:"Ukloni odabrane", destructive:true, onAction:()=>bulkRemove(false) },
                  ]}
                  bulkActions={[
                    { content:"Ukloni sve kolekcije", destructive:true, onAction:()=>bulkRemove(true) },
                  ]}
                  renderItem={(item) => {
                    const isSorting = sorting===item.collection_id;
                    const hasOwn = !!item.collection_config;
                    return (
                      <ResourceItem id={item.collection_id} shortcutActions={[
                        { content:isSorting?"Sortira...":"Sortiraj", loading:isSorting, onAction:()=>runSort(item.collection_id, item.collection_title) },
                        { content:"Postavke", onAction:()=>setConfigModal(item.collection_id) },
                        { content:"Ukloni", destructive:true, onAction:()=>removeCollection(item.collection_id) },
                      ]}>
                        <HorizontalStack align="space-between" blockAlign="center">
                          <VerticalStack gap="100">
                            <HorizontalStack gap="200" blockAlign="center">
                              <Text fontWeight="semibold">{item.collection_title}</Text>
                              {hasOwn && <Badge tone="info">Vlastite postavke</Badge>}
                            </HorizontalStack>
                            <Text tone="subdued" variant="bodySm">
                              Zadnji sort: {item.last_sorted_at ? new Date(item.last_sorted_at).toLocaleString("bs-BA") : "Nikad"}
                            </Text>
                          </VerticalStack>
                          <Badge tone={item.last_sorted_at?"success":"attention"}>
                            {item.last_sorted_at?"Sortirano":"Čeka"}
                          </Badge>
                        </HorizontalStack>
                      </ResourceItem>
                    );
                  }}
                />
              )}
            </VerticalStack>
          </Card>
        )}

        {/* ── Tab 1: Kategorije ── */}
        {tab===1 && (
          <CategoriesTab
            categories={categories}
            shop={shop}
            scoresRef={catScoresRef}
            sprinklersRef={sprinklersRef}
            onSaved={loadData}
            onError={setError}
            onSuccess={setSuccess}
          />
        )}

        {/* ── Tab 2: Opće postavke ── */}
        {tab===2 && shopConfig && (
          <ConfigTab
            config={shopConfig}
            title="Opće postavke (default za sve kolekcije)"
            onSave={async (cfg) => {
              const r = await fetch("/api/config", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, config:cfg}) });
              const d = await r.json(); setShopConfig(d.config); setSuccess("✅ Postavke sačuvane!");
            }}
          />
        )}

        {/* ── Tab 3: Raspored ── */}
        {tab===3 && schedule && (
          <ScheduleTab
            schedule={schedule}
            shop={shop}
            onSaved={(s) => { setSchedule(s); setSuccess("✅ Raspored sačuvan!"); }}
            onError={setError}
          />
        )}

        {/* ── Tab 4: Prognoza ── */}
        {tab===4 && weatherConfig && (
          <WeatherTab
            weatherConfig={weatherConfig}
            shop={shop}
            onSaved={(cfg) => setWeatherConfig(cfg)}
            onError={setError}
            onSuccess={setSuccess}
          />
        )}

        {/* ── Tab 5: Logovi ── */}
        {tab===5 && (
          <Card>
            <VerticalStack gap="400">
              <Text as="h2" variant="headingMd">Logovi sortiranja</Text>
              {logs.length===0 ? <Text tone="subdued">Nema logova.</Text> : (
                <DataTable
                  columnContentTypes={["text","text","numeric","text","text"]}
                  headings={["Kolekcija","Trigger","Proizvoda","Status","Vrijeme"]}
                  rows={logs.map(log=>[
                    watched.find(w=>w.collection_id===log.collection_id)?.collection_title || log.collection_id || "Sve",
                    log.trigger,
                    log.products_sorted||0,
                    <Badge tone={log.status==="success"?"success":"critical"}>{log.status==="success"?"OK":"Greška"}</Badge>,
                    new Date(log.created_at).toLocaleString("bs-BA"),
                  ])}
                />
              )}
            </VerticalStack>
          </Card>
        )}
      </VerticalStack>

      <Modal open={addModal} onClose={()=>{ setAddModal(false); setSelected(""); setSearchValue(""); }} title="Dodaj kolekciju"
        primaryAction={{content:"Dodaj", onAction:addCollection, disabled:!selected}}
        secondaryActions={[{content:"Odustani", onAction:()=>{ setAddModal(false); setSelected(""); setSearchValue(""); }}]}
      >
        <Modal.Section>
          <Combobox
            activator={
              <Combobox.TextField
                label="Kolekcija"
                value={selected ? selectedCollectionTitle : searchValue}
                onChange={(val) => { setSearchValue(val); if (!val) setSelected(""); }}
                placeholder="Pretraži kolekcije..."
                autoComplete="off"
              />
            }
          >
            {filteredCollections.length > 0 ? (
              <Listbox onSelect={(val) => { setSelected(val); setSearchValue(""); }}>
                {filteredCollections.map(c => (
                  <Listbox.Option key={c.id} value={c.id} selected={selected===c.id}>
                    {c.title}
                  </Listbox.Option>
                ))}
              </Listbox>
            ) : (
              <Listbox onSelect={()=>{}}>
                <Listbox.Option value="" disabled>Nema rezultata</Listbox.Option>
              </Listbox>
            )}
          </Combobox>
        </Modal.Section>
      </Modal>

      {configModal && (
        <CollectionConfigModal
          shop={shop}
          collectionId={configModal}
          collectionTitle={watched.find(w=>w.collection_id===configModal)?.collection_title||""}
          onClose={()=>{ setConfigModal(null); loadData(); }}
          onSuccess={setSuccess}
          onError={setError}
        />
      )}
    </Page>
  );
}

// ── Kategorije Tab ─────────────────────────────────────────────────────────
function CategoriesTab({ categories, shop, scoresRef, sprinklersRef, onSaved, onError, onSuccess }) {
  const [scores, setScores] = useState(() => {
    const m = {};
    for (const c of categories) m[c.handle] = { ...c.season_scores };
    return m;
  });
  const [sprinklers, setSprinklers] = useState(() => {
    const m = {};
    for (const c of categories) m[c.handle] = c.is_sprinkler || false;
    return m;
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const m = {};
    for (const c of categories) m[c.handle] = { ...c.season_scores };
    setScores(m);
    scoresRef.current = m;
    const sp = {};
    for (const c of categories) sp[c.handle] = c.is_sprinkler || false;
    setSprinklers(sp);
    sprinklersRef.current = sp;
  }, [categories, scoresRef, sprinklersRef]);

  function setScore(handle, rang, val) {
    setScores(s => {
      const next = { ...s, [handle]: { ...(s[handle]||{}), [rang]: parseFloat(val)||0 } };
      scoresRef.current = next;
      return next;
    });
  }

  function toggleSprinkler(handle) {
    setSprinklers(sp => {
      const next = { ...sp, [handle]: !sp[handle] };
      sprinklersRef.current = next;
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const arr = Object.entries(scores).map(([handle, season_scores]) => ({ handle, season_scores, is_sprinkler: sprinklers[handle] || false }));
      await fetch("/api/categories/scores", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, scores:arr}) });
      onSuccess("✅ Sezonski scorevi sačuvani!");
    } catch { onError("Greška pri čuvanju."); }
    finally { setSaving(false); }
  }

  if (!categories.length) return (
    <Card>
      <VerticalStack gap="400">
        <Text as="h2" variant="headingMd">Kategorije</Text>
        <Banner tone="warning">
          <p>Nema kategorija. Klikni <strong>Sync kategorije</strong> gore da učitaš kategorije iz Shopify metafielda <code>custom.kategorija</code>.</p>
        </Banner>
      </VerticalStack>
    </Card>
  );

  return (
    <Card>
      <VerticalStack gap="400">
        <HorizontalStack align="space-between">
          <VerticalStack gap="100">
            <Text as="h2" variant="headingMd">Sezonski score po kategoriji</Text>
            <Text tone="subdued" variant="bodySm">Score 1–10. Promjene se automatski čuvaju pri Osvježi i Sync kategorije.</Text>
          </VerticalStack>
        </HorizontalStack>

        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:"14px"}}>
            <thead>
              <tr style={{borderBottom:"2px solid #e1e3e5"}}>
                <th style={{textAlign:"left",padding:"10px 12px",fontWeight:600,color:"#202223"}}>Kategorija</th>
                {RANGS.map(rang => {
                  const ri = RANG_INFO[rang];
                  return (
                    <th key={rang} style={{textAlign:"center",padding:"8px 12px",fontWeight:600,minWidth:"90px"}}>
                      <div style={{
                        display:"inline-flex", alignItems:"center", gap:"4px",
                        padding:"4px 10px", borderRadius:"8px",
                        background: ri.bg, border:`1px solid ${ri.border}`, color: ri.color,
                        fontSize:"13px",
                      }}>
                        {ri.emoji} {ri.label}
                      </div>
                    </th>
                  );
                })}
                <th style={{textAlign:"center",padding:"10px 12px",fontWeight:600,minWidth:"80px"}}>Sprinkler</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat, i) => (
                <tr key={cat.handle} style={{background:i%2===0?"#fafbfb":"white",borderBottom:"1px solid #f1f2f3"}}>
                  <td style={{padding:"8px 12px",fontWeight:500}}>{cat.name}</td>
                  {RANGS.map(rang => (
                    <td key={rang} style={{padding:"4px 8px",textAlign:"center"}}>
                      <input
                        type="number" min="1" max="10" step="0.5"
                        value={scores[cat.handle]?.[rang] ?? 5}
                        onChange={e=>setScore(cat.handle, rang, e.target.value)}
                        style={{width:"56px",textAlign:"center",border:"1px solid #c9cccf",borderRadius:"4px",padding:"5px",fontSize:"14px"}}
                      />
                    </td>
                  ))}
                  <td style={{padding:"4px 8px",textAlign:"center"}}>
                    <input
                      type="checkbox"
                      checked={sprinklers[cat.handle] || false}
                      onChange={()=>toggleSprinkler(cat.handle)}
                      style={{width:"18px",height:"18px",cursor:"pointer"}}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <HorizontalStack align="end">
          <Button variant="primary" onClick={handleSave} loading={saving}>Sačuvaj scoreve</Button>
        </HorizontalStack>
      </VerticalStack>
    </Card>
  );
}

// ── Schedule Tab ───────────────────────────────────────────────────────────
function ScheduleTab({ schedule, shop, onSaved, onError }) {
  const [cfg, setCfg]       = useState({ ...schedule });
  const [saving, setSaving] = useState(false);

  const intervalOptions = [
    { label:"Svaki dan",       value:"1", icon:"📅" },
    { label:"Svaka 2 dana",    value:"2", icon:"📅" },
    { label:"Svaka 3 dana",    value:"3", icon:"📅" },
    { label:"Jednom sedmično", value:"7", icon:"📅" },
  ];

  const h   = parseInt(cfg.hour   ?? 3);
  const min = parseInt(cfg.minute ?? 0);
  const timeStr = `${String(h).padStart(2,"0")}:${String(min).padStart(2,"0")}`;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/schedule", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, schedule:cfg}) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || `HTTP ${res.status}`); }
      onSaved(cfg);
    } catch (e) { onError(e.message || "Greška pri čuvanju rasporeda."); }
    finally { setSaving(false); }
  }

  const intervalLabel = intervalOptions.find(o => o.value === String(cfg.intervalDays||1))?.label || "";

  return (
    <VerticalStack gap="400">

      {/* Status kartica */}
      <Card>
        <div style={{
          display:"flex", alignItems:"center", gap:"16px", flexWrap:"wrap",
          padding:"4px 0",
        }}>
          <div style={{
            width:"48px", height:"48px", borderRadius:"12px", flexShrink:0,
            background: cfg.enabled ? "#e3f9e5" : "#f6f6f7",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:"24px",
          }}>
            {cfg.enabled ? "⏰" : "⏸"}
          </div>
          <div style={{flex:1}}>
            <div style={{fontWeight:600, fontSize:"15px", color: cfg.enabled ? "#1a6b3a" : "#6d7175"}}>
              {cfg.enabled ? "Automatsko sortiranje aktivno" : "Automatsko sortiranje isključeno"}
            </div>
            <div style={{fontSize:"13px", color:"#6d7175", marginTop:"2px"}}>
              {cfg.enabled
                ? `Pokreće se ${intervalLabel.toLowerCase()} u ${timeStr}h (Europe/Sarajevo)`
                : "Sortiranje se pokreće samo ručno."
              }
            </div>
          </div>
          {/* Toggle */}
          <div
            onClick={() => setCfg(c => ({...c, enabled: !c.enabled}))}
            style={{
              width:"52px", height:"28px", borderRadius:"14px", cursor:"pointer",
              background: cfg.enabled ? "#1a6b3a" : "#c9cccf",
              position:"relative", transition:"background 0.2s", flexShrink:0,
            }}
          >
            <div style={{
              position:"absolute", top:"3px",
              left: cfg.enabled ? "26px" : "3px",
              width:"22px", height:"22px", borderRadius:"50%",
              background:"white", transition:"left 0.2s",
              boxShadow:"0 1px 3px rgba(0,0,0,0.2)",
            }} />
          </div>
        </div>
      </Card>

      {/* Učestalost */}
      <Card>
        <VerticalStack gap="400">
          <Text as="h3" variant="headingSm">Učestalost</Text>
          <div style={{display:"flex", gap:"10px", flexWrap:"wrap"}}>
            {intervalOptions.map(opt => (
              <div
                key={opt.value}
                onClick={() => setCfg(c => ({...c, intervalDays: parseInt(opt.value)}))}
                style={{
                  padding:"10px 18px", borderRadius:"10px", cursor:"pointer",
                  border:`2px solid ${String(cfg.intervalDays||1) === opt.value ? "#1a6b3a" : "#e1e3e5"}`,
                  background: String(cfg.intervalDays||1) === opt.value ? "#eaf7ee" : "white",
                  color: String(cfg.intervalDays||1) === opt.value ? "#1a6b3a" : "#202223",
                  fontWeight: String(cfg.intervalDays||1) === opt.value ? 600 : 400,
                  fontSize:"14px", transition:"all 0.15s",
                }}
              >
                {opt.label}
              </div>
            ))}
          </div>
        </VerticalStack>
      </Card>

      {/* Vrijeme */}
      <Card>
        <VerticalStack gap="400">
          <VerticalStack gap="100">
            <Text as="h3" variant="headingSm">Vrijeme pokretanja</Text>
            <Text tone="subdued" variant="bodySm">Preporučeno između 02:00 i 05:00 — najmanji promet.</Text>
          </VerticalStack>

          {/* Sat */}
          <VerticalStack gap="200">
            <Text variant="bodySm" fontWeight="semibold">Sat</Text>
            <div style={{display:"flex", gap:"6px", flexWrap:"wrap"}}>
              {Array.from({length:24}, (_,i) => (
                <div
                  key={i}
                  onClick={() => setCfg(c => ({...c, hour: i}))}
                  style={{
                    width:"42px", height:"36px", borderRadius:"8px",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    cursor:"pointer", fontSize:"13px", fontWeight: h===i ? 700 : 400,
                    border:`2px solid ${h===i ? "#1a6b3a" : "#e1e3e5"}`,
                    background: h===i ? "#eaf7ee" : (i>=2&&i<=5 ? "#f9fafb" : "white"),
                    color: h===i ? "#1a6b3a" : "#202223",
                    transition:"all 0.1s",
                  }}
                >
                  {String(i).padStart(2,"0")}
                </div>
              ))}
            </div>
          </VerticalStack>

          {/* Minute */}
          <VerticalStack gap="200">
            <Text variant="bodySm" fontWeight="semibold">Minute</Text>
            <div style={{display:"flex", gap:"6px", flexWrap:"wrap"}}>
              {[0,5,10,15,20,25,30,35,40,45,50,55].map(m => (
                <div
                  key={m}
                  onClick={() => setCfg(c => ({...c, minute: m}))}
                  style={{
                    width:"48px", height:"36px", borderRadius:"8px",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    cursor:"pointer", fontSize:"13px", fontWeight: min===m ? 700 : 400,
                    border:`2px solid ${min===m ? "#1a6b3a" : "#e1e3e5"}`,
                    background: min===m ? "#eaf7ee" : "white",
                    color: min===m ? "#1a6b3a" : "#202223",
                    transition:"all 0.1s",
                  }}
                >
                  :{String(m).padStart(2,"0")}
                </div>
              ))}
            </div>
          </VerticalStack>

          {/* Preview */}
          <div style={{
            display:"inline-flex", alignItems:"center", gap:"10px",
            padding:"10px 16px", borderRadius:"10px",
            background:"#f6f6f7", border:"1px solid #e1e3e5",
          }}>
            <span style={{fontSize:"20px"}}>🕐</span>
            <div>
              <span style={{fontSize:"22px", fontWeight:700, letterSpacing:"1px"}}>{timeStr}</span>
              <span style={{fontSize:"13px", color:"#6d7175", marginLeft:"8px"}}>
                {intervalLabel} · Europe/Sarajevo
              </span>
            </div>
          </div>
        </VerticalStack>
      </Card>

      <HorizontalStack align="end">
        <Button variant="primary" onClick={handleSave} loading={saving}>Sačuvaj raspored</Button>
      </HorizontalStack>
    </VerticalStack>
  );
}

// ── Config Tab ─────────────────────────────────────────────────────────────
function ConfigTab({ config, title, onSave, onReset }) {
  const [cfg, setCfg]       = useState({ ...config });
  const [saving, setSaving] = useState(false);
  const [bannedInput, setBannedInput] = useState((config.bannedCategoriesTopN||[]).join(", "));

  useEffect(() => { setCfg({ ...config }); setBannedInput((config.bannedCategoriesTopN||[]).join(", ")); }, [config]);

  function num(key) { return String(cfg[key] ?? ""); }
  function setNum(key, val) { setCfg(c=>({...c,[key]:parseFloat(val)||0})); }
  function setPageNum(key, val) { setCfg(c=>({...c,[key]:Math.max(0, parseInt(val)||0)})); }
  function setStr(key, val) { setCfg(c=>({...c,[key]:val})); }

  const pageTotal = (cfg.womenAdultsPerPage||0) + (cfg.menAdultsPerPage||0) + (cfg.girlsPerPage||0) + (cfg.boysPerPage||0) + (cfg.babiesPerPage||0) + (cfg.maleAccessoriesPerPage||0) + (cfg.femaleAccessoriesPerPage||0);
  const pageTotalValid = pageTotal === 24;

  async function handleSave() {
    if (!pageTotalValid) return;
    setSaving(true);
    const banned = bannedInput.split(",").map(s=>s.trim()).filter(Boolean);
    await onSave({ ...cfg, bannedCategoriesTopN: banned });
    setSaving(false);
  }

  return (
    <VerticalStack gap="500">
      {title && <Text as="h2" variant="headingMd">{title}</Text>}

      {/* Kvote po stranici */}
      <Card>
        <VerticalStack gap="400">
          <VerticalStack gap="100">
            <Text as="h3" variant="headingSm">Kvote po stranici</Text>
            <Text tone="subdued" variant="bodySm">Ukupan zbroj mora biti tačno 24 proizvoda po stranici.</Text>
          </VerticalStack>
          <FormLayout>
            <FormLayout.Group condensed>
              <TextField label="Žene" type="number" min="0" value={num("womenAdultsPerPage")} onChange={v=>setPageNum("womenAdultsPerPage",v)} />
              <TextField label="Muškarci" type="number" min="0" value={num("menAdultsPerPage")} onChange={v=>setPageNum("menAdultsPerPage",v)} />
              <TextField label="Djevojčice" type="number" min="0" value={num("girlsPerPage")} onChange={v=>setPageNum("girlsPerPage",v)} />
              <TextField label="Dječaci" type="number" min="0" value={num("boysPerPage")} onChange={v=>setPageNum("boysPerPage",v)} />
            </FormLayout.Group>
            <FormLayout.Group condensed>
              <TextField label="Bebe" type="number" min="0" value={num("babiesPerPage")} onChange={v=>setPageNum("babiesPerPage",v)} />
              <TextField label="Žen. aksesoar" type="number" min="0" value={num("femaleAccessoriesPerPage")} onChange={v=>setPageNum("femaleAccessoriesPerPage",v)} />
              <TextField label="Muš. aksesoar" type="number" min="0" value={num("maleAccessoriesPerPage")} onChange={v=>setPageNum("maleAccessoriesPerPage",v)} />
              <Select label="Ko ide prvi"
                options={[{label:"Auto",value:"auto"},{label:"Žene",value:"Žene"},{label:"Muškarci",value:"Muškarci"}]}
                value={cfg.firstGender||"auto"} onChange={v=>setStr("firstGender",v)}
              />
            </FormLayout.Group>
          </FormLayout>
          <div style={{
            display:"inline-flex", alignItems:"center", gap:"8px",
            padding:"8px 14px", borderRadius:"8px",
            background: pageTotalValid ? "#f1faf5" : "#fff4f4",
            border: `1px solid ${pageTotalValid ? "#b7dfca" : "#ffd2d2"}`,
          }}>
            <span style={{fontSize:"18px"}}>{pageTotalValid ? "✅" : "⚠️"}</span>
            <Text variant="bodySm" tone={pageTotalValid ? "success" : "critical"}>
              Ukupno: <strong>{pageTotal} / 24</strong>
              {!pageTotalValid && <span style={{marginLeft:"6px"}}>— mora biti tačno 24</span>}
            </Text>
          </div>
        </VerticalStack>
      </Card>

      {/* Penali diversifikacije */}
      <Card>
        <VerticalStack gap="400">
          <VerticalStack gap="100">
            <Text as="h3" variant="headingSm">Penali diversifikacije</Text>
            <Text tone="subdued" variant="bodySm">
              Penalty &gt; 12 = nikad isti zaredom. Veći broj = stroža diversifikacija.
            </Text>
          </VerticalStack>

          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:"14px",minWidth:"400px"}}>
              <thead>
                <tr style={{borderBottom:"2px solid #e1e3e5"}}>
                  <th style={{textAlign:"left",padding:"8px 12px",fontWeight:600,color:"#6d7175",fontSize:"12px",textTransform:"uppercase"}}>Atribut</th>
                  <th style={{textAlign:"center",padding:"8px 12px",fontWeight:600,color:"#6d7175",fontSize:"12px",textTransform:"uppercase"}}>prev1</th>
                  <th style={{textAlign:"center",padding:"8px 12px",fontWeight:600,color:"#6d7175",fontSize:"12px",textTransform:"uppercase"}}>prev2</th>
                  <th style={{textAlign:"center",padding:"8px 12px",fontWeight:600,color:"#6d7175",fontSize:"12px",textTransform:"uppercase"}}>prev3</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label:"Kategorija", k1:"penaltySameCategory",   k2:"penaltyInLast2Category", k3:"penaltyInLast3Category" },
                  { label:"Boja",       k1:"penaltySameColor",      k2:"penaltyInLast2Color",    k3:"penaltyInLast3Color" },
                  { label:"Tip",        k1:"penaltySameType",       k2:"penaltyInLast2Type",     k3:"penaltyInLast3Type" },
                ].map((row, i) => (
                  <tr key={row.label} style={{background:i%2===0?"#fafbfb":"white",borderBottom:"1px solid #f1f2f3"}}>
                    <td style={{padding:"8px 12px",fontWeight:500}}>{row.label}</td>
                    {[row.k1, row.k2, row.k3].map(k => (
                      <td key={k} style={{padding:"6px 12px",textAlign:"center"}}>
                        <input
                          type="number" min="0" step="1"
                          value={cfg[k] ?? ""}
                          onChange={e=>setNum(k, e.target.value)}
                          style={{width:"60px",textAlign:"center",border:"1px solid #c9cccf",borderRadius:"6px",padding:"5px 6px",fontSize:"14px"}}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </VerticalStack>
      </Card>

      {/* Zabranjene kategorije i tuning */}
      <Card>
        <VerticalStack gap="400">
          <VerticalStack gap="100">
            <Text as="h3" variant="headingSm">Zabranjene kategorije i fino podešavanje</Text>
            <Text tone="subdued" variant="bodySm">Kategorije koje se ne prikazuju na vrhu, te parametri za podešavanje algoritma.</Text>
          </VerticalStack>
          <FormLayout>
            <TextField
              label="Zabranjene kategorije"
              value={bannedInput}
              onChange={setBannedInput}
              placeholder="Setovi, Potkošulje"
              helpText="Unesi nazive kategorija odvojene zarezom."
            />
            <FormLayout.Group condensed>
              <TextField label="Zabranjenih pozicija" type="number" value={num("banTopN")} onChange={v=>setNum("banTopN",v)} helpText="Broj prvih pozicija" />
              <TextField label="Jitter" type="number" value={num("jitter")} onChange={v=>setNum("jitter",v)} helpText="Preporučeno: 0.25" />
              <TextField label="Relax korak" type="number" value={num("relaxStep")} onChange={v=>setNum("relaxStep",v)} helpText="Preporučeno: 0.80" />
            </FormLayout.Group>
          </FormLayout>
        </VerticalStack>
      </Card>

      <HorizontalStack align="space-between">
        {onReset && <Button tone="critical" variant="plain" onClick={onReset}>Resetuj na shop default</Button>}
        <Button variant="primary" onClick={handleSave} loading={saving} disabled={!pageTotalValid}>Sačuvaj postavke</Button>
      </HorizontalStack>
    </VerticalStack>
  );
}

// ── Per-Collection Config Modal ────────────────────────────────────────────
function CollectionConfigModal({ shop, collectionId, collectionTitle, onClose, onSuccess, onError }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasOwn, setHasOwn] = useState(false);

  useEffect(() => {
    fetch(`/api/collection-config?shop=${shop}&collectionId=${collectionId}`)
      .then(r=>r.json())
      .then(d=>{ setData(d); setHasOwn(!!d.collectionConfig); setLoading(false); })
      .catch(()=>setLoading(false));
  }, [shop, collectionId]);

  async function handleSave(cfg) {
    await fetch("/api/collection-config", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, collectionId, config:cfg}) });
    onSuccess(`✅ Postavke za "${collectionTitle}" sačuvane!`);
    onClose();
  }

  async function handleReset() {
    await fetch("/api/collection-config", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, collectionId, config:null}) });
    onSuccess(`✅ "${collectionTitle}" resetovano na shop default.`);
    onClose();
  }

  return (
    <Modal open={true} onClose={onClose} title={`Postavke: ${collectionTitle}`} large
      secondaryActions={[{ content:"Zatvori", onAction:onClose }]}
    >
      <Modal.Section>
        {loading ? (
          <div style={{textAlign:"center",padding:"40px"}}><Spinner /></div>
        ) : (
          <VerticalStack gap="400">
            {!hasOwn && <Banner tone="info"><p>Koristi <strong>shop default postavke</strong>. Promjenama ćeš kreirati vlastite.</p></Banner>}
            {hasOwn  && <Banner tone="success"><p>Ova kolekcija ima <strong>vlastite postavke</strong>.</p></Banner>}
            <ConfigTab config={data?.merged||data?.shopConfig||{}} onSave={handleSave} onReset={hasOwn?handleReset:undefined} />
          </VerticalStack>
        )}
      </Modal.Section>
    </Modal>
  );
}

// ── Weather Tab ────────────────────────────────────────────────────────────
// Koristimo isti RANG_INFO koji se koristi i u Kategorijama

function WeatherTab({ weatherConfig, shop, onSaved, onError, onSuccess }) {
  const [cfg, setCfg]   = useState({ ...DEFAULT_WEATHER_CONFIG, ...weatherConfig });
  const [saving, setSaving]   = useState(false);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    setCfg({ ...DEFAULT_WEATHER_CONFIG, ...weatherConfig });
  }, [weatherConfig]);

  const hourOptions = Array.from({length:24}, (_,i) => ({
    label: `${String(i).padStart(2,"0")}:00`, value: String(i)
  }));

  const forecast = cfg.lastForecast;
  const rangMeta = forecast ? (RANG_INFO[forecast.rang] || {}) : null;

  async function handleSave() {
    setSaving(true);
    try {
      const r = await fetch("/api/weather-config", {
        method:"PUT", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ shop, weatherConfig: cfg }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Greška");
      onSuccess("✅ Postavke prognoze sačuvane!");
      onSaved(cfg);
    } catch(e) { onError(e.message); }
    finally { setSaving(false); }
  }

  async function handleReadNow() {
    if (!cfg.city?.trim()) return onError("Unesite naziv grada.");
    setReading(true);
    try {
      const r = await fetch("/api/weather/read", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ shop }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Greška");
      const updated = { ...cfg, lastForecast: d.forecast };
      setCfg(updated);
      onSaved(updated);
      onSuccess(`✅ Prognoza očitana: ${d.forecast.temp}°C — ${RANG_INFO[d.forecast.rang]?.label || d.forecast.rang}`);
    } catch(e) { onError(e.message); }
    finally { setReading(false); }
  }

  function updateRange(name, field, val) {
    setCfg(c => ({
      ...c,
      ranges: (c.ranges || DEFAULT_WEATHER_RANGES).map(r =>
        r.name === name ? { ...r, [field]: parseInt(val) || 0 } : r
      ),
    }));
  }

  const ranges = cfg.ranges || DEFAULT_WEATHER_RANGES;

  return (
    <VerticalStack gap="500">

      {/* Zadnja prognoza */}
      {forecast && rangMeta ? (
        <Card>
          <VerticalStack gap="300">
            <HorizontalStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingSm">Zadnja očitana prognoza</Text>
              <Text tone="subdued" variant="bodySm">
                {new Date(forecast.readAt).toLocaleString("bs-BA")}
              </Text>
            </HorizontalStack>
            <div style={{
              display:"flex", gap:"20px", flexWrap:"wrap", alignItems:"center",
              padding:"16px 20px", borderRadius:"10px",
              background: rangMeta.bg, border:`1px solid ${rangMeta.border}`,
            }}>
              <div style={{textAlign:"center", minWidth:"80px"}}>
                <div style={{fontSize:"42px", fontWeight:700, lineHeight:1}}>{forecast.temp}°C</div>
                <div style={{fontSize:"12px", color:"#6d7175", marginTop:"4px"}}>{forecast.city}</div>
              </div>
              <div style={{display:"flex", flexDirection:"column", gap:"6px"}}>
                <div style={{fontSize:"15px", fontWeight:500}}>{forecast.description}</div>
                <div style={{display:"flex", alignItems:"center", gap:"8px", flexWrap:"wrap"}}>
                  <span style={{
                    display:"inline-flex", alignItems:"center", gap:"4px",
                    padding:"3px 10px", borderRadius:"12px",
                    background:"white", border:`1px solid ${rangMeta.border}`,
                    fontSize:"13px", fontWeight:600,
                  }}>
                    {rangMeta.emoji} {rangMeta.label}
                  </span>
                  <Text variant="bodySm" tone="subdued">
                    → koristi <strong>{rangMeta.label}</strong> scoreve iz Kategorija
                  </Text>
                </div>
                <Text variant="bodySm" tone="subdued">
                  Osjeća se kao {forecast.feelsLike}°C · Vlažnost {forecast.humidity}%
                </Text>
              </div>
            </div>
          </VerticalStack>
        </Card>
      ) : (
        <Banner tone="warning">
          <p>Prognoza još nije očitana. Unesite grad i kliknite <strong>Čitaj sada</strong>.</p>
        </Banner>
      )}

      {/* Postavke */}
      <Card>
        <VerticalStack gap="400">
          <Text as="h3" variant="headingSm">Postavke prognoze</Text>
          <FormLayout>
            <Select
              label="Vremenska prognoza"
              options={[{label:"Isključena",value:"off"},{label:"Uključena — koristi temperaturu umjesto kalendarske sezone",value:"on"}]}
              value={cfg.enabled ? "on" : "off"}
              onChange={v => setCfg(c => ({...c, enabled: v==="on"}))}
            />
            <FormLayout.Group>
              <TextField
                label="Grad"
                value={cfg.city || ""}
                onChange={v => setCfg(c => ({...c, city: v}))}
                placeholder="npr. Sarajevo"
                helpText="Grad za koji se čita prognoza (wttr.in)."
              />
              <Select
                label="Sat automatskog čitanja"
                options={hourOptions}
                value={String(cfg.readHour ?? 6)}
                onChange={v => setCfg(c => ({...c, readHour: parseInt(v)}))}
                helpText="Prognoza se automatski čita u ovom satu (i pred svako cron sortiranje)."
              />
            </FormLayout.Group>
          </FormLayout>
        </VerticalStack>
      </Card>

      {/* Temperaturni rangovi */}
      <Card>
        <VerticalStack gap="400">
          <VerticalStack gap="100">
            <Text as="h3" variant="headingSm">Temperaturni rangovi</Text>
            <Text tone="subdued" variant="bodySm">
              Definiši temperaturne granice za svaki rang. Rang direktno određuje koji stupac scoreva iz taba Kategorije se koristi pri sortiranju.
            </Text>
          </VerticalStack>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%", borderCollapse:"collapse", fontSize:"14px"}}>
              <thead>
                <tr style={{borderBottom:"2px solid #e1e3e5"}}>
                  <th style={{textAlign:"left",   padding:"10px 14px", fontWeight:600, color:"#6d7175", fontSize:"12px", textTransform:"uppercase"}}>Rang</th>
                  <th style={{textAlign:"center", padding:"10px 14px", fontWeight:600, color:"#6d7175", fontSize:"12px", textTransform:"uppercase"}}>Minimum (°C)</th>
                  <th style={{textAlign:"center", padding:"10px 14px", fontWeight:600, color:"#6d7175", fontSize:"12px", textTransform:"uppercase"}}>Maksimum (°C)</th>
                </tr>
              </thead>
              <tbody>
                {ranges.map((rang) => {
                  const meta = RANG_INFO[rang.name] || {};
                  return (
                    <tr key={rang.name} style={{background: meta.bg, borderBottom:"1px solid #f1f2f3"}}>
                      <td style={{padding:"10px 14px"}}>
                        <span style={{
                          display:"inline-flex", alignItems:"center", gap:"6px",
                          fontWeight:700, fontSize:"14px", color: meta.color,
                        }}>
                          {meta.emoji} {meta.label}
                        </span>
                      </td>
                      <td style={{padding:"6px 14px", textAlign:"center"}}>
                        <input
                          type="number" step="1"
                          value={rang.min}
                          onChange={e => updateRange(rang.name, "min", e.target.value)}
                          style={{width:"72px", textAlign:"center", border:`1px solid ${meta.border}`, borderRadius:"6px", padding:"5px 6px", fontSize:"14px", background:"white"}}
                        />
                      </td>
                      <td style={{padding:"6px 14px", textAlign:"center"}}>
                        <input
                          type="number" step="1"
                          value={rang.max}
                          onChange={e => updateRange(rang.name, "max", e.target.value)}
                          style={{width:"72px", textAlign:"center", border:`1px solid ${meta.border}`, borderRadius:"6px", padding:"5px 6px", fontSize:"14px", background:"white"}}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Banner tone="info">
            <p>
              Na osnovu izmjerene temperature određuje se rang. Rang = stupac u tabeli Kategorija → score za svaki proizvod.
            </p>
          </Banner>
        </VerticalStack>
      </Card>

      <HorizontalStack align="space-between">
        <Button onClick={handleReadNow} loading={reading} disabled={!cfg.city?.trim()}>
          Čitaj prognozu sada
        </Button>
        <Button variant="primary" onClick={handleSave} loading={saving}>
          Sačuvaj postavke
        </Button>
      </HorizontalStack>
    </VerticalStack>
  );
}
