import { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
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

const DEFAULT_FALLBACKS = {
  women:  ["unisex", "men", "other"],
  men:    ["unisex", "women", "other"],
  girls:  ["women", "unisex", "boys", "babies", "men", "other"],
  boys:   ["men", "unisex", "girls", "babies", "women", "other"],
  babies: ["girls", "boys", "women", "men", "other"],
  accW:   ["women", "unisex", "men", "other"],
  accM:   ["men", "unisex", "women", "other"],
};
const EMPTY_CATEGORIES = []; // stable ref — prevents ConfigTab useEffect from firing on every render when categories not passed

const FALLBACK_OPTIONS = [
  { value:"women",  label:"Žene" },
  { value:"men",    label:"Muškarci" },
  { value:"unisex", label:"Unisex" },
  { value:"girls",  label:"Djevojčice" },
  { value:"boys",   label:"Dječaci" },
  { value:"babies", label:"Bebe" },
  { value:"other",  label:"Ostalo" },
];

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
  const [previewModal, setPreviewModal] = useState(null);
  const [addingAll, setAddingAll] = useState(false);
  const [confirmAddAll, setConfirmAddAll] = useState(false);
  const dirtyTabsRef = useRef({});
  const tabsContainerRef = useRef(null);
  const [confirmLeave, setConfirmLeave] = useState({ open: false, targetTab: null });
  function markTabDirty(tabIdx, dirty) {
    dirtyTabsRef.current[tabIdx] = dirty;
    // Update tab dot directly in the DOM — no App re-render
    if (tabsContainerRef.current) {
      const btns = tabsContainerRef.current.querySelectorAll('[role="tab"]');
      if (btns[tabIdx]) {
        dirty ? btns[tabIdx].setAttribute('data-dirty', '') : btns[tabIdx].removeAttribute('data-dirty');
      }
    }
  }

  // Re-apply dirty dots after any render (Polaris may rebuild tab buttons on tab switch)
  useLayoutEffect(() => {
    if (!tabsContainerRef.current) return;
    const btns = tabsContainerRef.current.querySelectorAll('[role="tab"]');
    btns.forEach((btn, idx) => {
      dirtyTabsRef.current[idx] ? btn.setAttribute('data-dirty', '') : btn.removeAttribute('data-dirty');
    });
  });

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

  async function addAllCollections() {
    setAddingAll(true); setError(null);
    try {
      const res = await fetch("/api/watched-collections/add-all", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop}) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Greška");
      setSuccess(`✅ Dodano ${d.added} kolekcija.`);
      await loadData();
    } catch(e) { setError(e.message); }
    finally { setAddingAll(false); }
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
        {error   && <AppToast message={error}   type="error"   onClose={()=>setError(null)} />}
        {success && <AppToast message={success} type="success" onClose={()=>setSuccess(null)} />}
        <style>{`@keyframes toastIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}`}</style>

        <div ref={tabsContainerRef}>
          <Tabs tabs={tabs} selected={tab} onSelect={(newTab) => {
            if (dirtyTabsRef.current[tab]) { setConfirmLeave({ open: true, targetTab: newTab }); return; }
            setTab(newTab);
          }} />
        </div>
        <style>{`[role="tab"][data-dirty]::after { content:" ●"; color:#ffc107; font-size:10px; vertical-align:middle; }`}</style>

        {/* ── Tab 0: Kolekcije ── */}
        {tab===0 && (
          <Card>
            <VerticalStack gap="400">
              <HorizontalStack align="space-between">
                <Text as="h2" variant="headingMd">Praćene kolekcije</Text>
                <HorizontalStack gap="200">
                  <Button variant="plain" loading={addingAll} onClick={()=>setConfirmAddAll(true)}>+ Dodaj sve</Button>
                  <Button variant="plain" onClick={()=>setAddModal(true)}>+ Dodaj</Button>
                </HorizontalStack>
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
                        { content:"Preview", onAction:()=>setPreviewModal({ collectionId: item.collection_id, title: item.collection_title }) },
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
            onDirtyChange={(dirty) => markTabDirty(1, dirty)}
          />
        )}

        {/* ── Tab 2: Opće postavke ── */}
        {tab===2 && shopConfig && (
          <ConfigTab
            config={shopConfig}
            categories={categories}
            title="Opće postavke (default za sve kolekcije)"
            onSave={async (cfg) => {
              const r = await fetch("/api/config", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, config:cfg}) });
              const d = await r.json(); setShopConfig(d.config); setSuccess("✅ Postavke sačuvane!");
            }}
            onDirtyChange={(dirty) => markTabDirty(2, dirty)}
          />
        )}

        {/* ── Tab 3: Raspored ── */}
        {tab===3 && schedule && (
          <ScheduleTab
            schedule={schedule}
            shop={shop}
            onSaved={(s) => { setSchedule(s); setSuccess("✅ Raspored sačuvan!"); }}
            onError={setError}
            onDirtyChange={(dirty) => markTabDirty(3, dirty)}
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
            onDirtyChange={(dirty) => markTabDirty(4, dirty)}
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
      <Modal
        open={confirmLeave.open}
        onClose={() => setConfirmLeave({ open:false, targetTab:null })}
        title="Nesačuvane promjene"
        primaryAction={{ content:"Napusti bez čuvanja", destructive:true, onAction:() => {
          markTabDirty(tab, false);
          setTab(confirmLeave.targetTab);
          setConfirmLeave({ open:false, targetTab:null });
        }}}
        secondaryActions={[{ content:"Ostani i sačuvaj", onAction:() => setConfirmLeave({ open:false, targetTab:null }) }]}
      >
        <Modal.Section>
          <VerticalStack gap="200">
            <Text>Imate nesačuvane promjene u ovom tabu.</Text>
            <Text tone="subdued">Ako napustite tab sada, sve promjene će biti izgubljene.</Text>
          </VerticalStack>
        </Modal.Section>
      </Modal>

      <Modal
        open={confirmAddAll}
        onClose={()=>setConfirmAddAll(false)}
        title="Dodaj sve kolekcije"
        primaryAction={{ content:"Da, dodaj sve", loading:addingAll, onAction:()=>{ setConfirmAddAll(false); addAllCollections(); } }}
        secondaryActions={[{ content:"Odustani", onAction:()=>setConfirmAddAll(false) }]}
      >
        <Modal.Section>
          <Text>Sve kolekcije sa Shopifyja bit će dodane u praćene i počet će se automatski sortirati. Jeste li sigurni?</Text>
        </Modal.Section>
      </Modal>

      {previewModal && (
        <PreviewModal
          shop={shop}
          collectionId={previewModal.collectionId}
          collectionTitle={previewModal.title}
          onClose={()=>setPreviewModal(null)}
        />
      )}
    </Page>
  );
}

