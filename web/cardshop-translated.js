// Card-shop browser adapter: data loading, held input, painting and persistence.
// Root, child controllers and reveal execute understood ports in engine/dw3/ui.
import { ui } from './vendor/engine.js';
import { createNativeScreenRenderer } from './native-screen-render.js';
import { paintNativeSession } from './native-session.js';
import { fetchJson, fetchBytes, loadResidentResources } from './resident-data.js';
import { cards, persistCollection, loadCatalog, loadBoosters, loadCardPrices,
  loadCardShops, loadCardIcons, drawCardIcon } from './cardstate.js';

const PACKS = { 646: 'cmfont', 1598: 'stcdsp' };
let dataPromise;
let packDataPromise;
async function loadPackData() {
  packDataPromise ??= Promise.all([fetchJson('shop_catalog.json','Card shop'),
    fetchBytes('shop_item_records.bin','Card shop')]).then(([items,itemRecords])=>{
    const boosterItems=[];const itemIcons=new Map();
    for(const directory of items.inventoryDirectories.filter((row)=>row.category===1)) {
      for(const id of directory.items) {
        const family=itemRecords[id*items.itemRecords.stride+9];
        itemIcons.set(id,items.itemIconClips.bytes[family]);
        if(items.itemIconClips.bytes[family]===0x62)boosterItems.push(id);
      }
    }
    return {boosterItems:[...new Set(boosterItems)],itemIcons};
  }).catch((error)=>{packDataPromise=null;throw error;});
  return packDataPromise;
}
export async function bindCardShopInventory(state) {
  const data=await loadPackData();ui.bindCardPacks(cards(),state,data.boosterItems);
}
async function loadData(language) {
  dataPromise ??= Promise.all([
    fetchJson('card_shops.json','Card shop'), fetchJson('card_prices.json','Card shop'),
    fetchJson('card_boosters.json','Card shop'), fetchJson('card_catalog.json','Card shop'),
    loadPackData(), loadResidentResources(),
  ]).catch((error)=>{dataPromise=null;throw error;});
  const [shops,prices,boosters,catalog,packData,resident] = await dataPromise;
  const banks = new Map();
  for(const offset of [0x16,0x1d,0x32,0x6a,0x94]) {
    const id=offset+language;
    const path=offset===0x6a||offset===0x94 ? `assets/data/shop-banks/${id}.bin` : `cardshop-data/${id}.bin`;
    const response=await fetch(path);
    if(!response.ok)throw new Error(`Card shop text ${id}: ${response.status}`);
    banks.set(id,new Uint8Array(await response.arrayBuffer()));
  }
  const response=await fetch('cardshop-data/tables.bin');
  if(!response.ok)throw new Error(`Card shop table: ${response.status}`);
  return { ...resident,banks,tables:new Uint8Array(await response.arrayBuffer()),
    shops:shops.shops,prices:prices.prices,boosters:boosters.sets,cards:catalog.cards,
    ...packData };
}
export function createCardShopTranslated(sfx=null,options={}) {
  const c={_open:false,_session:null,_error:null,_state:null,_clock:null,_request:0};
  const renderer=createNativeScreenRenderer({pack:'stcdsp',packs:PACKS},
    (directory)=>PACKS[directory>>>16]??null, {
      paintPrim(ctx,call) {
        if(call.method!=='cardSprite')throw new Error('Unknown card-shop picture');
        const [id,x,y,alpha]=call.args;
        ctx.save();ctx.globalAlpha=alpha/255;drawCardIcon(ctx,id,x,y);ctx.restore();
      },
    });
  c.open=(state,onClose=null,onEditFolder=null,shopId=null)=>{
    c._open=true;c._state=state;c._session=null;c._error=null;
    c._clock=new ui.MenuDisplayClock();c._onClose=onClose;c._onEditFolder=onEditFolder;
    const request=++c._request;
    const language=Number.isInteger(state?.languageByte)?state.languageByte:2;
    loadCardIcons();
    Promise.all([loadData(language),loadCatalog(),loadBoosters(),loadCardPrices(),loadCardShops()])
      .then(([data])=>{
        if(!c._open||request!==c._request)return;
        ui.bindCardPacks(cards(),state,data.boosterItems);
        c._savedRevision=0;
        c._session=new ui.CardShopSession(Number.isInteger(shopId)?shopId:0,language,
          state,cards(),data,(sound)=>sfx?.playPacked(sound),undefined,options.stage?.(state)??0);
      }).catch((error)=>{c._error=error;console.error('Translated card shop failed to open',error);});
  };
  c.isOpen=()=>c._open;
  c.handleKey=(_key,state)=>{if(state)c._state=state;};
  c.update=(dt)=>{
    if(!c._open||!c._session||c._error)return;
    for(const frame of c._clock.advance(dt)) {
      c._session.tick(c._state.keys??[],frame.tick);
      // Original grants/payments happen while the child is still open. Persist
      // that transaction immediately, then preserve it again on screen teardown.
      if(c._savedRevision!==c._session.revision) {
        c._savedRevision=c._session.revision;
        persistCollection();localStorage.setItem('bits',String(c._state.bits));
        localStorage.setItem('inventory',JSON.stringify(c._state.inventory));
      }
      if(c._session.finished()){c._finish();break;}
    }
  };
  c.draw=(ctx,width)=>{
    if(!c._open||!c._session)return;
    ctx.save();ctx.scale(width/320,width/320);
    paintNativeSession(ctx,renderer,c._session);ctx.restore();
  };
  c.close=()=>{if(c._open)c._finish();};
  c._finish=()=>{
    c._open=false;++c._request;
    persistCollection();
    localStorage.setItem('inventory',JSON.stringify(c._state.inventory));
    const transition=c._session?.transition??0;c._session=null;
    const callback=transition===0x400?c._onEditFolder:c._onClose;
    c._onEditFolder=null;c._onClose=null;callback?.();
  };
  c.diagnostics=()=>({execution:"translated",open:c._open,pending:c._open&&!c._session,error:c._error?.message??null,
    translated:true,state:c._session?.mem.read32(c._session.root+0x10)??null,
    child:c._session?.child?{kind:c._session.child.kind,state:c._session.child.state,
      cursor:c._session.child.cursor,page:c._session.child.page,stock:c._session.child.stock,
      message:c._session.child.message,reveal:c._session.child.reveal?.mode??null}:null,
    renderer:renderer.stats});
  return c;
}
