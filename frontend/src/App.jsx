import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
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
  const [logsTotal, setLogsTotal]   = useState(0);
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
  const [folderModal, setFolderModal] = useState(null); // { collectionId, title, currentFolder }
  const [folderInput, setFolderInput] = useState("");
  const [folderAction, setFolderAction] = useState(null); // { mode:"new"|"rename", oldName? }
  const [collapsedFolders, setCollapsedFolders] = useState({});
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
        fetch(`/api/collections?shop=${shop}`).then(r=>{ if(!r.ok) throw new Error("collections"); return r.json(); }),
        fetch(`/api/watched-collections?shop=${shop}`).then(r=>{ if(!r.ok) throw new Error("watched"); return r.json(); }),
        fetch(`/api/logs?shop=${shop}&limit=50`).then(r=>{ if(!r.ok) throw new Error("logs"); return r.json(); }),
        fetch(`/api/config?shop=${shop}`).then(r=>{ if(!r.ok) throw new Error("config"); return r.json(); }),
        fetch(`/api/categories?shop=${shop}`).then(r=>{ if(!r.ok) throw new Error("categories"); return r.json(); }),
        fetch(`/api/schedule?shop=${shop}`).then(r=>{ if(!r.ok) throw new Error("schedule"); return r.json(); }),
        fetch(`/api/weather-config?shop=${shop}`).then(r=>{ if(!r.ok) throw new Error("weather"); return r.json(); }),
      ]);
      setCollections(c.collections||[]);
      setWatched(w.collections||[]);
      setLogs(l.logs||[]); setLogsTotal(l.total||0);
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
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setSuccess(`✅ "${title}" sortirano (${d.productsSorted} proizvoda).`);
      await loadData();
    } catch (e) { setError(`❌ Sort greška — ${e.message}`); } finally { setSorting(null); }
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
      setAddModal(false); setSelected(""); setSearchValue(""); await loadData();
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

  async function assignFolder(collectionId, folder) {
    try {
      const res = await fetch("/api/watched-collections/folder", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, collectionId, folder}) });
      if (!res.ok) throw new Error((await res.json()).error || "Greška");
      setWatched(prev => prev.map(w => w.collection_id === collectionId ? { ...w, folder: folder || null } : w));
      setFolderModal(null);
    } catch(e) { setError(e.message); }
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
          <CollectionsTab
            activeWatched={activeWatched}
            sorting={sorting}
            selectedCols={selectedCols}
            setSelectedCols={setSelectedCols}
            runSort={runSort}
            setPreviewModal={setPreviewModal}
            setConfigModal={setConfigModal}
            removeCollection={removeCollection}
            bulkRemove={bulkRemove}
            addingAll={addingAll}
            setConfirmAddAll={setConfirmAddAll}
            setAddModal={setAddModal}
            setFolderModal={(item) => { setFolderModal(item); setFolderInput(item.currentFolder || ""); }}
            collapsedFolders={collapsedFolders}
            setCollapsedFolders={setCollapsedFolders}
            assignFolder={assignFolder}
            onNewFolder={() => { setFolderAction({mode:"new", selectedIds: selectedCols.length ? [...selectedCols] : null}); setFolderInput(""); }}
            onRenameFolder={(name) => { setFolderAction({mode:"rename",oldName:name}); setFolderInput(name); }}
            onDeleteFolder={(name, items) => {
              if (window.confirm(`Obrisati folder "${name}"? Kolekcije ostaju, samo se uklanjaju iz foldera.`)) {
                items.forEach(item => assignFolder(item.collection_id, null));
              }
            }}
          />
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
          <LogsTab
            watched={watched}
            shop={shop}
            onError={setError}
          />
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
          categories={categories}
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

      {folderModal && (() => {
        const existingFolders = [...new Set(watched.filter(w=>w.active && w.folder).map(w=>w.folder))].sort();
        return (
          <Modal
            open
            onClose={()=>setFolderModal(null)}
            title={`Folder — ${folderModal.title}`}
            primaryAction={{ content:"Spremi", onAction:()=>assignFolder(folderModal.collectionId, folderInput.trim()) }}
            secondaryActions={[
              ...(folderModal.currentFolder ? [{ content:"Ukloni iz foldera", destructive:true, onAction:()=>assignFolder(folderModal.collectionId, null) }] : []),
              { content:"Odustani", onAction:()=>setFolderModal(null) },
            ]}
          >
            <Modal.Section>
              <VerticalStack gap="300">
                <TextField
                  label="Naziv foldera"
                  value={folderInput}
                  onChange={setFolderInput}
                  placeholder="npr. Muški, Ženski, Djeca..."
                  autoComplete="off"
                />
                {existingFolders.length > 0 && (
                  <VerticalStack gap="100">
                    <Text tone="subdued" variant="bodySm">Postojeći folderi:</Text>
                    <HorizontalStack gap="200" wrap>
                      {existingFolders.map(f => (
                        <button key={f} onClick={()=>setFolderInput(f)} style={{cursor:"pointer",padding:"4px 10px",borderRadius:"14px",border:"1px solid #c9cccf",background:folderInput===f?"#5c6ac4":"#f4f6f8",color:folderInput===f?"#fff":"#202223",fontSize:"12px"}}>
                          {f}
                        </button>
                      ))}
                    </HorizontalStack>
                  </VerticalStack>
                )}
              </VerticalStack>
            </Modal.Section>
          </Modal>
        );
      })()}

      {/* Folder new/rename modal */}
      {folderAction && (
        <Modal
          open
          onClose={() => setFolderAction(null)}
          title={folderAction.mode === "new" ? "Novi folder" : `Preimenuj folder "${folderAction.oldName}"`}
          primaryAction={{
            content: folderAction.mode === "new" ? "Kreiraj" : "Spremi",
            disabled: !folderInput.trim(),
            onAction: () => {
              const name = folderInput.trim();
              if (!name) return;
              if (folderAction.mode === "new") {
                const targets = folderAction.selectedIds?.length
                  ? folderAction.selectedIds
                  : watched.filter(w => w.active && !w.folder).map(w => w.collection_id);
                targets.forEach(id => assignFolder(id, name));
              } else if (folderAction.mode === "rename" && folderAction.oldName) {
                watched.filter(w => w.active && w.folder === folderAction.oldName)
                  .forEach(w => assignFolder(w.collection_id, name));
              }
              setFolderAction(null);
            }
          }}
          secondaryActions={[{ content: "Odustani", onAction: () => setFolderAction(null) }]}
        >
          <Modal.Section>
            <VerticalStack gap="300">
              <TextField
                label="Naziv foldera"
                value={folderInput}
                onChange={setFolderInput}
                placeholder="npr. Muški, Ženski, Djeca..."
                autoComplete="off"
              />
              {folderAction.mode === "new" && (
                <Text tone="subdued" variant="bodySm">
                  {folderAction.selectedIds?.length
                    ? `${folderAction.selectedIds.length} odabranih kolekcija bit će dodano u folder.`
                    : watched.filter(w => w.active && !w.folder).length > 0
                      ? `Kolekcije bez foldera (${watched.filter(w=>w.active&&!w.folder).length}) bit će dodane. Ili odaberi specific kolekcije checkboxima prije kreiranja.`
                      : "Sve kolekcije su već u folderima. Odaberi kolekcije checkboxima pa klikni + Novi folder."}
                </Text>
              )}
            </VerticalStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}

// ── Kolekcije Tab ─────────────────────────────────────────────────────────
const FOLDER_COLORS = ["#4f6bed","#00a47c","#c4490c","#8456d4","#bf5af2","#d4693d","#2c7be5"];
function folderColor(name) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return FOLDER_COLORS[Math.abs(h) % FOLDER_COLORS.length];
}