// ── Kategorije Tab ─────────────────────────────────────────────────────────
function CategoriesTab({ categories, shop, scoresRef, sprinklersRef, onSaved, onError, onSuccess, onDirtyChange = () => {} }) {
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
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const m = {};
    for (const c of categories) m[c.handle] = { ...c.season_scores };
    setScores(m);
    scoresRef.current = m;
    const sp = {};
    for (const c of categories) sp[c.handle] = c.is_sprinkler || false;
    setSprinklers(sp);
    sprinklersRef.current = sp;
    setIsDirty(false);
  }, [categories, scoresRef, sprinklersRef]);

  function setScore(handle, rang, val) {
    setScores(s => {
      const next = { ...s, [handle]: { ...(s[handle]||{}), [rang]: parseFloat(val)||0 } };
      scoresRef.current = next;
      return next;
    });
    setIsDirty(true); onDirtyChange(true);
  }

  function toggleSprinkler(handle) {
    setSprinklers(sp => {
      const next = { ...sp, [handle]: !sp[handle] };
      sprinklersRef.current = next;
      return next;
    });
    setIsDirty(true); onDirtyChange(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const arr = Object.entries(scores).map(([handle, season_scores]) => ({ handle, season_scores, is_sprinkler: sprinklers[handle] || false }));
      await fetch("/api/categories/scores", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, scores:arr}) });
      onSuccess("✅ Sezonski scorevi sačuvani!");
      setIsDirty(false); onDirtyChange(false);
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
    <VerticalStack gap="400">
      <UnsavedBanner show={isDirty} />
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
    </VerticalStack>
  );
}

// ── Schedule Tab ───────────────────────────────────────────────────────────
function ScheduleTab({ schedule, shop, onSaved, onError, onDirtyChange = () => {} }) {
  const [cfg, setCfg]       = useState({ ...schedule });
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const origRef = useRef(schedule);
  const prevDirtyRef = useRef(false);

  useEffect(() => { origRef.current = schedule; setCfg({ ...schedule }); setIsDirty(false); prevDirtyRef.current = false; onDirtyChange(false); }, [schedule]);
  useEffect(() => {
    const dirty = JSON.stringify(cfg) !== JSON.stringify(origRef.current);
    setIsDirty(dirty);
    if (dirty !== prevDirtyRef.current) { prevDirtyRef.current = dirty; onDirtyChange(dirty); }
  }, [JSON.stringify(cfg)]);

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
      setIsDirty(false); onDirtyChange(false);
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
            onClick={() => { setCfg(c => ({...c, enabled: !c.enabled})); }}
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
                onClick={() => { setCfg(c => ({...c, intervalDays: parseInt(opt.value)})); }}
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

          {/* Sat + Minute — padajuće liste */}
          <FormLayout>
            <FormLayout.Group condensed>
              <Select
                label="Sat"
                options={Array.from({length:24}, (_,i) => ({
                  label: `${String(i).padStart(2,"0")}:00${i>=2&&i<=5?" ✓":""}`,
                  value: String(i),
                }))}
                value={String(h)}
                onChange={v => { setCfg(c => ({...c, hour: parseInt(v)})); }}
                helpText="Preporučeno: 02 – 05h"
              />
              <Select
                label="Minute"
                options={[0,5,10,15,20,25,30,35,40,45,50,55].map(m => ({
                  label: `:${String(m).padStart(2,"0")}`,
                  value: String(m),
                }))}
                value={String(min)}
                onChange={v => { setCfg(c => ({...c, minute: parseInt(v)})); }}
              />
            </FormLayout.Group>
          </FormLayout>

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

      <UnsavedBanner show={isDirty} />
      <HorizontalStack align="end">
        <Button variant="primary" onClick={handleSave} loading={saving}>Sačuvaj raspored</Button>
      </HorizontalStack>
    </VerticalStack>
  );
}

