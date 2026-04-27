const Pool = require("./Pool");
const DEFAULTS = require("../../config/defaults");

function normText(t) { return String(t||"").trim().toLowerCase().replace(/č/g,"c").replace(/ć/g,"c").replace(/š/g,"s").replace(/đ/g,"dj").replace(/ž/g,"z"); }
function normCat(c) { const n=normText(c); if(n==="polo majica"||n==="polo majice")return "majice"; return n; }

function sortProducts(products, config={}) {
  const cfg = {...DEFAULTS,...config};
  cfg.fallbacks = { ...DEFAULTS.fallbacks, ...(cfg.fallbacks || {}) };
  const BANNED = new Set(cfg.bannedCategoriesTopN.map(normCat));
  const ACC = new Set(cfg.accessoryCategories.map(normCat));

  function gcat(normCategory) { return normCategory; }
  function gcolor(color) { return normText(color); }

  const W=cfg.womenType,M=cfg.menType,U=cfg.unisexType,G=cfg.girlsType,B=cfg.boysType,BB=cfg.babyType;

  const items = products.map((p,idx)=>{
    const type=String(p.product_type||"").trim();
    const color=extractColor(p);
    const category=extractCategory(p);
    const normCategory=normCat(category);
    const isSprinkler=p.isSprinkler||p.score===cfg.sprinklerScoreValue;
    const isAccessory=ACC.has(normCategory);
    return{idx,shopifyId:p.id,type,color,category,normCategory,score:p.score??0,isSprinkler,isAccessory};
  });

  const raw={womenAdults:[],menAdults:[],unisexAdults:[],girls:[],boys:[],babies:[],sprAccW:[],sprAccM:[],sprAccU:[],sprAccKids:[],sprAccBaby:[],accW:[],accM:[],accU:[],accKids:[],accBaby:[],other:[]};
  for(const it of items){
    if(it.isSprinkler){if(it.type===W)raw.sprAccW.push(it);else if(it.type===M)raw.sprAccM.push(it);else if(it.type===U)raw.sprAccU.push(it);else if(it.type===G||it.type===B)raw.sprAccKids.push(it);else if(it.type===BB)raw.sprAccBaby.push(it);else raw.sprAccU.push(it);continue;}
    if(it.isAccessory){if(it.type===W)raw.accW.push(it);else if(it.type===M)raw.accM.push(it);else if(it.type===U)raw.accU.push(it);else if(it.type===G||it.type===B)raw.accKids.push(it);else if(it.type===BB)raw.accBaby.push(it);else raw.accU.push(it);continue;}
    if(it.type===W)raw.womenAdults.push(it);else if(it.type===M)raw.menAdults.push(it);else if(it.type===U)raw.unisexAdults.push(it);else if(it.type===G)raw.girls.push(it);else if(it.type===B)raw.boys.push(it);else if(it.type===BB)raw.babies.push(it);else raw.other.push(it);
  }

  const desc=arr=>arr.sort((a,b)=>b.score-a.score);
  const P=Object.fromEntries(Object.entries(raw).map(([k,arr])=>[k,new Pool(desc(arr))]));
  const PMAP={women:P.womenAdults,men:P.menAdults,unisex:P.unisexAdults,girls:P.girls,boys:P.boys,babies:P.babies,accW:P.accW,accM:P.accM,accU:P.accU,other:P.other};
  const PEN={c:cfg.penaltySameCategory,col:cfg.penaltySameColor,t:cfg.penaltySameType,c2:cfg.penaltyInLast2Category,col2:cfg.penaltyInLast2Color,t2:cfg.penaltyInLast2Type,c3:cfg.penaltyInLast3Category,col3:cfg.penaltyInLast3Color,t3:cfg.penaltyInLast3Type,c4:cfg.penaltyInLast4Category,col4:cfg.penaltyInLast4Color,t4:cfg.penaltyInLast4Type,c5:cfg.penaltyInLast5Category,col5:cfg.penaltyInLast5Color,t5:cfg.penaltyInLast5Type};
  let relax=1.0;
  const out=[];
  const flatMode=(cfg.maleAccessoriesPerPage??0)+(cfg.femaleAccessoriesPerPage??0)>=24;
  const ACC_ORDER=((cfg.accessoryCategoryOrder?.length?cfg.accessoryCategoryOrder:cfg.sprinklerCategoryOrder?.length?cfg.sprinklerCategoryOrder:cfg.accessoryCategories)||[]).map(normCat);

  function banned(it){return out.length<cfg.banTopN&&BANNED.has(it.normCategory);}
  function sc(it){
    const p1=out.at(-1)??null,p2=out.at(-2)??null,p3=out.at(-3)??null,p4=out.at(-4)??null,p5=out.at(-5)??null;
    let pen=0;
    if(p1){if(gcat(it.normCategory)===gcat(p1.normCategory))pen+=PEN.c*relax;if(gcolor(it.color)===gcolor(p1.color))pen+=PEN.col*relax;if(it.type===p1.type)pen+=PEN.t*relax;}
    if(p2){if(gcat(it.normCategory)===gcat(p2.normCategory))pen+=PEN.c2*relax;if(gcolor(it.color)===gcolor(p2.color))pen+=PEN.col2*relax;if(it.type===p2.type)pen+=PEN.t2*relax;}
    if(p3){if(gcat(it.normCategory)===gcat(p3.normCategory))pen+=PEN.c3*relax;if(gcolor(it.color)===gcolor(p3.color))pen+=PEN.col3*relax;if(it.type===p3.type)pen+=PEN.t3*relax;}
    if(p4){if(gcat(it.normCategory)===gcat(p4.normCategory))pen+=PEN.c4*relax;if(gcolor(it.color)===gcolor(p4.color))pen+=PEN.col4*relax;if(it.type===p4.type)pen+=PEN.t4*relax;}
    if(p5){if(gcat(it.normCategory)===gcat(p5.normCategory))pen+=PEN.c5*relax;if(gcolor(it.color)===gcolor(p5.color))pen+=PEN.col5*relax;if(it.type===p5.type)pen+=PEN.t5*relax;}
    const pIdx=ACC_ORDER.indexOf(it.normCategory);
    const base=flatMode?(ACC_ORDER.length>0&&pIdx>=0?ACC_ORDER.length-pIdx:0):it.score;
    return base-pen+(Math.random()-0.5)*cfg.jitter;
  }
  function best(pool){
    if(!pool.length)return null;
    const chunk=pool.topN(220);let b=null,bv=-Infinity;
    for(const it of chunk){if(banned(it))continue;const v=sc(it);if(v>bv){bv=v;b=it;}}
    if(!b)for(const it of chunk){const v=sc(it);if(v>bv){bv=v;b=it;}}
    return b;
  }
  function commit(pool,it){
    const p=out.at(-1)??null;
    const same=p&&gcat(it.normCategory)===gcat(p.normCategory)&&gcolor(it.color)===gcolor(p.color)&&it.type===p.type;
    relax=same?Math.max(relax*cfg.relaxStep,cfg.minRelaxFactor):Math.min(1.0,relax/cfg.relaxStep);
    out.push(it);if(pool){pool.remove(it);pool.maybeCompact();}
  }
  function cbt(it){
    if(!it)return;if(it.isSprinkler)return commit(null,it);
    if(it.type===W)return commit(it.isAccessory?P.accW:P.womenAdults,it);
    if(it.type===M)return commit(it.isAccessory?P.accM:P.menAdults,it);
    if(it.type===U)return commit(it.isAccessory?P.accU:P.unisexAdults,it);
    if(it.type===G)return commit(it.isAccessory?P.accKids:P.girls,it);
    if(it.type===B)return commit(it.isAccessory?P.accKids:P.boys,it);
    if(it.type===BB)return commit(it.isAccessory?P.accBaby:P.babies,it);
    commit(P.other,it);
  }
  // W i M imaju odvojene poolove I odvojene pointere — svaki gender rotira nezavisno
  const isKidsOnly = cfg.womenAdultsPerPage === 0 && cfg.menAdultsPerPage === 0 && (cfg.girlsPerPage > 0 || cfg.boysPerPage > 0);
  const ACC_POOLS_W = isKidsOnly ? [P.sprAccW,P.accW,P.sprAccU,P.accU,P.sprAccKids,P.accKids] : [P.sprAccW,P.accW,P.sprAccU,P.accU];
  const ACC_POOLS_M = isKidsOnly ? [P.sprAccM,P.accM,P.accKids] : [P.sprAccM,P.accM];

  let accCatPtrW=0; // rotacija kategorija za ženski slot
  let accCatPtrM=0; // rotacija kategorija za muški slot
  let accGenFlip=false; // alternira W/M kad oba imaju stock
  let lastPickedGenderW=true;

  function pickFromPools(pools, ptr){
    const pc=out.at(-1)?.normCategory??"";
    const len=Math.max(1,ACC_ORDER.length);
    // Prolaz 1: traži po redoslijedu, izbjegavaj isti kao prethodni
    for(let i=0;i<ACC_ORDER.length;i++){
      const want=ACC_ORDER[(ptr+i)%len];
      if(want===pc)continue;
      for(const pool of pools){
        const f=pool.popWhere(it=>it.normCategory===want);
        if(f)return{item:f,newPtr:(ptr+i+1)%len};
      }
    }
    // Prolaz 2: traži po redoslijedu, ignoriši pc ograničenje (acc slot se ne smije izgubiti)
    for(let i=0;i<ACC_ORDER.length;i++){
      const want=ACC_ORDER[(ptr+i)%len];
      for(const pool of pools){
        const f=pool.popWhere(it=>it.normCategory===want);
        if(f)return{item:f,newPtr:(ptr+i+1)%len};
      }
    }
    // Zadnji resort: ma šta iz poolova
    for(const pool of pools){const f=pool.shift();if(f)return{item:f,newPtr:(ptr+1)%len};}
    return null;
  }

  function pickNextAcc(nAW,nAM){
    if(nAW<=0&&nAM<=0)return null;
    let useW;
    if(nAW>0&&nAM>0){useW=!accGenFlip;accGenFlip=!accGenFlip;}
    else if(nAW>0){useW=true;}
    else{useW=false;}
    lastPickedGenderW=useW;

    if(useW){
      const r=pickFromPools(ACC_POOLS_W,accCatPtrW);
      if(r){accCatPtrW=r.newPtr;return r.item;}
      // Ako W pool prazan, pokušaj M (i zabiliježi da je M uzet)
      const rm=pickFromPools(ACC_POOLS_M,accCatPtrM);
      if(rm){accCatPtrM=rm.newPtr;lastPickedGenderW=false;return rm.item;}
    } else {
      const r=pickFromPools(ACC_POOLS_M,accCatPtrM);
      if(r){accCatPtrM=r.newPtr;return r.item;}
      // Ako M pool prazan, pokušaj W
      const rw=pickFromPools(ACC_POOLS_W,accCatPtrW);
      if(rw){accCatPtrW=rw.newPtr;lastPickedGenderW=true;return rw.item;}
    }
    return null;
  }
  function adultSlot(nW,nM){
    const prev=out.at(-1)??null;
    // firstGender kontroliše samo prvi odrasli slot — nakon toga uvijek alternira
    const isFirstAdult=!out.some(x=>x.type===W||x.type===M);
    let t;
    if(isFirstAdult&&cfg.firstGender==="W") t=nW>0?"W":"M";
    else if(isFirstAdult&&cfg.firstGender==="M") t=nM>0?"M":"W";
    else t=nW>nM?"W":nM>nW?"M":(prev?.type===W?"M":"W");
    const isM=t==="M";
    const it=best(isM?P.menAdults:P.womenAdults)??fromFallback(isM?"men":"women")??pickNextAcc(isM?0:1, isM?1:0);
    if(!it)return{it:null,filledTarget:t};
    // Koristi stvarni tip itema za praćenje kvote — fallback može vratiti suprotan pol
    const actualT=it.type===M?"M":it.type===W?"W":t;
    return{it,filledTarget:actualT};
  }
  function fromFallback(key){const chain=cfg.fallbacks?.[key]??[];for(const k of chain){const pool=PMAP[k];if(pool){const it=best(pool);if(it)return it;}}return null;}
  function kids(p,...fb){return best(p)??fb.reduce((a,f)=>a??best(f),null);}
  function shuffle(arr){for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;}

  function buildPage(){
    let nW=cfg.womenAdultsPerPage,nM=cfg.menAdultsPerPage,nG=cfg.girlsPerPage,nB=cfg.boysPerPage,nBB=cfg.babiesPerPage,nAW=cfg.femaleAccessoriesPerPage??0,nAM=cfg.maleAccessoriesPerPage??0;
    const nAdults=nW+nM;
    const nOther=nG+nB+nBB+nAW+nAM;
    // Pat: max 1 uzastopni O slot — O slotovi nikad nisu jedan do drugog
    const pat=(()=>{
      const p=[];let rA=nAdults,rO=nOther,consec=0;
      while(rA+rO>0){
        const forceA=consec>=1||rO===0;
        const forceO=rA===0;
        const pickO=forceO||(!forceA&&Math.random()<rO/(rA+rO));
        if(pickO){p.push("O");rO--;consec++;}else{p.push("A");rA--;consec=0;}
      }
      return p;
    })();

    // Accessories-only mode: kada accessories kvota pokriva cijelu stranicu
    if(nAW+nAM>=24){
      const allPools=Object.values(P);
      for(let i=0;i<pat.length;i++){
        let b=null,bv=-Infinity,bp=null;
        for(const pool of allPools){if(!pool.length)continue;const chunk=pool.topN(80);for(const it of chunk){if(banned(it))continue;const v=sc(it);if(v>bv){bv=v;b=it;bp=pool;}}}
        if(!b){for(const pool of allPools){if(!pool.length)continue;const chunk=pool.topN(80);for(const it of chunk){const v=sc(it);if(v>bv){bv=v;b=it;bp=pool;}}}}
        if(!b)return;
        commit(bp,b);
      }
      return;
    }

    // Op: round-robin po tipovima — GIRL/BOY/BABY/ACC se naizmjenično izmjenjuju
    const op=(()=>{
      const buckets=shuffle([
        ...Array(nG>0?1:0).fill("GIRL"),
        ...Array(nB>0?1:0).fill("BOY"),
        ...Array(nBB>0?1:0).fill("BABY"),
        ...Array(nAW+nAM>0?1:0).fill("ACC"),
      ]);
      const rem={GIRL:nG,BOY:nB,BABY:nBB,ACC:nAW+nAM};
      const result=[];let bi=0;
      while(Object.values(rem).some(v=>v>0)){
        const type=buckets[bi%buckets.length];bi++;
        if(rem[type]>0){result.push(type);rem[type]--;}
      }
      return result;
    })();
    let oPtr=0;const ps=out.length;
    for(let i=0;i<pat.length;i++){
      const isFirst=out.length===ps;
      if(pat[i]==="A"||isFirst){const{it,filledTarget}=adultSlot(nW,nM);if(!it)return;if(filledTarget==="W")nW=Math.max(0,nW-1);else nM=Math.max(0,nM-1);cbt(it);continue;}
      const w=op[oPtr++%op.length];
      if(w==="ACC"&&(nAW>0||nAM>0)){const it=pickNextAcc(nAW,nAM)??fromFallback("accW")??fromFallback("accM");if(it){if(lastPickedGenderW)nAW--;else nAM--;cbt(it);continue;}}
      if(w==="BABY"&&nBB>0){const it=best(P.babies)??fromFallback("babies");if(it){nBB--;cbt(it);continue;}}
      if(w==="GIRL"&&nG>0){const it=best(P.girls)??fromFallback("girls");if(it){nG--;cbt(it);continue;}}
      if(w==="BOY"&&nB>0){const it=best(P.boys)??fromFallback("boys");if(it){nB--;cbt(it);continue;}}
      const k=kids(P.babies,P.girls,P.boys)??kids(P.girls,P.boys,P.babies)??kids(P.boys,P.girls,P.babies)??best(P.other);if(k){cbt(k);continue;}
      const{it}=adultSlot(nW,nM);if(!it)return;cbt(it);
    }
  }

  function anyLeft(){return Object.values(P).some(p=>p.length>0);}
  let safety=0;
  while(anyLeft()&&safety<200000){safety++;const b=out.length;buildPage();if(out.length===b)break;}

  function lks(k,getter){if(out.length<k)return false;const v=getter(out.at(-1));if(!v)return false;for(let i=2;i<=k;i++){if(getter(out.at(-i))!==v)return false;}return true;}
  function drain(){
    const ptr=lks(cfg.maxSameTypeRun,x=>x?.type),pcr=lks(cfg.maxSameCategoryRun,x=>x?.normCategory);
    const pt=out.at(-1)?.type??"",pc=out.at(-1)?.normCategory??"";
    const pools=[P.womenAdults,P.menAdults,P.unisexAdults,P.girls,P.boys,P.babies,P.accW,P.accM,P.accU,P.accKids,P.accBaby,P.other];
    for(const mode of[1,2,3]){let bi=null,bp=null,bv=-Infinity;for(const pool of pools){const it=best(pool);if(!it)continue;if(mode===1&&ptr&&it.type===pt)continue;if(mode===2&&pcr&&it.normCategory===pc)continue;const v=sc(it);if(v>bv){bv=v;bi=it;bp=pool;}}if(bi){commit(bp,bi);return bi;}}
    for(const sp of[P.sprAccW,P.sprAccM,P.sprAccU,P.sprAccKids,P.sprAccBaby]){const it=sp.shift();if(it){commit(null,it);return it;}}
    return null;
  }
  while(anyLeft()&&safety<400000){safety++;if(!drain())break;}

  return out.map((item,i)=>({shopifyId:item.shopifyId,position:i+1,score:item.score,type:item.type,category:item.category}));
}

function extractCategory(p){
  const tags=(p.tags||"").split(",").map(t=>t.trim());
  for(const tag of tags){const m=tag.match(/^(kategorija|category|kat):(.+)$/i);if(m)return m[2].trim();}
  return String(p.category||p.product_type||"").trim();
}
function extractColor(p){
  if(p.variants?.[0]?.options){const co=p.variants[0].options.find(o=>["color","colour","boja","farba"].includes((o.name||"").toLowerCase()));if(co)return co.value||"";}
  const tags=(p.tags||"").split(",").map(t=>t.trim());
  for(const tag of tags){const m=tag.match(/^(color|colour|boja|farba):(.+)$/i);if(m)return m[2].trim();}
  return "";
}

module.exports={sortProducts};
