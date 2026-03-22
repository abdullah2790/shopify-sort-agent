const API = "2024-01";
async function gql(shop, token, query, vars = {}) {
  const res = await fetch(`https://${shop}/admin/api/${API}/graphql.json`, { method:"POST", headers:{"X-Shopify-Access-Token":token,"Content-Type":"application/json"}, body:JSON.stringify({query,variables:vars}) });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const d = await res.json();
  if (d.errors) throw new Error(JSON.stringify(d.errors));
  return d.data;
}
async function getCollectionProducts(shop, token, colId) {
  const gid = colId.toString().startsWith("gid://") ? colId : `gid://shopify/Collection/${colId}`;
  const q = `query($id:ID!,$c:String){collection(id:$id){products(first:250,after:$c){pageInfo{hasNextPage endCursor}edges{node{id title productType tags variants(first:100){edges{node{id price inventoryQuantity selectedOptions{name value}}}}}}}}}`;
  const prods=[]; let cursor=null,more=true;
  while(more){const d=await gql(shop,token,q,{id:gid,c:cursor});const col=d?.collection;if(!col)break;for(const e of col.products.edges)prods.push(norm(e.node));more=col.products.pageInfo.hasNextPage;cursor=col.products.pageInfo.endCursor;if(more)await s(300);}
  return prods;
}
function norm(p){const id=p.id.replace("gid://shopify/Product/","");const variants=p.variants.edges.map(e=>({id:e.node.id.replace("gid://shopify/ProductVariant/",""),price:e.node.price,inventory_quantity:e.node.inventoryQuantity,options:e.node.selectedOptions}));const co=variants[0]?.options?.find(o=>["color","colour","boja","farba"].includes(o.name.toLowerCase()));return{id,title:p.title,product_type:p.productType,tags:p.tags?.join(",")||"",color:co?.value||"",variants};}
async function getCollections(shop, token, queryFilter = "") {
  const qArg = queryFilter ? `,query:${JSON.stringify(queryFilter)}` : "";
  const q=`query($c:String){collections(first:250,after:$c${qArg}){pageInfo{hasNextPage endCursor}edges{node{id title handle productsCount{count}}}}}`;
  const cols=[]; let cursor=null,more=true;
  while(more){const d=await gql(shop,token,q,{c:cursor});for(const e of d.collections.edges){const c=e.node;cols.push({id:c.id.replace("gid://shopify/Collection/",""),title:c.title,handle:c.handle,productsCount:c.productsCount?.count??0});}more=d.collections.pageInfo.hasNextPage;cursor=d.collections.pageInfo.endCursor;if(more)await s(300);}
  return cols;
}
async function updateCollectionProductPositions(shop, token, colId, sorted) {
  const gid=colId.toString().startsWith("gid://")?colId:`gid://shopify/Collection/${colId}`;
  const mut=`mutation($id:ID!,$moves:[MoveInput!]!){collectionReorderProducts(id:$id,moves:$moves){job{id done}userErrors{field message}}}`;
  const CHUNK=250;
  for(let i=0;i<sorted.length;i+=CHUNK){
    const moves=sorted.slice(i,i+CHUNK).map(p=>({id:`gid://shopify/Product/${p.shopifyId}`,newPosition:String(p.position-1)}));
    let ok=false;
    for(let a=1;a<=3;a++){try{const d=await gql(shop,token,mut,{id:gid,moves});const errs=d?.collectionReorderProducts?.userErrors||[];if(errs.length)throw new Error(errs[0].message);const jid=d?.collectionReorderProducts?.job?.id;if(jid){const done=await waitJob(shop,token,jid);if(!done){await s(2000);continue;}}ok=true;break;}catch(e){if(a<3)await s(2000);else throw e;}}
    if(!ok)throw new Error(`Sort nije uspio ${colId}`);
    if(i+CHUNK<sorted.length)await s(500);
  }
}
async function waitJob(shop,token,jobId){const q=`query($id:ID!){job(id:$id){id done}}`;for(let i=0;i<30;i++){await s(1000);const d=await gql(shop,token,q,{id:jobId});if(d?.job?.done)return true;}return false;}
function buildInstallUrl(shop,apiKey,redirect,scopes){const state=Math.random().toString(36).slice(2);const p=new URLSearchParams({client_id:apiKey,scope:scopes,redirect_uri:redirect,state});return{url:`https://${shop}/admin/oauth/authorize?${p}`,state};}
async function exchangeCodeForToken(shop,apiKey,apiSecret,code){const res=await fetch(`https://${shop}/admin/oauth/access_token`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({client_id:apiKey,client_secret:apiSecret,code})});if(!res.ok)throw new Error("OAuth failed");const d=await res.json();return d.access_token;}
function s(ms){return new Promise(r=>setTimeout(r,ms));}
module.exports={getCollectionProducts,getCollections,updateCollectionProductPositions,buildInstallUrl,exchangeCodeForToken,graphql:gql};