// ── App Toast ───────────────────────────────────────────────────────────────
function AppToast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4500); return () => clearTimeout(t); }, [message]);
  const ok = type === "success";
  return (
    <div style={{
      position:"fixed", top:"20px", right:"20px", zIndex:9999,
      display:"flex", alignItems:"center", gap:"12px",
      padding:"14px 18px", borderRadius:"12px",
      background: ok ? "#1a6b3a" : "#c0392b",
      color:"white", fontSize:"14px", fontWeight:500,
      boxShadow:"0 6px 24px rgba(0,0,0,0.18)",
      maxWidth:"380px", minWidth:"240px",
      animation:"toastIn 0.25s ease",
    }}>
      <span style={{fontSize:"20px",flexShrink:0}}>{ok ? "✅" : "❌"}</span>
      <span style={{flex:1,lineHeight:"1.4"}}>{String(message).replace(/^[✅❌]\s*/,"")}</span>
      <span onClick={onClose} style={{cursor:"pointer",opacity:0.75,fontSize:"20px",lineHeight:1,flexShrink:0}}>×</span>
    </div>
  );
}

// ── Unsaved changes banner ──────────────────────────────────────────────────
function UnsavedBanner({ show }) {
  if (!show) return null;
  return (
    <div style={{background:"#fff8e1",border:"1px solid #ffc107",borderRadius:"8px",padding:"10px 16px",display:"flex",alignItems:"center",gap:"8px",fontSize:"13px",fontWeight:500,color:"#7a4f00"}}>
      <span style={{fontSize:"16px"}}>⚠</span>
      Imate nesačuvane promjene — kliknite Sačuvaj da biste ih zadržali.
    </div>
  );
}

// ── Drag & Drop priority list ───────────────────────────────────────────────
function AccPriorityList({ items, onChange }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  function drop(toIdx) {
    if (dragIdx === null || dragIdx === toIdx) { setDragIdx(null); setOverIdx(null); return; }
    const a = [...items];
    const [item] = a.splice(dragIdx, 1);
    a.splice(toIdx, 0, item);
    onChange(a);
    setDragIdx(null); setOverIdx(null);
  }
  if (!items.length) return <div style={{padding:"20px",textAlign:"center",color:"#adb5bd",fontSize:"13px",border:"1px dashed #e1e3e5",borderRadius:"8px"}}>Nema kategorija označenih kao sprinkler.</div>;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
      {items.map((cat, i) => (
        <div key={cat} draggable
          onDragStart={()=>setDragIdx(i)}
          onDragOver={e=>{e.preventDefault();setOverIdx(i);}}
          onDragLeave={()=>setOverIdx(null)}
          onDrop={()=>drop(i)}
          onDragEnd={()=>{setDragIdx(null);setOverIdx(null);}}
          style={{display:"flex",alignItems:"center",gap:"12px",padding:"10px 14px",borderRadius:"8px",
            background:overIdx===i?"#e8f0fe":dragIdx===i?"#f8f8f8":"white",
            border:`1px solid ${overIdx===i?"#4285f4":"#e1e3e5"}`,
            cursor:"grab",opacity:dragIdx===i?0.4:1,
            boxShadow:dragIdx===i?"none":"0 1px 3px rgba(0,0,0,0.06)",
            transition:"background 0.1s, border-color 0.1s"}}>
          <span style={{color:"#bbb",fontSize:"16px",userSelect:"none",lineHeight:1}}>⠿</span>
          <span style={{fontSize:"13px",fontWeight:700,color:"#adb5bd",minWidth:"22px"}}>{i+1}.</span>
          <span style={{flex:1,fontSize:"14px",fontWeight:500,color:"#303030"}}>{cat}</span>
        </div>
      ))}
    </div>
  );
}