function CollectionsTab({ activeWatched, sorting, selectedCols, setSelectedCols, runSort, setPreviewModal, setConfigModal, removeCollection, bulkRemove, addingAll, setConfirmAddAll, setAddModal, setFolderModal, collapsedFolders, setCollapsedFolders, assignFolder, onNewFolder, onRenameFolder, onDeleteFolder }) {
  const folders   = [...new Set(activeWatched.map(w => w.folder).filter(Boolean))].sort();
  const ungrouped = activeWatched.filter(w => !w.folder);
  const grouped   = folders.map(f => ({ name: f, items: activeWatched.filter(w => w.folder === f) }));
  const allIds    = activeWatched.map(w => w.collection_id);
  const allSelected = allIds.length > 0 && allIds.every(id => selectedCols.includes(id));
  const someSelected = selectedCols.length > 0;

  const [dragId, setDragId]             = useState(null);
  const [dropTarget, setDropTarget]     = useState(null); // folder name or "__none__"

  function toggleAll()  { setSelectedCols(allSelected ? [] : allIds); }
  function toggleOne(id){ setSelectedCols(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev,id]); }
  function toggleFolder(name){ setCollapsedFolders(prev=>({...prev,[name]:!prev[name]})); }

  function onDragStart(e, id) {
    e.dataTransfer.effectAllowed = "move";
    setDragId(id);
  }
  function onDragEnd() { setDragId(null); setDropTarget(null); }

  function onFolderDragOver(e, target) { e.preventDefault(); e.dataTransfer.dropEffect="move"; setDropTarget(target); }
  function onFolderDragLeave()         { setDropTarget(null); }
  function onFolderDrop(e, target)     {
    e.preventDefault();
    if (dragId) assignFolder(dragId, target === "__none__" ? null : target);
    setDragId(null); setDropTarget(null);
  }

  function CollectionRow({ item }) {
    const isSorting  = sorting === item.collection_id;
    const hasOwn     = !!item.collection_config;
    const checked    = selectedCols.includes(item.collection_id);
    const lastSort   = item.last_sorted_at ? new Date(item.last_sorted_at).toLocaleString("bs-BA") : null;
    const isDragging = dragId === item.collection_id;
    const rowRef = useRef(null);
    return (
      <div
        ref={rowRef}
        onDragStart={e => onDragStart(e, item.collection_id)}
        onDragEnd={onDragEnd}
        style={{
          display:"flex", alignItems:"center", gap:"12px",
          padding:"10px 14px", borderBottom:"1px solid #f1f2f3",
          background: checked ? "#f6f7ff" : "white",
          opacity: isDragging ? 0.4 : 1,
          transition:"opacity 0.15s, background 0.1s",
        }}>
        <span
          onMouseDown={() => rowRef.current?.setAttribute("draggable","true")}
          onMouseUp={()   => rowRef.current?.setAttribute("draggable","false")}
          onMouseLeave={() => rowRef.current?.setAttribute("draggable","false")}
          style={{color:"#c4c9d4",fontSize:"16px",flexShrink:0,cursor:"grab",userSelect:"none",padding:"0 4px"}}>⠿</span>
        <input type="checkbox" checked={checked} onChange={()=>toggleOne(item.collection_id)}
          style={{width:"15px",height:"15px",cursor:"pointer",flexShrink:0}} />
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
            <span style={{fontWeight:600,fontSize:"14px",color:"#202223"}}>{item.collection_title}</span>
            {hasOwn && <span style={{fontSize:"11px",fontWeight:600,padding:"2px 7px",borderRadius:"10px",background:"#e8f0fd",color:"#3c5bd4"}}>Vlastite postavke</span>}
          </div>
          {lastSort
            ? <div style={{fontSize:"12px",color:"#8c9196",marginTop:"2px"}}>Zadnji sort: {lastSort}</div>
            : <div style={{fontSize:"12px",color:"#b98900",marginTop:"2px"}}>Još nije sortirano</div>}
        </div>
        <div style={{display:"flex",gap:"6px",flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
          <button onClick={()=>runSort(item.collection_id, item.collection_title)} disabled={isSorting}
            style={{padding:"5px 10px",borderRadius:"6px",border:"1px solid #c9cccf",background:isSorting?"#f4f6f8":"white",cursor:isSorting?"default":"pointer",fontSize:"12px",fontWeight:600,color:isSorting?"#8c9196":"#202223"}}>
            {isSorting?"Sortira...":"Sortiraj"}
          </button>
          <button onClick={()=>setPreviewModal({collectionId:item.collection_id,title:item.collection_title})}
            style={{padding:"5px 10px",borderRadius:"6px",border:"1px solid #c9cccf",background:"white",cursor:"pointer",fontSize:"12px",color:"#202223"}}>Preview</button>
          <button onClick={()=>setConfigModal(item.collection_id)}
            style={{padding:"5px 10px",borderRadius:"6px",border:"1px solid #c9cccf",background:"white",cursor:"pointer",fontSize:"12px",color:"#202223"}}>⚙ Postavke</button>
          <button onClick={()=>removeCollection(item.collection_id)}
            style={{padding:"5px 10px",borderRadius:"6px",border:"1px solid #fed3d1",background:"#fff4f4",cursor:"pointer",fontSize:"12px",color:"#d72c0d"}}>✕</button>
        </div>
      </div>
    );
  }

  function FolderSection({ name, items }) {
    const collapsed = collapsedFolders[name];
    const color     = folderColor(name);
    const isOver    = dropTarget === name;
    return (
      <div style={{borderRadius:"10px",overflow:"hidden",border:isOver?`2px solid ${color}`:"1px solid #e1e3e5",marginBottom:"12px",transition:"border 0.15s"}}
           onDragOver={e=>onFolderDragOver(e,name)} onDragLeave={onFolderDragLeave} onDrop={e=>onFolderDrop(e,name)}>
        <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"10px 14px",background:isOver?`${color}22`:`${color}11`,borderBottom:collapsed?"none":`1px solid ${color}33`,transition:"background 0.15s"}}>
          <button onClick={()=>toggleFolder(name)} style={{display:"flex",alignItems:"center",gap:"8px",flex:1,background:"none",border:"none",cursor:"pointer",textAlign:"left",padding:0}}>
            <span style={{width:"10px",height:"10px",borderRadius:"50%",background:color,flexShrink:0,display:"inline-block"}} />
            <span style={{fontWeight:700,fontSize:"14px",color:"#202223"}}>{name}</span>
          </button>
          {isOver && dragId && <span style={{fontSize:"12px",color:color,fontWeight:600}}>Pusti ovdje →</span>}
          <span style={{fontSize:"12px",fontWeight:600,padding:"2px 8px",borderRadius:"10px",background:color,color:"white",flexShrink:0}}>{items.length}</span>
          <button onClick={()=>onRenameFolder(name)} title="Preimenuj folder"
            style={{background:"none",border:"none",cursor:"pointer",fontSize:"13px",color:"#6d7175",padding:"2px 5px",borderRadius:"4px"}} onMouseOver={e=>e.target.style.background="#e1e3e5"} onMouseOut={e=>e.target.style.background="none"}>✏</button>
          <button onClick={()=>onDeleteFolder(name,items)} title="Obriši folder"
            style={{background:"none",border:"none",cursor:"pointer",fontSize:"13px",color:"#d72c0d",padding:"2px 5px",borderRadius:"4px"}} onMouseOver={e=>e.target.style.background="#fff0f0"} onMouseOut={e=>e.target.style.background="none"}>✕</button>
          <button onClick={()=>toggleFolder(name)} style={{background:"none",border:"none",cursor:"pointer",fontSize:"12px",color:"#6d7175",padding:"2px 4px"}}>{collapsed?"▶":"▼"}</button>
        </div>
        {!collapsed && items.map(item=><CollectionRow key={item.collection_id} item={item}/>)}
      </div>
    );
  }

  return (
    <Card>
      <VerticalStack gap="400">
        <HorizontalStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">Praćene kolekcije</Text>
          <HorizontalStack gap="200">
            <Button variant="plain" onClick={onNewFolder}>+ Novi folder</Button>
            <Button variant="plain" loading={addingAll} onClick={()=>setConfirmAddAll(true)}>+ Dodaj sve</Button>
            <Button variant="plain" onClick={()=>setAddModal(true)}>+ Dodaj</Button>
          </HorizontalStack>
        </HorizontalStack>

        {activeWatched.length === 0 ? (
          <EmptyState heading="Nema praćenih kolekcija" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
            <Button onClick={()=>setAddModal(true)}>Dodaj kolekciju</Button>
          </EmptyState>
        ) : (
          <VerticalStack gap="0">
            {/* Bulk action bar */}
            <div style={{display:"flex",alignItems:"center",gap:"10px",padding:"8px 14px",background:"#f4f6f8",borderRadius:"8px",marginBottom:"12px",minHeight:"38px"}}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll}
                style={{width:"15px",height:"15px",cursor:"pointer"}} />
              {someSelected ? (
                <>
                  <span style={{fontSize:"13px",color:"#202223"}}>{selectedCols.length} odabrano</span>
                  <button onClick={()=>bulkRemove(false)}
                    style={{padding:"4px 12px",borderRadius:"6px",border:"1px solid #fed3d1",background:"#fff4f4",cursor:"pointer",fontSize:"12px",color:"#d72c0d",fontWeight:600}}>
                    Ukloni odabrane
                  </button>
                  <button onClick={()=>setSelectedCols([])}
                    style={{padding:"4px 10px",borderRadius:"6px",border:"1px solid #c9cccf",background:"white",cursor:"pointer",fontSize:"12px",color:"#6d7175"}}>
                    Poništi
                  </button>
                </>
              ) : (
                <span style={{fontSize:"13px",color:"#8c9196"}}>
                  {activeWatched.length} kolekcija ukupno
                </span>
              )}
            </div>

            {/* Folder sections */}
            {grouped.map(({ name, items }) => (
              <FolderSection key={name} name={name} items={items} />
            ))}

            {/* Ungrouped — also a drop target */}
            {(ungrouped.length > 0 || (dragId && dropTarget==="__none__")) && (
              <div style={{borderRadius:"10px",overflow:"hidden",border:dropTarget==="__none__"?"2px dashed #c9cccf":"1px solid #e1e3e5",transition:"border 0.15s"}}
                   onDragOver={e=>onFolderDragOver(e,"__none__")}
                   onDragLeave={onFolderDragLeave}
                   onDrop={e=>onFolderDrop(e,"__none__")}>
                <div style={{padding:"9px 16px",background:dropTarget==="__none__"?"#f0f0f0":"#f9fafb",borderBottom:"1px solid #e1e3e5",fontSize:"12px",fontWeight:700,color:"#6d7175",textTransform:"uppercase",letterSpacing:"0.5px",transition:"background 0.15s"}}>
                  {dropTarget==="__none__"&&dragId ? "↓ Ukloni iz foldera" : "Bez foldera"}
                </div>
                {ungrouped.map(item=><CollectionRow key={item.collection_id} item={item}/>)}
              </div>
            )}
          </VerticalStack>
        )}
      </VerticalStack>
    </Card>
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
  const origRef = useRef({ scores: {}, sprinklers: {} });
  const prevDirtyRef = useRef(false);

  useEffect(() => {
    const m = {};
    for (const c of categories) m[c.handle] = { ...c.season_scores };
    setScores(m);
    scoresRef.current = m;
    const sp = {};
    for (const c of categories) sp[c.handle] = c.is_sprinkler || false;
    setSprinklers(sp);
    sprinklersRef.current = sp;
    origRef.current = { scores: m, sprinklers: sp };
    prevDirtyRef.current = false;
    setIsDirty(false);
    onDirtyChange(false);
  }, [categories, scoresRef, sprinklersRef]);

  useEffect(() => {
    const dirty =
      JSON.stringify(scores)     !== JSON.stringify(origRef.current.scores) ||
      JSON.stringify(sprinklers) !== JSON.stringify(origRef.current.sprinklers);
    setIsDirty(dirty);
    if (dirty !== prevDirtyRef.current) { prevDirtyRef.current = dirty; onDirtyChange(dirty); }
  }, [JSON.stringify(scores), JSON.stringify(sprinklers)]);

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
      const res = await fetch("/api/categories/scores", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, scores:arr}) });
      if (!res.ok) throw new Error("Server greška");
      onSuccess("✅ Sezonski scorevi sačuvani!");
      setIsDirty(false); onDirtyChange(false);
      onSaved();
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
                <th style={{textAlign:"center",padding:"10px 12px",fontWeight:600,minWidth:"80px"}}>Aksesoar</th>
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

      </VerticalStack>
    </Card>
    <div style={{
      position:"sticky", bottom:0, zIndex:10,
      background:"white", borderRadius:"12px",
      border:"1px solid #e1e3e5", boxShadow:"0 -2px 12px rgba(0,0,0,0.06)",
      padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px",
    }}>
      {isDirty
        ? <span style={{fontSize:"13px",color:"#b98900",fontWeight:500,display:"flex",alignItems:"center",gap:"6px"}}>⚠ Imate nesačuvane promjene</span>
        : <span style={{fontSize:"13px",color:"#6d7175"}}>Sve promjene su sačuvane</span>
      }
      <Button variant="primary" onClick={handleSave} loading={saving} disabled={!isDirty}>Sačuvaj scoreve</Button>
    </div>
    </VerticalStack>
  );
}

