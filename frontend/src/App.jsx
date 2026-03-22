import { useState, useEffect, useCallback, useRef } from "react";
import {
  AppProvider, Page, Card, Tabs, ResourceList, ResourceItem,
  Text, Button, Badge, Banner, Spinner, Select,
  VerticalStack, HorizontalStack, EmptyState, Modal, DataTable,
  TextField, FormLayout,
} from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import en from "@shopify/polaris/locales/en.json";

const shop = new URLSearchParams(window.location.search).get("shop") || "";
const SEASONS = ["zima","proljece","ljeto","jesen"];
const SEASON_LABELS = { zima:"Zima", proljece:"Proljeće", ljeto:"Ljeto", jesen:"Jesen" };

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
  const [addingAll, setAddingAll]   = useState(false);
  const [selectedCols, setSelectedCols] = useState([]);
  const [addModal, setAddModal]     = useState(false);
  const [selected, setSelected]     = useState("");
  const [configModal, setConfigModal] = useState(null);

  // Ref na trenutne scoreve kategorija — za auto-save
  const catScoresRef = useRef({});

  const loadData = useCallback(async () => {
    if (!shop) return;
    setLoading(true);
    try {
      const [c, w, l, cfg, cats, sch] = await Promise.all([
        fetch(`/api/collections?shop=${shop}`).then(r=>r.json()),
        fetch(`/api/watched-collections?shop=${shop}`).then(r=>r.json()),
        fetch(`/api/logs?shop=${shop}&limit=20`).then(r=>r.json()),
        fetch(`/api/config?shop=${shop}`).then(r=>r.json()),
        fetch(`/api/categories?shop=${shop}`).then(r=>r.json()),
        fetch(`/api/schedule?shop=${shop}`).then(r=>r.json()),
      ]);
      setCollections(c.collections||[]);
      setWatched(w.collections||[]);
      setLogs(l.logs||[]);
      setShopConfig(cfg.config||{});
      setCategories(cats.categories||[]);
      setSchedule(sch.schedule||{ enabled:false, intervalDays:1, hour:3, minute:0 });
    } catch { setError("Greška pri učitavanju."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-save scoreva prije osvježavanja
  async function saveCurrentScores() {
    const scores = Object.entries(catScoresRef.current).map(([handle, season_scores]) => ({ handle, season_scores }));
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
      await fetch("/api/sort", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, collectionId}) });
      setSuccess(`✅ Sortiranje "${title}" pokrenuto!`);
      setTimeout(loadData, 3000);
    } catch { setError("Greška."); } finally { setSorting(null); }
  }

  async function runSortAll() {
    setSorting("all"); setError(null); setSuccess(null);
    try {
      await fetch("/api/sort-all", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop}) });
      setSuccess("✅ Sortiranje svih kolekcija pokrenuto!");
      setTimeout(loadData, 5000);
    } catch { setError("Greška."); } finally { setSorting(null); }
  }

  async function addCollection() {
    const col = collections.find(c=>c.id===selected); if(!col) return;
    try {
      await fetch("/api/watched-collections", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, collectionId:col.id, collectionTitle:col.title, active:true}) });
      setAddModal(false); setSelected(""); loadData();
    } catch { setError("Greška."); }
  }

  async function removeCollection(collectionId) {
    try {
      await fetch("/api/watched-collections", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, collectionId, active:false}) });
      loadData();
    } catch { setError("Greška."); }
  }

  // Sync + auto-save trenutnih scoreva
  async function syncCategories() {
    setError(null); setSuccess(null);
    const scores = Object.entries(catScoresRef.current).map(([handle, season_scores]) => ({ handle, season_scores }));
    try {
      await fetch("/api/categories/sync", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, scores}) });
      setSuccess("✅ Scorevi sačuvani i sync kategorija pokrenut! Osvježi za par sekundi.");
      setTimeout(loadData, 5000);
    } catch { setError("Greška."); }
  }

  async function bulkRemove(removeAll) {
    const ids = removeAll ? [] : (selectedCols === "All" ? [] : selectedCols);
    const isAll = removeAll || selectedCols === "All";
    setError(null); setSuccess(null);
    try {
      const res = await fetch("/api/watched-collections/bulk-remove", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ shop, collectionIds: ids, all: isAll }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Greška");
      setSelectedCols([]);
      await loadData();
    } catch (e) { setError(e.message); }
  }

  async function syncAllCollections() {
    setAddingAll(true); setError(null); setSuccess(null);
    try {
      const res = await fetch("/api/sync-all-collections", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop}) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error||"Greška");
      setSuccess(`✅ Učitano ${d.total} kolekcija, dodano ${d.added} novih.`);
      await loadData();
    } catch (e) { setError(e.message); }
    finally { setAddingAll(false); }
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
  const colOptions = [
    { label:"Odaberi kolekciju...", value:"" },
    ...collections.filter(c=>!activeWatched.find(w=>w.collection_id===c.id)).map(c=>({label:c.title, value:c.id})),
  ];

  const tabs = [
    { id:"collections", content:"Kolekcije" },
    { id:"categories",  content:`Kategorije (${categories.length})` },
    { id:"config",      content:"Opće postavke" },
    { id:"schedule",    content:"Raspored" },
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
                <HorizontalStack gap="200">
                  <Button variant="plain" loading={addingAll} onClick={syncAllCollections}>Učitaj sve</Button>
                  <Button variant="plain" onClick={()=>setAddModal(true)}>+ Dodaj</Button>
                </HorizontalStack>
              </HorizontalStack>
              {activeWatched.length===0 ? (
                <EmptyState heading="Nema praćenih kolekcija" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <Button onClick={()=>setAddModal(true)}>Dodaj kolekciju</Button>
                </EmptyState>
              ) : (
                <ResourceList
                  items={activeWatched}
                  selectedItems={selectedCols}
                  onSelectionChange={setSelectedCols}
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

        {/* ── Tab 4: Logovi ── */}
        {tab===4 && (
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

      <Modal open={addModal} onClose={()=>setAddModal(false)} title="Dodaj kolekciju"
        primaryAction={{content:"Dodaj", onAction:addCollection, disabled:!selected}}
        secondaryActions={[{content:"Odustani", onAction:()=>setAddModal(false)}]}
      >
        <Modal.Section>
          <Select label="Kolekcija" options={colOptions} value={selected} onChange={setSelected} />
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
function CategoriesTab({ categories, shop, scoresRef, onSaved, onError, onSuccess }) {
  const [scores, setScores] = useState(() => {
    const m = {};
    for (const c of categories) m[c.handle] = { ...c.season_scores };
    return m;
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const m = {};
    for (const c of categories) m[c.handle] = { ...c.season_scores };
    setScores(m);
    scoresRef.current = m;
  }, [categories]);

  function setScore(handle, season, val) {
    setScores(s => {
      const next = { ...s, [handle]: { ...(s[handle]||{}), [season]: parseFloat(val)||0 } };
      scoresRef.current = next;
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const arr = Object.entries(scores).map(([handle, season_scores]) => ({ handle, season_scores }));
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
                <th style={{textAlign:"left",padding:"10px 12px",fontWeight:600}}>Kategorija</th>
                {SEASONS.map(s=><th key={s} style={{textAlign:"center",padding:"10px 12px",fontWeight:600,minWidth:"80px"}}>{SEASON_LABELS[s]}</th>)}
              </tr>
            </thead>
            <tbody>
              {categories.map((cat, i) => (
                <tr key={cat.handle} style={{background:i%2===0?"#fafbfb":"white",borderBottom:"1px solid #f1f2f3"}}>
                  <td style={{padding:"8px 12px",fontWeight:500}}>{cat.name}</td>
                  {SEASONS.map(season => (
                    <td key={season} style={{padding:"4px 8px",textAlign:"center"}}>
                      <input
                        type="number" min="1" max="10" step="0.5"
                        value={scores[cat.handle]?.[season] ?? 5}
                        onChange={e=>setScore(cat.handle, season, e.target.value)}
                        style={{width:"56px",textAlign:"center",border:"1px solid #c9cccf",borderRadius:"4px",padding:"5px",fontSize:"14px"}}
                      />
                    </td>
                  ))}
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
  const [cfg, setCfg]   = useState({ ...schedule });
  const [saving, setSaving] = useState(false);

  const hourOptions   = Array.from({length:24}, (_,i) => ({ label:`${String(i).padStart(2,"0")}h`, value:String(i) }));
  const minuteOptions = [0,5,10,15,20,25,30,35,40,45,50,55].map(m => ({ label:String(m).padStart(2,"0"), value:String(m) }));
  const intervalOptions = [
    { label:"Svaki dan", value:"1" },
    { label:"Svaka 2 dana", value:"2" },
    { label:"Svaka 3 dana", value:"3" },
    { label:"Jednom sedmično", value:"7" },
  ];

  async function handleSave() {
    setSaving(true);
    try {
      await fetch("/api/schedule", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({shop, schedule:cfg}) });
      onSaved(cfg);
    } catch { onError("Greška pri čuvanju rasporeda."); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <VerticalStack gap="500">
        <Text as="h2" variant="headingMd">Automatski raspored sortiranja</Text>

        <Banner tone={cfg.enabled?"success":"warning"}>
          <p>{cfg.enabled
            ? `✅ Aktivan — sortira svake ${cfg.intervalDays===1?"":""+cfg.intervalDays+" "}${cfg.intervalDays===1?"noći":"noći"} u ${String(cfg.hour).padStart(2,"0")}:${String(cfg.minute??0).padStart(2,"0")}.`
            : "⏸ Raspored je isključen. Sortiranje se pokreće samo ručno."
          }</p>
        </Banner>

        <FormLayout>
          <Select
            label="Automatsko sortiranje"
            options={[{ label:"Isključeno", value:"off" }, { label:"Uključeno", value:"on" }]}
            value={cfg.enabled?"on":"off"}
            onChange={v=>setCfg(c=>({...c, enabled:v==="on"}))}
          />

          {cfg.enabled && (
            <>
              <Select
                label="Koliko često"
                options={intervalOptions}
                value={String(cfg.intervalDays||1)}
                onChange={v=>setCfg(c=>({...c, intervalDays:parseInt(v)}))}
              />
              <HorizontalStack gap="300" blockAlign="end">
                <div style={{flex:1}}>
                  <Select
                    label="Sat"
                    options={hourOptions}
                    value={String(cfg.hour??3)}
                    onChange={v=>setCfg(c=>({...c, hour:parseInt(v)}))}
                  />
                </div>
                <div style={{flex:1}}>
                  <Select
                    label="Minute"
                    options={minuteOptions}
                    value={String(cfg.minute??0)}
                    onChange={v=>setCfg(c=>({...c, minute:parseInt(v)}))}
                    helpText="Preporučeno: 02:00 – 05:00"
                  />
                </div>
              </HorizontalStack>
            </>
          )}
        </FormLayout>

        <HorizontalStack align="end">
          <Button variant="primary" onClick={handleSave} loading={saving}>Sačuvaj raspored</Button>
        </HorizontalStack>
      </VerticalStack>
    </Card>
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

  const pageTotal = (cfg.womenAdultsPerPage||0) + (cfg.menAdultsPerPage||0) + (cfg.girlsPerPage||0) + (cfg.boysPerPage||0) + (cfg.babiesPerPage||0);
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

      <Card>
        <VerticalStack gap="400">
          <Text as="h3" variant="headingSm">Kvote po stranici</Text>
          <FormLayout>
            <FormLayout.Group>
              <TextField label="Žene" type="number" min="0" value={num("womenAdultsPerPage")} onChange={v=>setPageNum("womenAdultsPerPage",v)} />
              <TextField label="Muškarci" type="number" min="0" value={num("menAdultsPerPage")} onChange={v=>setPageNum("menAdultsPerPage",v)} />
              <TextField label="Djevojčice" type="number" min="0" value={num("girlsPerPage")} onChange={v=>setPageNum("girlsPerPage",v)} />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField label="Dječaci" type="number" min="0" value={num("boysPerPage")} onChange={v=>setPageNum("boysPerPage",v)} />
              <TextField label="Bebe" type="number" min="0" value={num("babiesPerPage")} onChange={v=>setPageNum("babiesPerPage",v)} />
              <Select label="Ko ide prvi"
                options={[{label:"Auto",value:"auto"},{label:"Žene",value:"Žene"},{label:"Muškarci",value:"Muškarci"}]}
                value={cfg.firstGender||"auto"} onChange={v=>setStr("firstGender",v)}
              />
            </FormLayout.Group>
          </FormLayout>
          <HorizontalStack align="space-between" blockAlign="center">
            <Text variant="bodySm" tone={pageTotalValid ? "success" : "critical"}>
              Ukupno: <strong>{pageTotal} / 24</strong>{!pageTotalValid && ` — mora biti tačno 24`}
            </Text>
          </HorizontalStack>
        </VerticalStack>
      </Card>

      <Card>
        <VerticalStack gap="400">
          <Text as="h3" variant="headingSm">Penali diversifikacije</Text>
          <Text tone="subdued" variant="bodySm">Penalty &gt; 12 = nikad isti zaredom.</Text>
          <FormLayout>
            <FormLayout.Group>
              <TextField label="Ista kategorija (prev1)" type="number" value={num("penaltySameCategory")} onChange={v=>setNum("penaltySameCategory",v)} />
              <TextField label="Ista boja (prev1)" type="number" value={num("penaltySameColor")} onChange={v=>setNum("penaltySameColor",v)} />
              <TextField label="Isti tip (prev1)" type="number" value={num("penaltySameType")} onChange={v=>setNum("penaltySameType",v)} />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField label="Kategorija (prev2)" type="number" value={num("penaltyInLast2Category")} onChange={v=>setNum("penaltyInLast2Category",v)} />
              <TextField label="Boja (prev2)" type="number" value={num("penaltyInLast2Color")} onChange={v=>setNum("penaltyInLast2Color",v)} />
              <TextField label="Tip (prev2)" type="number" value={num("penaltyInLast2Type")} onChange={v=>setNum("penaltyInLast2Type",v)} />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField label="Kategorija (prev3)" type="number" value={num("penaltyInLast3Category")} onChange={v=>setNum("penaltyInLast3Category",v)} />
              <TextField label="Boja (prev3)" type="number" value={num("penaltyInLast3Color")} onChange={v=>setNum("penaltyInLast3Color",v)} />
              <TextField label="Tip (prev3)" type="number" value={num("penaltyInLast3Type")} onChange={v=>setNum("penaltyInLast3Type",v)} />
            </FormLayout.Group>
          </FormLayout>
        </VerticalStack>
      </Card>

      <Card>
        <VerticalStack gap="400">
          <Text as="h3" variant="headingSm">Zabranjene kategorije i ostalo</Text>
          <FormLayout>
            <TextField label="Zabranjene kategorije (zarez)" value={bannedInput} onChange={setBannedInput} placeholder="Setovi, Potkošulje" />
            <FormLayout.Group>
              <TextField label="Broj zabranjenih pozicija" type="number" value={num("banTopN")} onChange={v=>setNum("banTopN",v)} />
              <TextField label="Jitter" type="number" value={num("jitter")} onChange={v=>setNum("jitter",v)} helpText="0.25" />
              <TextField label="Relax korak" type="number" value={num("relaxStep")} onChange={v=>setNum("relaxStep",v)} helpText="0.80" />
            </FormLayout.Group>
          </FormLayout>
        </VerticalStack>
      </Card>

      <HorizontalStack align="space-between">
        {onReset && <Button tone="critical" variant="plain" onClick={onReset}>Resetuj na shop default</Button>}
        <Button variant="primary" onClick={handleSave} loading={saving} disabled={!pageTotalValid}>Sačuvaj</Button>
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