// ── Config Tab ─────────────────────────────────────────────────────────────
function FallbackRow({ slotKey, label, chain, onChange }) {
  const [adding, setAdding] = useState("");
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const available = FALLBACK_OPTIONS.filter(o => o.value !== slotKey && !chain.includes(o.value));
  const labelFor = v => FALLBACK_OPTIONS.find(o => o.value === v)?.label || v;
  function add(val) {
    const v = val || adding;
    if (v) { onChange([...chain, v]); setAdding(""); }
  }
  function remove(i) { onChange(chain.filter((_,j) => j !== i)); }
  function onDrop(toIdx) {
    if (dragIdx === null || dragIdx === toIdx) return;
    const c = [...chain];
    const [item] = c.splice(dragIdx, 1);
    c.splice(toIdx, 0, item);
    onChange(c);
    setDragIdx(null); setOverIdx(null);
  }
  return (
    <div style={{display:"grid",gridTemplateColumns:"100px 1fr",gap:"0",borderBottom:"1px solid #f1f2f3",minHeight:"44px"}}>
      <div style={{padding:"10px 12px",fontSize:"13px",fontWeight:600,color:"#303030",display:"flex",alignItems:"center",borderRight:"1px solid #f1f2f3",background:"#fafbfb"}}>{label}</div>
      <div style={{padding:"8px 12px",display:"flex",flexWrap:"wrap",alignItems:"center",gap:"5px"}}>
        {chain.length===0 && <span style={{fontSize:"12px",color:"#adb5bd",fontStyle:"italic"}}>nema fallbacka</span>}
        {chain.map((v,i) => (
          <span key={v}
            draggable onDragStart={()=>setDragIdx(i)} onDragOver={e=>{e.preventDefault();setOverIdx(i);}} onDragLeave={()=>setOverIdx(null)} onDrop={()=>onDrop(i)} onDragEnd={()=>{setDragIdx(null);setOverIdx(null);}}
            style={{display:"inline-flex",alignItems:"center",gap:"4px",padding:"3px 10px 3px 8px",borderRadius:"20px",
              background:overIdx===i?"#e8f0fe":dragIdx===i?"#f0f0f0":"#e8f5e9",
              border:`1px solid ${overIdx===i?"#4285f4":dragIdx===i?"#ccc":"#a8d5a2"}`,
              fontSize:"12px",fontWeight:500,color:"#1b5e20",cursor:"grab",opacity:dragIdx===i?0.5:1,transition:"all 0.1s"}}>
            <span style={{color:"#81c784",fontSize:"11px",userSelect:"none"}}>⠿</span>
            <span style={{color:"#9e9e9e",fontSize:"11px"}}>{i+1}.</span>
            {labelFor(v)}
            <span onClick={()=>remove(i)} style={{cursor:"pointer",fontSize:"14px",color:"#bbb",marginLeft:"2px",lineHeight:1}} title="Ukloni">×</span>
          </span>
        ))}
        {available.length>0 && (
          <select value={adding} onChange={e=>{setAdding(e.target.value);if(e.target.value)add(e.target.value);}}
            style={{fontSize:"12px",padding:"3px 8px",borderRadius:"20px",border:"1px dashed #c9cccf",background:"white",color:"#6d7175",cursor:"pointer",outline:"none"}}>
            <option value="">+ Dodaj</option>
            {available.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

function normalizeWeights(c) {
  const r = { ...c };
  for (const k of ["scoreWeightCategory","scoreWeightVariants","scoreWeightInventory"]) {
    if (r[k] !== undefined && r[k] <= 1) r[k] = Math.round(r[k] * 100);
  }
  return r;
}

function ConfigTab({ config, categories = EMPTY_CATEGORIES, title, onSave, onReset, onDirtyChange = () => {} }) {
  const [cfg, setCfg]         = useState(normalizeWeights({ ...config }));
  const [saving, setSaving]   = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [bannedList, setBannedList] = useState(config.bannedCategoriesTopN || []);
  const [bannedTyping, setBannedTyping] = useState("");
  const [fallbacks, setFallbacks] = useState({ ...DEFAULT_FALLBACKS, ...(config.fallbacks || {}) });

  const sprinklerCats = categories.filter(c => c.is_sprinkler).map(c => c.handle);
  function initAccOrder(savedOrder) {
    if (!savedOrder?.length) return sprinklerCats;
    // Zadrži sačuvani redoslijed, dodaj nove sprinklere na kraj, makni one koji više nisu sprinkleri
    const kept = savedOrder.filter(h => sprinklerCats.includes(h));
    const added = sprinklerCats.filter(h => !savedOrder.includes(h));
    return [...kept, ...added];
  }
  const [accOrder, setAccOrder] = useState(() => initAccOrder(config.accessoryCategoryOrder));
  const origCfgRef = useRef(null);

  useEffect(() => {
    const nc = normalizeWeights({ ...config });
    const nb = config.bannedCategoriesTopN || [];
    const nf = { ...DEFAULT_FALLBACKS, ...(config.fallbacks || {}) };
    const na = initAccOrder(config.accessoryCategoryOrder);
    origCfgRef.current = { cfg: nc, bannedList: nb, fallbacks: nf, accOrder: na };
    setCfg(nc); setBannedList(nb); setFallbacks(nf); setAccOrder(na);
    setIsDirty(false); onDirtyChange(false);
  }, [config, categories]);

  const prevDirtyRef = useRef(false);
  useEffect(() => {
    if (!origCfgRef.current) return;
    const o = origCfgRef.current;
    const dirty =
      JSON.stringify(cfg)        !== JSON.stringify(o.cfg) ||
      JSON.stringify(bannedList) !== JSON.stringify(o.bannedList) ||
      JSON.stringify(fallbacks)  !== JSON.stringify(o.fallbacks) ||
      JSON.stringify(accOrder)   !== JSON.stringify(o.accOrder);
    setIsDirty(dirty);
    if (dirty !== prevDirtyRef.current) { prevDirtyRef.current = dirty; onDirtyChange(dirty); }
  }, [JSON.stringify(cfg), JSON.stringify(bannedList), JSON.stringify(fallbacks), JSON.stringify(accOrder)]);

  function addBanned(val) {
    const trimmed = val.trim();
    if (trimmed && !bannedList.includes(trimmed)) { setBannedList(l => [...l, trimmed]); }
    setBannedTyping("");
  }
  function removeBanned(item) { setBannedList(l => l.filter(x => x !== item)); }

  function num(key) { return String(cfg[key] ?? ""); }
  function setNum(key, val) { setCfg(c=>({...c,[key]:parseFloat(val)||0})); }
  function setPageNum(key, val) { setCfg(c=>({...c,[key]:Math.max(0, parseInt(val)||0)})); }
  function setStr(key, val) { setCfg(c=>({...c,[key]:val})); }

  const pageTotal = (cfg.womenAdultsPerPage||0) + (cfg.menAdultsPerPage||0) + (cfg.girlsPerPage||0) + (cfg.boysPerPage||0) + (cfg.babiesPerPage||0) + (cfg.maleAccessoriesPerPage||0) + (cfg.femaleAccessoriesPerPage||0);
  const pageTotalValid = pageTotal === 24;
  const weightSum = (cfg.scoreWeightCategory||0) + (cfg.scoreWeightVariants||0) + (cfg.scoreWeightInventory||0);
  const weightsValid = weightSum === 100;

  async function handleSave() {
    if (!pageTotalValid || !weightsValid) return;
    setSaving(true);
    await onSave({ ...cfg, bannedCategoriesTopN: bannedList, fallbacks, accessoryCategoryOrder: accOrder });
    setSaving(false);
    setIsDirty(false); onDirtyChange(false);
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
              Score raspon je 0–12. Penalty &gt; 12 = nikad isti na toj poziciji. Relax mehanizam automatski popušta ako nema alternative.
            </Text>
          </VerticalStack>

          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:"14px",minWidth:"400px"}}>
              <thead>
                <tr style={{borderBottom:"2px solid #e1e3e5"}}>
                  <th style={{textAlign:"left",padding:"8px 12px",fontWeight:600,color:"#6d7175",fontSize:"12px",textTransform:"uppercase"}}>Atribut</th>
                  <th style={{textAlign:"center",padding:"8px 12px",fontWeight:600,color:"#6d7175",fontSize:"12px",textTransform:"uppercase"}}>
                    <div>prev1</div>
                    <div style={{fontWeight:400,fontSize:"10px",textTransform:"none",color:"#8c9196"}}>odmah prethodni</div>
                  </th>
                  <th style={{textAlign:"center",padding:"8px 12px",fontWeight:600,color:"#6d7175",fontSize:"12px",textTransform:"uppercase"}}>
                    <div>prev2</div>
                    <div style={{fontWeight:400,fontSize:"10px",textTransform:"none",color:"#8c9196"}}>2 pozicije ranije</div>
                  </th>
                  <th style={{textAlign:"center",padding:"8px 12px",fontWeight:600,color:"#6d7175",fontSize:"12px",textTransform:"uppercase"}}>
                    <div>prev3</div>
                    <div style={{fontWeight:400,fontSize:"10px",textTransform:"none",color:"#8c9196"}}>3 pozicije ranije</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label:"Kategorija", desc:"npr. Jakne, Majice", k1:"penaltySameCategory",   k2:"penaltyInLast2Category", k3:"penaltyInLast3Category" },
                  { label:"Boja",       desc:"boja proizvoda",     k1:"penaltySameColor",      k2:"penaltyInLast2Color",    k3:"penaltyInLast3Color" },
                  { label:"Tip",        desc:"Žene / Muškarci...", k1:"penaltySameType",       k2:"penaltyInLast2Type",     k3:"penaltyInLast3Type" },
                ].map((row, i) => (
                  <tr key={row.label} style={{background:i%2===0?"#fafbfb":"white",borderBottom:"1px solid #f1f2f3"}}>
                    <td style={{padding:"8px 12px"}}>
                      <div style={{fontWeight:600}}>{row.label}</div>
                      <div style={{fontSize:"11px",color:"#8c9196"}}>{row.desc}</div>
                    </td>
                    {[row.k1, row.k2, row.k3].map(k => {
                      const v = cfg[k] ?? 0;
                      const isNever = v > 12;
                      return (
                        <td key={k} style={{padding:"6px 12px",textAlign:"center"}}>
                          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:"3px"}}>
                            <input
                              type="number" min="0" step="0.5"
                              value={v}
                              onChange={e=>setNum(k, e.target.value)}
                              style={{
                                width:"60px",textAlign:"center",fontSize:"14px",
                                border:`1px solid ${isNever?"#f0a0a0":"#c9cccf"}`,
                                borderRadius:"6px",padding:"5px 6px",
                                background: isNever?"#fff0f0":"white",
                              }}
                            />
                            {isNever && <span style={{fontSize:"10px",color:"#d72c0d",fontWeight:600}}>NIKAD</span>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </VerticalStack>
      </Card>

      {/* Zabranjene kategorije */}
      <Card>
        <VerticalStack gap="400">
          <VerticalStack gap="100">
            <Text as="h3" variant="headingSm">Zabranjene kategorije</Text>
            <Text tone="subdued" variant="bodySm">
              Ove kategorije se ne pojavljuju na prvih <strong>{cfg.banTopN || 24}</strong> pozicija (= prva stranica).
              Korisno za setove, potkošulje i slično što ne treba biti istaknuto.
            </Text>
          </VerticalStack>

          {/* Tag input */}
          <div style={{
            display:"flex", flexWrap:"wrap", gap:"8px", alignItems:"center",
            padding:"10px 12px", borderRadius:"8px",
            border:"1px solid #c9cccf", background:"white", minHeight:"48px",
            cursor:"text",
          }}
            onClick={() => document.getElementById("banned-input")?.focus()}
          >
            {bannedList.map(item => (
              <span key={item} style={{
                display:"inline-flex", alignItems:"center", gap:"5px",
                padding:"3px 10px", borderRadius:"14px",
                background:"#fff0c2", border:"1px solid #e8c84a",
                fontSize:"13px", fontWeight:500, color:"#5c4a00",
              }}>
                {item}
                <span
                  onClick={e => { e.stopPropagation(); removeBanned(item); }}
                  style={{cursor:"pointer", fontSize:"14px", color:"#8c6e00", lineHeight:1}}
                >×</span>
              </span>
            ))}
            <input
              id="banned-input"
              value={bannedTyping}
              onChange={e => {
                const v = e.target.value;
                if (v.endsWith(",")) { addBanned(v.slice(0,-1)); return; }
                setBannedTyping(v);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") { e.preventDefault(); addBanned(bannedTyping); }
                if (e.key === "Backspace" && !bannedTyping && bannedList.length) removeBanned(bannedList[bannedList.length-1]);
              }}
              placeholder={bannedList.length ? "" : "Upiši naziv kategorije i pritisni Enter..."}
              style={{
                border:"none", outline:"none", fontSize:"14px",
                flex:1, minWidth:"180px", padding:"2px 0", background:"transparent",
              }}
            />
          </div>
          <Text tone="subdued" variant="bodySm">
            Pritisni <strong>Enter</strong> ili <strong>zarez</strong> da dodaš · <strong>Backspace</strong> da ukloniš zadnji · klikni <strong>×</strong> za uklanjanje
          </Text>

          <FormLayout>
            <FormLayout.Group condensed>
              <TextField
                label="Broj zabranjenih pozicija"
                type="number"
                value={num("banTopN")}
                onChange={v=>setNum("banTopN",v)}
                helpText={`Zabranjene kategorije se ne prikazuju na prvih ${cfg.banTopN||24} mjesta. 24 = cijela 1. stranica.`}
              />
            </FormLayout.Group>
          </FormLayout>
        </VerticalStack>
      </Card>

      {/* Prioritet aksesoara */}
      <Card>
        <VerticalStack gap="400">
          <VerticalStack gap="100">
            <Text as="h3" variant="headingSm">Prioritet aksesoara</Text>
            <Text tone="subdued" variant="bodySm">
              Redoslijed kojim se kategorije aksesoara prikazuju. Kategorije se uzimaju iz onih označenih kao sprinkler u tabu Kategorije. Kategorije na vrhu imaju prednost.
            </Text>
          </VerticalStack>
          <AccPriorityList items={accOrder} onChange={(val) => { setAccOrder(val); }} />
        </VerticalStack>
      </Card>

      {/* Fallback redoslijed */}
      <Card>
        <VerticalStack gap="400">
          <VerticalStack gap="100">
            <Text as="h3" variant="headingSm">Fallback redoslijed</Text>
            <Text tone="subdued" variant="bodySm">
              Kada nema dovoljno proizvoda određenog tipa, popunjava se sljedećim po redu.
              Npr. nema ženskih → uzmi Unisex → Muškarci → Ostalo.
            </Text>
          </VerticalStack>
          <div style={{borderRadius:"8px",border:"1px solid #e1e3e5",overflow:"hidden"}}>
            <div style={{padding:"8px 12px",background:"#fafbfb",borderBottom:"1px solid #e1e3e5",display:"grid",gridTemplateColumns:"110px 1fr",gap:"12px"}}>
              <span style={{fontSize:"11px",fontWeight:600,color:"#6d7175",textTransform:"uppercase"}}>Slot</span>
              <span style={{fontSize:"11px",fontWeight:600,color:"#6d7175",textTransform:"uppercase"}}>Fallback redoslijed</span>
            </div>
            <div style={{padding:"0 12px"}}>
              {[
                { key:"women",  label:"Žene" },
                { key:"men",    label:"Muškarci" },
                { key:"girls",  label:"Djevojčice" },
                { key:"boys",   label:"Dječaci" },
                { key:"babies", label:"Bebe" },
                { key:"accW",   label:"Žen. dodaci" },
                { key:"accM",   label:"Muš. dodaci" },
              ].map(({key, label}) => (
                <FallbackRow key={key} slotKey={key} label={label}
                  chain={fallbacks[key] || []}
                  onChange={chain => { setFallbacks(f => ({...f, [key]: chain})); }}
                />
              ))}
            </div>
          </div>
        </VerticalStack>
      </Card>

      {/* Fino podešavanje algoritma */}
      <Card>
        <VerticalStack gap="400">
          <VerticalStack gap="100">
            <Text as="h3" variant="headingSm">Fino podešavanje algoritma</Text>
            <Text tone="subdued" variant="bodySm">Napredni parametri koji kontrolišu ponašanje sortirnog algoritma.</Text>
          </VerticalStack>
          {/* Score težine i percentili */}
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:"14px"}}>
            <thead>
              <tr style={{borderBottom:"2px solid #e1e3e5"}}>
                <th style={{textAlign:"left",padding:"6px 12px",fontWeight:600,color:"#6d7175",fontSize:"12px",textTransform:"uppercase"}}></th>
                <th style={{textAlign:"center",padding:"6px 12px",fontWeight:600,color:"#6d7175",fontSize:"12px",textTransform:"uppercase"}}>Težina (%)</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label:"Score (kategorija)", wKey:"scoreWeightCategory" },
                { label:"Varijante",          wKey:"scoreWeightVariants" },
                { label:"Zalihe",             wKey:"scoreWeightInventory" },
              ].map((row,i) => (
                <tr key={row.label} style={{background:i%2===0?"#fafbfb":"white",borderBottom:"1px solid #f1f2f3"}}>
                  <td style={{padding:"8px 12px",fontWeight:500}}>{row.label}</td>
                  <td style={{padding:"8px 12px",textAlign:"center"}}>
                    <input type="number" min="0" max="100" step="1"
                      value={num(row.wKey)}
                      onChange={e=>setPageNum(row.wKey,e.target.value)}
                      style={{width:"64px",textAlign:"center",border:"1px solid #c9cccf",borderRadius:"6px",padding:"5px 6px",fontSize:"14px"}}
                    />
                  </td>
                </tr>
              ))}
              <tr style={{background: weightsValid?"#f0faf0":"#fff0f0", borderTop:"2px solid #e1e3e5"}}>
                <td style={{padding:"8px 12px",fontWeight:700,fontSize:"13px",color:weightsValid?"#1a6b3a":"#d72c0d"}}>Ukupno</td>
                <td style={{padding:"8px 12px",textAlign:"center",fontWeight:700,color:weightsValid?"#1a6b3a":"#d72c0d"}}>
                  {weightSum} {weightsValid ? "✓" : `(mora biti 100)`}
                </td>
              </tr>
            </tbody>
          </table>

          <div style={{display:"flex", gap:"16px", flexWrap:"wrap"}}>

            {/* Jitter */}
            <div style={{flex:1, minWidth:"200px", padding:"16px", borderRadius:"10px", background:"#f9fafb", border:"1px solid #e1e3e5"}}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px"}}>
                <div>
                  <div style={{fontWeight:600, fontSize:"14px"}}>Jitter</div>
                  <div style={{fontSize:"12px", color:"#6d7175", marginTop:"2px"}}>Nasumičnost u scorevima</div>
                </div>
                <input
                  type="number" min="0" max="2" step="0.05"
                  value={num("jitter")}
                  onChange={e=>setNum("jitter",e.target.value)}
                  style={{width:"64px", textAlign:"center", border:"1px solid #c9cccf", borderRadius:"6px", padding:"5px 6px", fontSize:"14px"}}
                />
              </div>
              <div style={{fontSize:"12px", color:"#6d7175", lineHeight:"1.5"}}>
                Dodaje blagu nasumičnost tako da svako sortiranje nije identično.
                <br/><span style={{color:"#1a6b3a"}}>0 = uvijek isti redoslijed</span> ·
                <span style={{color:"#b98900"}}> 0.25 = blaga varijacija</span> ·
                <span style={{color:"#d72c0d"}}> &gt;0.5 = haotično</span>
              </div>
            </div>

            {/* Relax korak */}
            <div style={{flex:1, minWidth:"200px", padding:"16px", borderRadius:"10px", background:"#f9fafb", border:"1px solid #e1e3e5"}}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"8px"}}>
                <div>
                  <div style={{fontWeight:600, fontSize:"14px"}}>Relax korak</div>
                  <div style={{fontSize:"12px", color:"#6d7175", marginTop:"2px"}}>Popuštanje penala</div>
                </div>
                <input
                  type="number" min="0.1" max="1" step="0.05"
                  value={num("relaxStep")}
                  onChange={e=>setNum("relaxStep",e.target.value)}
                  style={{width:"64px", textAlign:"center", border:"1px solid #c9cccf", borderRadius:"6px", padding:"5px 6px", fontSize:"14px"}}
                />
              </div>
              <div style={{fontSize:"12px", color:"#6d7175", lineHeight:"1.5"}}>
                Kada nema idealne alternative, penali se smanjuju za ovaj faktor.
                Min. je 20% originalnog penala.
                <br/><span style={{color:"#1a6b3a"}}>0.90 = sporo popušta</span> ·
                <span style={{color:"#b98900"}}> 0.80 = uravnoteženo</span> ·
                <span style={{color:"#d72c0d"}}> 0.60 = brzo popušta</span>
              </div>
            </div>

          </div>
        </VerticalStack>
      </Card>

      <div style={{position:"sticky",bottom:0,background:"white",borderTop:"1px solid #e1e3e5",padding:"14px 0 4px",zIndex:10,marginTop:"4px"}}>
        <UnsavedBanner show={isDirty} />
        <HorizontalStack align="space-between">
          {onReset && <Button tone="critical" variant="plain" onClick={onReset}>Resetuj na shop default</Button>}
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={!pageTotalValid||!weightsValid}>Sačuvaj postavke</Button>
        </HorizontalStack>
      </div>
    </VerticalStack>
  );
}