// ── Logs Tab ────────────────────────────────────────────────────────────────
const LOGS_PER_PAGE = 25;
function LogsTab({ watched, shop, onError }) {
  const [logs, setLogs]             = useState([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [filterCol, setFilterCol]   = useState("");
  const [loading, setLoading]       = useState(false);
  const [expandedErr, setExpandedErr] = useState(null);
  const [cleanupDays, setCleanupDays] = useState("90");
  const [cleaning, setCleaning]     = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const offset = (page - 1) * LOGS_PER_PAGE;
  const totalPages = Math.ceil(total / LOGS_PER_PAGE);

  async function fetchLogs(p = page, col = filterCol) {
    setLoading(true);
    try {
      const off = (p - 1) * LOGS_PER_PAGE;
      let url = `/api/logs?shop=${encodeURIComponent(shop)}&limit=${LOGS_PER_PAGE}&offset=${off}`;
      if (col) url += `&collectionId=${encodeURIComponent(col)}`;
      const r = await fetch(url);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setLogs(d.logs || []);
      setTotal(d.total || 0);
    } catch (e) { onError(e.message || "Greška pri učitavanju logova."); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchLogs(page, filterCol); }, [page, filterCol]);

  function changeFilter(col) { setFilterCol(col); setPage(1); }
  function changePage(p) { setPage(p); }

  async function doCleanup() {
    setConfirmOpen(false); setCleaning(true);
    try {
      const res = await fetch("/api/logs/cleanup", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop, olderThanDays: parseInt(cleanupDays) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setPage(1); fetchLogs(1, filterCol);
    } catch (e) { onError(e.message || "Greška pri čišćenju."); }
    finally { setCleaning(false); }
  }

  const colOptions = [
    { label: "Sve kolekcije", value: "" },
    ...watched.map(w => ({ label: w.collection_title || w.collection_id, value: w.collection_id })),
  ];
  const triggerLabel = { cron:"Automatski", manual:"Ručno", "manual-all":"Ručno (sve)" };
  const cleanupLabel = { "7":"7 dana","30":"30 dana","60":"60 dana","90":"90 dana","180":"180 dana" }[cleanupDays] || cleanupDays;

  return (
    <VerticalStack gap="400">
      <Card>
        <VerticalStack gap="400">
          <HorizontalStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">Logovi sortiranja</Text>
            <HorizontalStack gap="300" blockAlign="center">
              <Text tone="subdued" variant="bodySm">Ukupno: {total}</Text>
              <Button size="slim" onClick={() => fetchLogs(page, filterCol)} loading={loading}>Osvježi</Button>
            </HorizontalStack>
          </HorizontalStack>

          {/* Filter po kolekciji */}
          <div style={{maxWidth:"340px"}}>
            <Select
              label="Filtriraj po kolekciji"
              options={colOptions}
              value={filterCol}
              onChange={changeFilter}
            />
          </div>

          {loading ? (
            <div style={{textAlign:"center",padding:"20px"}}><Spinner size="small" /></div>
          ) : logs.length === 0 ? (
            <Text tone="subdued">Nema logova{filterCol ? " za ovu kolekciju" : ""}.</Text>
          ) : (
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
                <thead>
                  <tr style={{borderBottom:"2px solid #e1e3e5",background:"#fafbfb"}}>
                    {["Kolekcija","Trigger","Proizvoda","Trajanje","Status","Vrijeme"].map(h=>(
                      <th key={h} style={{padding:"8px 10px",textAlign:"left",color:"#6d7175",fontSize:"11px",fontWeight:600,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, i) => {
                    const title = log.collection_title || watched.find(w=>w.collection_id===log.collection_id)?.collection_title || log.collection_id || "—";
                    const isErr = log.status !== "success";
                    const dur = log.duration_ms ? (log.duration_ms < 1000 ? `${log.duration_ms}ms` : `${(log.duration_ms/1000).toFixed(1)}s`) : "—";
                    return (
                      <React.Fragment key={log.id}>
                        <tr style={{background:i%2===0?"white":"#fafbfb",borderBottom:"1px solid #f1f2f3",cursor:isErr&&log.error_message?"pointer":"default"}}
                            onClick={()=>isErr&&log.error_message&&setExpandedErr(expandedErr===log.id?null:log.id)}>
                          <td style={{padding:"7px 10px",maxWidth:"200px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:500}}>{title}</td>
                          <td style={{padding:"7px 10px",color:"#555"}}>{triggerLabel[log.trigger]||log.trigger}</td>
                          <td style={{padding:"7px 10px",textAlign:"center"}}>{log.products_sorted||0}</td>
                          <td style={{padding:"7px 10px",color:"#555"}}>{dur}</td>
                          <td style={{padding:"7px 10px"}}>
                            <Badge tone={isErr?"critical":"success"}>{isErr?"Greška":"OK"}</Badge>
                            {isErr&&log.error_message&&<span style={{fontSize:"11px",color:"#6d7175",marginLeft:"4px"}}>▼</span>}
                          </td>
                          <td style={{padding:"7px 10px",color:"#8c9196",whiteSpace:"nowrap",fontSize:"12px"}}>
                            {new Date(log.created_at).toLocaleString("bs-BA")}
                          </td>
                        </tr>
                        {expandedErr===log.id&&(
                          <tr style={{background:"#fff4f4"}}>
                            <td colSpan={6} style={{padding:"8px 10px 10px 14px",color:"#d72c0d",fontSize:"12px",fontFamily:"monospace"}}>
                              {log.error_message}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>

                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Paginacija */}
          {totalPages > 1 && (
            <HorizontalStack align="center" gap="300">
              <Button size="slim" disabled={page===1} onClick={()=>changePage(page-1)}>‹ Prethodna</Button>
              <Text variant="bodySm">Stranica {page} / {totalPages}</Text>
              <Button size="slim" disabled={page===totalPages} onClick={()=>changePage(page+1)}>Sljedeća ›</Button>
            </HorizontalStack>
          )}
        </VerticalStack>
      </Card>

      <Card>
        <VerticalStack gap="300">
          <VerticalStack gap="100">
            <Text as="h3" variant="headingSm">Čišćenje logova</Text>
            <Text tone="subdued" variant="bodySm">Logovi se akumuliraju tokom vremena. Obriši stare zapise kako bi oslobodio prostor u bazi.</Text>
          </VerticalStack>
          <HorizontalStack gap="300" blockAlign="end">
            <div style={{width:"200px"}}>
              <Select
                label="Obriši logove starije od"
                options={[
                  { label:"7 dana",   value:"7" },
                  { label:"30 dana",  value:"30" },
                  { label:"60 dana",  value:"60" },
                  { label:"90 dana",  value:"90" },
                  { label:"180 dana", value:"180" },
                ]}
                value={cleanupDays}
                onChange={setCleanupDays}
              />
            </div>
            <Button tone="critical" onClick={()=>setConfirmOpen(true)} loading={cleaning}>Obriši</Button>
          </HorizontalStack>
        </VerticalStack>
      </Card>

      <Modal open={confirmOpen} onClose={()=>setConfirmOpen(false)} title="Obriši logove"
        primaryAction={{ content:"Da, obriši", destructive:true, loading:cleaning, onAction:doCleanup }}
        secondaryActions={[{ content:"Odustani", onAction:()=>setConfirmOpen(false) }]}>
        <Modal.Section>
          <Text>Bit će obrisani svi logovi stariji od <strong>{cleanupLabel}</strong>. Ova akcija se ne može poništiti. Jesi li siguran?</Text>
        </Modal.Section>
      </Modal>
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

      {/* Sat čitanja prognoze + pauza između kolekcija */}
      <Card>
        <VerticalStack gap="400">
          <VerticalStack gap="100">
            <Text as="h3" variant="headingSm">Prognoza za sortiranje</Text>
            <Text tone="subdued" variant="bodySm">
              Sort ne čita prognozu u sat pokretanja (noć) — umjesto toga traži prognozu za konfigurisani sat istog dana.
              Preporučeno: 13:00 (podnevna temperatura bolje odražava šta kupci nose).
            </Text>
          </VerticalStack>
          <FormLayout>
            <FormLayout.Group condensed>
              <Select
                label="Sat čitanja prognoze"
                options={Array.from({length:24}, (_,i) => ({
                  label: `${String(i).padStart(2,"0")}:00${i===13?" ✓":""}`,
                  value: String(i),
                }))}
                value={String(cfg.weatherReadHour ?? 13)}
                onChange={v => { setCfg(c => ({...c, weatherReadHour: parseInt(v)})); }}
                helpText="Kada sort krene, pita wttr.in kakva je prognoza za ovaj sat tog dana. Preporuka: 13:00."
              />
              <Select
                label="Pauza između kolekcija"
                options={[
                  { label:"Bez pauze (300ms)", value:"0" },
                  { label:"30 sekundi",        value:"30" },
                  { label:"1 minuta",          value:"60" },
                  { label:"2 minute",          value:"120" },
                  { label:"3 minute",          value:"180" },
                  { label:"5 minuta",          value:"300" },
                ]}
                value={String(cfg.collectionDelaySeconds ?? 0)}
                onChange={v => { setCfg(c => ({...c, collectionDelaySeconds: parseInt(v)})); }}
                helpText="Pauza između sortiranja svake kolekcije. Korisno za shopove s mnogo kolekcija (50+)."
              />
            </FormLayout.Group>
          </FormLayout>
        </VerticalStack>
      </Card>

      <div style={{
        position:"sticky", bottom:0, zIndex:10,
        background:"white", borderRadius:"12px",
        border:"1px solid #e1e3e5", boxShadow:"0 -2px 12px rgba(0,0,0,0.06)",
        padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px",
      }}>
        {isDirty
          ? <span style={{fontSize:"13px",color:"#b98900",fontWeight:500,display:"flex",alignItems:"center",gap:"6px"}}>⚠ Imate nesačuvane promjene</span>
          : <span style={{fontSize:"13px",color:"#6d7175"}}>Sve promjene su sačuvane</span>
        }
        <Button variant="primary" onClick={handleSave} loading={saving} disabled={!isDirty}>Sačuvaj raspored</Button>
      </div>
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
  if (!items.length) return <div style={{padding:"20px",textAlign:"center",color:"#adb5bd",fontSize:"13px",border:"1px dashed #e1e3e5",borderRadius:"8px"}}>Nema kategorija označenih kao aksesoar.</div>;
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

function ConfigTab({ config, categories = EMPTY_CATEGORIES, title, onSave, onReset, onDirtyChange = () => {}, onValidChange = () => {}, hideSaveButton = false, saveRef = null }) {
  const [cfg, setCfg]         = useState(normalizeWeights({ ...config }));
  const [saving, setSaving]   = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [bannedList, setBannedList] = useState(config.bannedCategoriesTopN || []);
  const [bannedTyping, setBannedTyping] = useState("");

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
    const na = initAccOrder(config.accessoryCategoryOrder);
    origCfgRef.current = { cfg: nc, bannedList: nb, accOrder: na };
    setCfg(nc); setBannedList(nb); setAccOrder(na);
    setIsDirty(false); onDirtyChange(false);
  }, [config, categories]);

  const prevDirtyRef = useRef(false);
  useEffect(() => {
    if (!origCfgRef.current) return;
    const o = origCfgRef.current;
    const dirty =
      JSON.stringify(cfg)            !== JSON.stringify(o.cfg) ||
      JSON.stringify(bannedList)     !== JSON.stringify(o.bannedList) ||
      JSON.stringify(accOrder)       !== JSON.stringify(o.accOrder);
    setIsDirty(dirty);
    if (dirty !== prevDirtyRef.current) { prevDirtyRef.current = dirty; onDirtyChange(dirty); }
  }, [JSON.stringify(cfg), JSON.stringify(bannedList), JSON.stringify(accOrder)]);

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
  const prevValidRef = useRef(true);
  useEffect(() => {
    const valid = pageTotalValid && weightsValid;
    if (valid !== prevValidRef.current) { prevValidRef.current = valid; onValidChange(valid); }
  }, [pageTotalValid, weightsValid]);

  async function handleSave() {
    if (!pageTotalValid || !weightsValid) return;
    setSaving(true);
    await onSave({ ...cfg, bannedCategoriesTopN: bannedList, accessoryCategoryOrder: accOrder });
    setSaving(false);
    setIsDirty(false); onDirtyChange(false);
  }

  // Expose handleSave to parent (used by CollectionConfigModal)
  if (saveRef) saveRef.current = handleSave;

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
              Redoslijed kojim se kategorije aksesoara prikazuju. Kategorije se uzimaju iz onih označenih kao aksesoar u tabu Kategorije. Kategorije na vrhu imaju prednost.
            </Text>
          </VerticalStack>
          <AccPriorityList items={accOrder} onChange={(val) => { setAccOrder(val); }} />
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

        </VerticalStack>
      </Card>

      {!hideSaveButton && (
        <div style={{
          position:"sticky", bottom:0, zIndex:10,
          background:"white",
          borderRadius:"12px",
          border:"1px solid #e1e3e5",
          boxShadow:"0 -2px 12px rgba(0,0,0,0.06)",
          padding:"14px 20px",
          display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px",
        }}>
          {isDirty
            ? <span style={{fontSize:"13px",color:"#b98900",fontWeight:500,display:"flex",alignItems:"center",gap:"6px"}}>⚠ Imate nesačuvane promjene</span>
            : <span style={{fontSize:"13px",color:"#6d7175"}}>Sve promjene su sačuvane</span>
          }
          <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
            {onReset && <Button tone="critical" variant="plain" onClick={onReset}>Resetuj na default</Button>}
            <Button variant="primary" onClick={handleSave} loading={saving} disabled={!isDirty||!pageTotalValid||!weightsValid}>Sačuvaj postavke</Button>
          </div>
        </div>
      )}
    </VerticalStack>
  );
}

// ── Sort Preview Modal ──────────────────────────────────────────────────────
const RANG_COLORS = { Cold:"#d0e8ff", Mild:"#d4f0d4", Warm:"#fff0cc", Hot:"#ffd6cc" };
const TYPE_LABELS = { "Žene":"Ž","Muškarci":"M","Unisex":"U","Djevojčice":"Djev","Dječaci":"Dječ","Bebe":"BB" };

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
                          {p.isSprinkler ? <span title="Sprinkler">⭐ </span> : p.isAccessory ? <span title="Aksesoar">🔗 </span> : null}{p.title}
                        </td>
                        <td style={{padding:"7px 10px",color:"#444"}}>{p.category || <span style={{color:"#bbb"}}>—</span>}</td>
                        <td style={{padding:"7px 10px",textAlign:"center"}}>
                          <span style={{fontSize:"11px",fontWeight:600,color:"#555"}}>{TYPE_LABELS[p.type] || p.type || "—"}</span>
                        </td>
                        <td style={{padding:"7px 10px",textAlign:"center"}}>
                          <span style={{
                            display:"inline-block",padding:"2px 8px",borderRadius:"10px",
                            background: p.isSprinkler ? "#e4e5e7" : p.isAccessory ? "#f0f4ff" : scoreColor(p.score),
                            fontSize:"12px",fontWeight:600,
                          }}>
                            {p.isSprinkler ? "spr" : p.isAccessory ? "acc" : p.score}
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
function CollectionConfigModal({ shop, collectionId, collectionTitle, categories, onClose, onSuccess, onError }) {
  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [hasOwn, setHasOwn]         = useState(false);
  const [isDirty, setIsDirty]       = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [isValid, setIsValid] = useState(true);
  const saveRef = useRef(null);

  useEffect(() => {
    fetch(`/api/collection-config?shop=${shop}&collectionId=${collectionId}`)
      .then(r=>r.json())
      .then(d=>{ setData(d); setHasOwn(!!d.collectionConfig); setLoading(false); })
      .catch(()=>setLoading(false));
  }, [shop, collectionId]);

  async function handleSave(cfg) {
    setSaving(true);
    try {
      await fetch("/api/collection-config", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, collectionId, config:cfg}) });
      onSuccess(`✅ Postavke za "${collectionTitle}" sačuvane!`);
      onClose();
    } catch(e) { onError(e?.message || "Greška"); }
    finally { setSaving(false); }
  }

  async function handleResetToDefaults() {
    try {
      await fetch("/api/collection-config", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, collectionId, config:null}) });
      onSuccess(`✅ "${collectionTitle}" vraćeno na opće postavke.`);
      onClose();
    } catch(e) { onError(e?.message || "Greška"); }
  }

  const configToShow = data?.merged ?? data?.shopConfig ?? {};

  return (
    <>
      <Modal open={true} onClose={onClose} title={`Postavke: ${collectionTitle}`} large
        primaryAction={{ content:"Sačuvaj postavke", loading:saving, disabled:!isDirty||!isValid, onAction:() => saveRef.current?.() }}
        secondaryActions={[
          !loading && hasOwn && { content:"Vrati na opće postavke", destructive:true, onAction:() => setConfirmReset(true) },
          { content:"Zatvori", onAction:onClose },
        ].filter(Boolean)}
      >
        <Modal.Section>
          {loading ? (
            <div style={{textAlign:"center",padding:"40px"}}><Spinner /></div>
          ) : (
            <VerticalStack gap="400">
              {!hasOwn && <Banner tone="info"><p>Koristi <strong>shop default postavke</strong>. Promjenama ćeš kreirati vlastite.</p></Banner>}
              {hasOwn  && <Banner tone="success"><p>Ova kolekcija ima <strong>vlastite postavke</strong>.</p></Banner>}
              <ConfigTab
                config={configToShow}
                categories={categories}
                onSave={handleSave}
                hideSaveButton={true}
                saveRef={saveRef}
                onDirtyChange={setIsDirty}
                onValidChange={setIsValid}
              />
            </VerticalStack>
          )}
        </Modal.Section>
      </Modal>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Vrati na opće postavke"
        primaryAction={{ content:"Da, vrati na opće", destructive:true, onAction:handleResetToDefaults }}
        secondaryActions={[{ content:"Odustani", onAction:() => setConfirmReset(false) }]}
      >
        <Modal.Section>
          <p>Da li ste sigurni da želite obrisati vlastite postavke za <strong>{collectionTitle}</strong>?</p>
          <p>Kolekcija će koristiti opće postavke shopa.</p>
        </Modal.Section>
      </Modal>
    </>
  );
}

// ── Weather Tab ────────────────────────────────────────────────────────────
// Koristimo isti RANG_INFO koji se koristi i u Kategorijama

function WeatherTab({ weatherConfig, shop, onSaved, onError, onSuccess, onDirtyChange = () => {} }) {
  const [cfg, setCfg]   = useState({ ...DEFAULT_WEATHER_CONFIG, ...weatherConfig });
  const [saving, setSaving]   = useState(false);
  const [isDirty, setIsDirty] = useState(false);
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


  function updateRange(name, field, val) {
    setCfg(c => ({
      ...c,
      ranges: (c.ranges || DEFAULT_WEATHER_RANGES).map(r =>
        r.name === name ? { ...r, [field]: parseInt(val) || 0 } : r
      ),
    }));
  }

  const ranges = cfg.ranges || DEFAULT_WEATHER_RANGES;
  const forecast = cfg.lastForecast;
  const rangMeta = forecast ? (RANG_INFO[forecast.rang] || {}) : null;

  return (
    <VerticalStack gap="500">

      {/* Zadnja prognoza */}
      {forecast && rangMeta ? (
        <Card>
          <VerticalStack gap="300">
            <HorizontalStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingSm">Zadnja očitana prognoza</Text>
              <Text tone="subdued" variant="bodySm">{new Date(forecast.readAt).toLocaleString("bs-BA")}</Text>
            </HorizontalStack>
            <div style={{
              display:"flex", gap:"20px", flexWrap:"wrap", alignItems:"center",
              padding:"16px 20px", borderRadius:"10px",
              background: rangMeta.bg, border:`1px solid ${rangMeta.border}`,
            }}>
              <div style={{textAlign:"center", minWidth:"80px"}}>
                <div style={{fontSize:"42px", fontWeight:700, lineHeight:1}}>{forecast.temp}°C</div>
                <div style={{fontSize:"12px", color:"#6d7175", marginTop:"4px"}}>{forecast.resolvedCity || forecast.city}</div>
                {forecast.resolvedCity && forecast.resolvedCity.toLowerCase() !== forecast.city?.toLowerCase() && (
                  <div style={{fontSize:"11px", color:"#bf0711", marginTop:"2px"}}>uneseno: "{forecast.city}"</div>
                )}
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
        <Banner tone="warning"><p>Prognoza još nije očitana. Automatski će se očitati u konfigurisanom satu.</p></Banner>
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

      <div style={{
        position:"sticky", bottom:0, zIndex:10,
        background:"white", borderRadius:"12px",
        border:"1px solid #e1e3e5", boxShadow:"0 -2px 12px rgba(0,0,0,0.06)",
        padding:"14px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"12px",
      }}>
        {isDirty
          ? <span style={{fontSize:"13px",color:"#b98900",fontWeight:500,display:"flex",alignItems:"center",gap:"6px"}}>⚠ Imate nesačuvane promjene</span>
          : <span style={{fontSize:"13px",color:"#6d7175"}}>Sve promjene su sačuvane</span>
        }
        <div style={{display:"flex",alignItems:"center",gap:"12px"}}>
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={!isDirty}>Sačuvaj postavke</Button>
        </div>
      </div>
    </VerticalStack>
  );
}