// ── Sort Preview Modal ──────────────────────────────────────────────────────
const RANG_COLORS = { Cold:"#d0e8ff", Mild:"#d4f0d4", Warm:"#fff0cc", Hot:"#ffd6cc" };
const TYPE_LABELS = { "Žene":"Ž","Muškarci":"M","Unisex":"U","Djevojčice":"Dj","Dječaci":"Dč","Bebe":"B" };

function scoreColor(s) {
  if (s < 0)  return "#e8e8e8";
  if (s < 4)  return "#ffd6cc";
  if (s < 7)  return "#fff0cc";
  if (s < 10) return "#d4f0d4";
  return "#b6e5b6";
}

function PreviewModal({ shop, collectionId, collectionTitle, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE = 24;

  useEffect(() => {
    fetch(`/api/sort-preview?shop=${encodeURIComponent(shop)}&collectionId=${encodeURIComponent(collectionId)}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [shop, collectionId]);

  const products = data?.products || [];
  const totalPages = Math.ceil(products.length / PAGE);
  const pageProducts = products.slice((page - 1) * PAGE, page * PAGE);

  return (
    <Modal open={true} onClose={onClose} title={`Preview: ${collectionTitle}`} large
      secondaryActions={[{ content:"Zatvori", onAction:onClose }]}
    >
      <Modal.Section>
        {loading && <div style={{textAlign:"center",padding:"40px"}}><Spinner /></div>}
        {error   && <Banner tone="critical"><p>{error}</p></Banner>}
        {data && (
          <VerticalStack gap="400">
            {/* Header info */}
            <HorizontalStack gap="300" blockAlign="center">
              <div style={{padding:"4px 12px",borderRadius:"12px",background:RANG_COLORS[data.rang]||"#f0f0f0",fontSize:"13px",fontWeight:600}}>
                Rang: {data.rang}
              </div>
              <Text tone="subdued" variant="bodySm">{data.total} proizvoda</Text>
              {totalPages > 1 && (
                <HorizontalStack gap="200" blockAlign="center">
                  <Button size="slim" disabled={page===1} onClick={()=>setPage(p=>p-1)}>‹</Button>
                  <Text variant="bodySm">Stranica {page} / {totalPages}</Text>
                  <Button size="slim" disabled={page===totalPages} onClick={()=>setPage(p=>p+1)}>›</Button>
                </HorizontalStack>
              )}
            </HorizontalStack>

            {/* Tabela */}
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
                <thead>
                  <tr style={{borderBottom:"2px solid #e1e3e5",background:"#fafbfb"}}>
                    <th style={{padding:"8px 10px",textAlign:"center",width:"40px",color:"#6d7175",fontSize:"11px",fontWeight:600,textTransform:"uppercase"}}>#</th>
                    <th style={{padding:"8px 10px",textAlign:"left",color:"#6d7175",fontSize:"11px",fontWeight:600,textTransform:"uppercase"}}>Naziv</th>
                    <th style={{padding:"8px 10px",textAlign:"left",color:"#6d7175",fontSize:"11px",fontWeight:600,textTransform:"uppercase"}}>Kategorija</th>
                    <th style={{padding:"8px 10px",textAlign:"center",color:"#6d7175",fontSize:"11px",fontWeight:600,textTransform:"uppercase"}}>Tip</th>
                    <th style={{padding:"8px 10px",textAlign:"center",color:"#6d7175",fontSize:"11px",fontWeight:600,textTransform:"uppercase"}}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {pageProducts.map((p, i) => {
                    const absPos = (page - 1) * PAGE + i + 1;
                    const pageBreak = i > 0 && i % 24 === 0;
                    return (
                      <tr key={p.shopifyId} style={{
                        borderBottom: pageBreak ? "2px solid #c4c4c4" : "1px solid #f1f2f3",
                        background: i % 2 === 0 ? "white" : "#fafbfb",
                      }}>
                        <td style={{padding:"7px 10px",textAlign:"center",color:"#8c9196",fontWeight:600,fontSize:"12px"}}>{absPos}</td>
                        <td style={{padding:"7px 10px",maxWidth:"220px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {p.score < 0 ? <span title="Sprinkler">⭐ </span> : null}{p.title}
                        </td>
                        <td style={{padding:"7px 10px",color:"#444"}}>{p.category || <span style={{color:"#bbb"}}>—</span>}</td>
                        <td style={{padding:"7px 10px",textAlign:"center"}}>
                          <span style={{fontSize:"11px",fontWeight:600,color:"#555"}}>{TYPE_LABELS[p.type] || p.type || "—"}</span>
                        </td>
                        <td style={{padding:"7px 10px",textAlign:"center"}}>
                          <span style={{
                            display:"inline-block",padding:"2px 8px",borderRadius:"10px",
                            background:scoreColor(p.score),fontSize:"12px",fontWeight:600,
                          }}>
                            {p.score < 0 ? "spr" : p.score}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </VerticalStack>
        )}
      </Modal.Section>
    </Modal>
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

function WeatherTab({ weatherConfig, shop, onSaved, onError, onSuccess, onDirtyChange = () => {} }) {
  const [cfg, setCfg]   = useState({ ...DEFAULT_WEATHER_CONFIG, ...weatherConfig });
  const [saving, setSaving]   = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [reading, setReading] = useState(false);
  const origRef = useRef({ ...DEFAULT_WEATHER_CONFIG, ...weatherConfig });
  const prevDirtyRef = useRef(false);

  useEffect(() => {
    const merged = { ...DEFAULT_WEATHER_CONFIG, ...weatherConfig };
    origRef.current = merged;
    setCfg(merged);
    setIsDirty(false); prevDirtyRef.current = false; onDirtyChange(false);
  }, [weatherConfig]);
  useEffect(() => {
    const dirty = JSON.stringify(cfg) !== JSON.stringify(origRef.current);
    setIsDirty(dirty);
    if (dirty !== prevDirtyRef.current) { prevDirtyRef.current = dirty; onDirtyChange(dirty); }
  }, [JSON.stringify(cfg)]);

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
      setIsDirty(false); onDirtyChange(false);
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
              onChange={v => { setCfg(c => ({...c, enabled: v==="on"})); }}
            />
            <FormLayout.Group>
              <TextField
                label="Grad"
                value={cfg.city || ""}
                onChange={v => { setCfg(c => ({...c, city: v})); }}
                placeholder="npr. Sarajevo"
                helpText="Grad za koji se čita prognoza (wttr.in)."
              />
              <Select
                label="Sat automatskog čitanja"
                options={hourOptions}
                value={String(cfg.readHour ?? 6)}
                onChange={v => { setCfg(c => ({...c, readHour: parseInt(v)})); }}
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

      <UnsavedBanner show={isDirty} />
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
