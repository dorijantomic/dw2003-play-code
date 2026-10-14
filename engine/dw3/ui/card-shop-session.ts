// Production composition of stcrdshp. The already-oracled root, resident pad,
// text/cursor services and fold ports are shared with the item merchant. The
// two child controllers below are semantic ports of F0x800844B8/80086DC4;
// no instruction decoder or executable image is reachable from this module.
import { NativeMemory } from '../../native/memory.ts';
import type { PadButton } from '../../systems/input-map.ts';
import type { CardCollection } from '../../systems/card-battle.ts';
import { grantCard, hasSeenCard } from '../../systems/card-battle.ts';
import { ShopPadInput } from './shop-pad-input.ts';
import { ShopDrawIntents } from './shop-draw-intents.ts';
import { createResidentWidgets, loadResidentResources, type ResidentTextResources } from './resident-text-host.ts';
import { dispatchWidgetMethod } from './screen-services.ts';
import { windowFoldStart, windowFoldTick } from './window-fold.ts';
import { shopScreenCreate, shopScreenLifecycle, SHOP_STAGE_TABLE } from './native/card-shop-screen.ts';
import { shopRootCreateLabels } from './native/card-shop-startup.ts';
import { shopRootTick } from './native/card-shop-tick.ts';
import { shopRootFillPrompt, shopRootFillRows } from './card-shop-root-fill.ts';
import { CardShopReveal } from './card-shop-reveal.ts';

export interface CardShopCard {
  id: number; colour: string; kind: string; ap?: number; hp?: number; summonCost?: number; programCategory?: number;
}
export interface CardShopResources extends ResidentTextResources {
  banks: ReadonlyMap<number, Uint8Array>;
  tables: Uint8Array;
  shops: readonly { shopId: number; cardIds: number[] }[];
  prices: readonly { id: number; price: number }[];
  boosters: readonly { setId: number; pools: { cards: number[] }[] }[];
  cards: readonly CardShopCard[];
  // The resident category directory, in original item order. The type service
  // has filtered it to 0x62; the collection's pack bytes are that same item store.
  boosterItems: readonly number[];
  itemIcons: ReadonlyMap<number, number>;
}
export interface CardShopWallet { bits: number }

export class CardShopSession {
  revision = 0;
  readonly mem = new NativeMemory();
  readonly pad = new ShopPadInput();
  readonly draw = new ShopDrawIntents(this.mem);
  readonly widgets;
  readonly root: number;
  readonly context: number;
  child: CardShopChild | null = null;
  transition = 0;
  frame = 0;
  private sources = new Map<number, number>();
  private fade = 0;
  private fadeDelta = 0;
  private closed = false;
  readonly shopId: number;
  readonly language: number;
  readonly wallet: CardShopWallet;
  readonly collection: CardCollection;
  readonly resources: CardShopResources;
  readonly sound: (id: number) => void;
  readonly random: () => number;
  constructor(shopId: number, language: number, wallet: CardShopWallet,
    collection: CardCollection, resources: CardShopResources, sound: (id: number) => void,
    random: () => number = () => Math.floor(Math.random() * 0x8000), stage = 0) {
    this.shopId=shopId;this.language=language;this.wallet=wallet;
    this.collection=collection;this.resources=resources;this.sound=sound;this.random=random;
    loadResidentResources(this.mem, resources);
    this.widgets = createResidentWidgets(this.mem);
    let at = 0x80180000;
    for (const [id, bytes] of resources.banks) {
      if (at + bytes.length > 0x80200000) throw new Error('Card-shop text storage overflow');
      this.mem.load(bytes, at); this.sources.set(id, at); at = (at + bytes.length + 7) & ~7;
    }
    for (const offset of [0x16, 0x1d, 0x32, 0x6a, 0x94]) this.bank(offset);
    if (resources.tables.length !== 0x88) throw new Error('Invalid card-shop data table');
    this.mem.load(resources.tables, SHOP_STAGE_TABLE - 0x30);
    this.mem.write32(0x8005cca8, language);
    this.mem.write32(0x80048d68, stage);
    this.mem.write32(0x80048da0, wallet.bits);
    this.root = shopScreenCreate(this.mem, {
      alloc: this.widgets.arena.alloc, shopId: () => shopId, shopMode: () => 0,
      bankRequest: () => {},
    });
    this.context = this.mem.read32(this.root + 0x24);
  }
  bank(offset: number): number {
    const result = this.sources.get(offset + this.language);
    if (!result) throw new Error(`Missing card-shop language bank ${offset + this.language}`);
    return result;
  }
  callWidget = (widget: number, method: number, a = 0, b = 0): number => {
    dispatchWidgetMethod(this.mem, this.widgets, widget, method, [a, b]); return 0;
  };
  foldStart = (address: number, opening: number): void => {
    windowFoldStart(this.mem, address, opening); this.sound(opening ? 0x40019 : 0x4001a);
  };
  foldTick = (address: number): number => windowFoldTick(this.mem, address);
  price(id: number): number { return this.resources.prices.find((r) => r.id === id)?.price ?? 1; }
  heldPacks(): number[] {
    return this.resources.boosterItems.filter((id) => (this.collection.packs.get(id) ?? 0) > 0);
  }
  refreshBits(): void {
    this.mem.write32(0x80048da0, this.wallet.bits);
    const widget = this.mem.read32(this.context + 0x10);
    if (widget) { this.widgets.textNumber(widget, 0, this.wallet.bits); this.widgets.textMeasure(widget, 1); }
  }
  tick(buttons: Iterable<PadButton> = [], displayTick?: number): void {
    if (this.closed) return;
    this.frame = displayTick ?? this.frame + 1;
    this.pad.update(buttons, this.frame); this.draw.beginFrame(this.frame);
    if (this.fadeDelta) {
      this.fade += this.fadeDelta;
      if (this.fade > 0xff00) {
        this.fade = 0xff00; this.fadeDelta = 0;
        const ptr = this.mem.read32(this.context + 0x28); this.mem.write32(ptr + 0x0c, 2);
      }
    }
    // Children see the same pad latch; root ownership stays with the waiting
    // parent until the child is retired, so a closing press cannot buy twice.
    if (this.child) {
      this.child.tick();
      if (this.child.finished) {
        this.child.retire(); this.child = null; this.mem.write32(this.context + 0x24, 0);
      }
    }
    shopScreenLifecycle(this.mem, this.root, this.context, {
      ...this.draw,
      initDrawContext: this.draw.initDrawContext, setLayer: this.draw.setLayer,
      setOrigin: this.draw.setOrigin, setScale: this.draw.setScale, setPos: this.draw.setPos,
      drawSprite: this.draw.drawSprite, packResolve: this.draw.packResolve,
      startBanks: () => {}, banksPending: () => 0,
      baseMethod38: () => { this.mem.write32(this.root + 0x0c, 1); this.mem.write32(this.root + 0x10, 0); },
      call87d00: (obj, ctx) => shopRootCreateLabels(this.mem, obj, ctx, {
        createTextElement: this.widgets.createTextElement, createLevelWidget: this.widgets.spawnUiIcon,
        setWidget80: this.widgets.cursorShow,
        setWidget15C: (w, v) => this.callWidget(w, 0x15c, v),
      }),
      call8838c: (obj, ctx) => shopRootTick(this.mem, obj, ctx, {
        baseMethod2C: (_o, state) => { this.mem.write32(obj + 0x10, state); this.mem.write32(obj + 0x14, 0); },
        fillWidgets: (_o, _c, show) => shopRootFillPrompt(this.mem, obj, ctx, show, {
          bankGet: (id) => this.sources.get(id)!, callWidgetMethod: this.callWidget }),
        clearWidgets: (_o, _c, show) => shopRootFillRows(this.mem, ctx, show, {
          bankGet: (id) => this.sources.get(id)!, callWidgetMethod: this.callWidget }),
        selectDefault: () => this.createChild('buy'), selectCard: () => this.createChild('booster'),
        listCount: (_tag, ptr) => { const ids = this.heldPacks(); ids.forEach((id, i) => this.mem.write16(ptr + i * 2, id)); return ids.length; },
        listItem: () => 0x62,
        makePopup: () => this.widgets.arena.alloc(0x68),
        resourceGet: (id) => this.sources.get(id)!,
        padPressed: this.pad.pressed, padRepeat: this.pad.repeated, padKey: (_p, code) => code,
        playSound: this.sound, foldStart: this.foldStart, foldTick: this.foldTick,
        widget84: this.widgets.cursorPlace, widget80: this.widgets.cursorShow,
        widget94: (w, v) => this.callWidget(w, 0x94, v),
        widget88: (w, v) => this.callWidget(w, 0x88, v),
        widget114: (w, source, index) => this.widgets.textSet(w, source, index),
        widget144: this.widgets.textShow,
        widget64: (_w, _direction, frames) => { this.fade = 0; this.fadeDelta = Math.trunc(0xff00 / frames); },
      }),
      resourceCall: (id) => { this.transition = id; this.closed = true; }, shopIdFor: () => this.shopId,
    });
    this.widgets.tickCursors(this.frame);
  }
  private createChild(kind: 'buy' | 'booster'): number {
    this.child = new CardShopChild(this, kind); return this.child.object;
  }
  finished(): boolean { return this.closed; }
  fadeLevel(): number { return this.fade >> 8; }
}

export class CardShopChild {
  readonly object: number;
  readonly context: number;
  state = 0;
  cursor = 0;
  page = 0;
  answer = 0;
  message = 0;
  selected = 0;
  selectedPrice = 0;
  packs: number[] = [];
  reveal: CardShopReveal | null = null;
  finished = false;
  revealCursor = 0;
  private closingReveal = false;
  private returning = false;
  private detail = false;
  private rows = false;
  private footer = false;
  private confirm = false;
  private refusal = false;
  readonly stock: number[];
  readonly owner: CardShopSession;
  readonly kind: 'buy' | 'booster';
  constructor(owner: CardShopSession, kind: 'buy' | 'booster') {
    this.owner=owner;this.kind=kind;
    const w = owner.widgets;
    this.object = w.arena.alloc(kind === 'buy' ? 0xdc : 0x730);
    this.context = w.arena.alloc(kind === 'buy' ? 0x4c : 0x78);
    owner.mem.write32(this.object + 0x24, this.context);
    owner.mem.write32(this.object + 0x20, kind === 'buy' ? 19 : 30);
    this.stock = (owner.resources.shops.find((r) => r.shopId === owner.shopId) ?? owner.resources.shops[0])?.cardIds.slice() ?? [];
    if (!this.stock.length) throw new Error('Card shop has no stock directory');
    this.packs = owner.heldPacks();
    if (kind === 'buy') {
      const places = [[0,1,136,128],[4,1,277,128],[8,1,294,128],[12,1,277,166],[16,1,300,166],
        [20,1,80,151],[24,1,206,151],[28,1,240,151],[32,1,206,164],[36,1,240,164],
        [44,3,279,199],[40,3,282,199],[48,1,18,103],[52,1,289,103],
        [56,1,154,57],[60,1,197,86],[64,1,197,102]];
      for (const [slot, type, x, y] of places) this.create(slot!, type!, x!, y!);
      // F0x80086074 ends by hiding the confirm cursor it just built
      // (0x8001b364(target, +0x58-3, 0xB8, 0x56) -> +0x44, then +0x80(0)); the
      // constructor leaves it visible, so the hide is the original's.
      const confirmCursor = w.spawnUiIcon(0x1000, 3, 184, 86);
      owner.mem.write32(this.context + 0x44, confirmCursor);
      w.cursorShow(confirmCursor, 0);
      this.reveal = new CardShopReveal(this.stock.slice(0, 6), owner.sound);
      for (const off of [0xac,0xbc,0xcc]) owner.mem.write32(this.object + off, 10);
    } else {
      for (let i = 0; i < 8; i++) this.create(i*4, 1, 55+(i%2)*131, 57+Math.floor(i/2)*14);
      // F0x8008300C creates the pack-list cursor and hides it immediately
      // (0x8001b364(layer+0x54, +0x58-1, 0x1D, 0x39) -> +0x20, then +0x80(0));
      // state 2 shows it once the list and panel have filled.
      const packCursor = w.spawnUiIcon(0x1000, 5, 29, 57);
      owner.mem.write32(this.context + 0x20, packCursor);
      w.cursorShow(packCursor, 0);
      for (const [slot,x,y] of [[64,146,117],[68,147,117],[72,166,117],[56,45,113],[60,258,113],
        [36,143,138],[40,267,138],[44,289,138],[48,20,194],[52,20,208],
        [76,136,128],[80,277,128],[84,294,128],[88,277,166],[92,300,166],
        [96,80,151],[100,206,151],[104,240,151],[108,206,164],[112,240,164]]) this.create(slot!,1,x!,y!);
      for (const off of [0x6f0,0x700,0x710,0x720]) owner.mem.write32(this.object + off,10);
    }
  }
  private create(slot: number, type: number, x: number, y: number): void {
    this.owner.mem.write32(this.context + slot, this.owner.widgets.createTextElement(0x1000,type,x,y));
  }
  private widget(slot: number): number { return this.owner.mem.read32(this.context + slot); }
  private hide(slots: readonly number[]): void { for (const slot of slots) this.owner.widgets.textShow(this.widget(slot),0); }
  private text(slot: number, offset: number, index: number): void { this.owner.widgets.textSet(this.widget(slot),this.owner.bank(offset),index); }
  private number(slot: number, value: number): void {
    this.owner.widgets.textNumber(this.widget(slot),0,value); this.owner.widgets.textMeasure(this.widget(slot),1);
  }
  private pressed(code: number, repeat = false): boolean {
    return (((this.owner.pad.pressed() | (repeat ? this.owner.pad.repeated() : 0)) >>> code) & 1) !== 0;
  }
  private fold(offset: number, open: number): void { this.owner.foldStart(this.object+offset,open); }
  private folded(offset: number): boolean { return this.owner.foldTick(this.object+offset) !== 0; }
  private countPages(): number { return Math.ceil((this.kind === 'buy' ? this.stock.length : this.packs.length)/(this.kind === 'buy' ? 6 : 8)); }
  private cardId(): number { return this.kind === 'buy' ? this.stock[this.page*6+this.cursor] ?? 0 : this.reveal?.cards[this.revealCursor] ?? 0; }
  private fillDetail(show: boolean): void {
    const base = this.kind === 'buy' ? 0 : 0x4c;
    this.detail = show;
    // F0x80083780 (the booster panel) gates on the card's ever-obtained byte
    // [0x80048D34 + id + 0x4DF]: a card the player has never held hides the
    // whole panel (stcrdshp 0x80083780 0x80083780+0x18C: `lbu 0x4DF(s2)`,
    // `beqz` to the hide-all path at 0x80083DE8). The buy panel (F0x8008627C)
    // has no such gate, so this only applies to the booster.
    const seen = this.kind === 'buy' || hasSeenCard(this.owner.collection, this.cardId());
    if (!show || !seen) { this.hide(Array.from({length:10},(_,i)=>base+i*4)); if(this.kind==='buy') this.hide([0x28,0x2c]); return; }
    const id = this.cardId(); const card = this.owner.resources.cards.find((r)=>r.id===id);
    if (!card) return;
    this.text(base,0x16,id); this.text(base+12,0x32,8); this.number(base+16,this.owner.collection.owned.get(id)??0);
    const program = card.kind !== 'digimon';
    if (program) this.hide([base+4,base+8]);
    else { this.text(base+4,0x32,8); this.number(base+8,card.summonCost??0); }
    if (program || [0x45,0x70,0x9b,0xc6,0xf1].includes(id)) {
      this.text(base+20,0x1d,id); this.hide([base+24,base+28,base+32,base+36]);
    } else {
      this.hide([base+20]); this.text(base+24,0x32,17); this.number(base+28,card.ap??0);
      this.text(base+32,0x32,18); this.number(base+36,card.hp??0);
    }
    if(this.kind==='buy') { this.text(0x28,0x32,3); this.number(0x2c,this.owner.price(id)); }
  }
  private fillRows(show: boolean): void {
    this.rows = show;
    if (!show) { this.hide([0,4,8,12,16,20,24,28,0x38,0x3c,0x40,0x44,0x48]); return; }
    for(let i=0;i<8;i++) {
      const id=this.packs[this.page*8+i];
      if(id) this.text(i*4,0x6a,id); else this.hide([i*4]);
    }
    this.number(0x40,this.page+1); this.text(0x44,0x32,9); this.number(0x48,this.countPages());
    if(this.countPages()>=2 && this.page>0) this.text(0x38,0x32,10); else this.hide([0x38]);
    if(this.countPages()>=2 && this.page<this.countPages()-1) this.text(0x3c,0x32,11); else this.hide([0x3c]);
  }
  private fillPack(show: boolean): void {
    this.footer=show;
    if(!show) { this.hide([0x24,0x28,0x2c,0x30,0x34]); return; }
    const id=this.packs[this.cursor]!;
    this.text(0x24,0x6a,id);this.text(0x28,0x32,8);this.number(0x2c,this.owner.collection.packs.get(id)??0);
    this.text(0x30,0x32,15);this.text(0x34,0x32,4);
  }
  tick(): void {
    this.reveal?.tick(this.owner.frame);
    if(this.kind==='buy') this.tickBuy(); else this.tickBooster();
    this.owner.mem.write32(this.object+0x10,this.state);
    this.paint();
  }
  private tickBuy(): void {
    if(this.reveal?.mode!==1 && this.state!==51) return;
    switch(this.state) {
      default: this.fold(0xac,1);this.state++;return;
      case 1:
        if(this.folded(0xac)) { this.fillDetail(true);this.state=2; }
        return;
      case 2: {
        const old=this.cursor;
        if(this.pressed(7,true)) this.cursor=Math.max(0,this.cursor-1);
        else if(this.pressed(5,true)) this.cursor=Math.min(5,this.cursor+1);
        if(this.cursor!==old) {
          if(this.cardId()) { this.owner.sound(0x4001b);this.fillDetail(true); }
          else this.cursor=old;
        }
        const before=this.page;
        if(!(this.owner.pad.held() & (1<<11)) && this.pressed(10)) this.page=Math.max(0,this.page-1);
        else if(!(this.owner.pad.held() & (1<<10)) && this.pressed(11)) this.page=Math.min(this.countPages()-1,this.page+1);
        if(before!==this.page) { this.owner.sound(0x4001b);this.cursor=0;this.reveal!.begin(this.stock.slice(this.page*6,this.page*6+6));this.state=1; }
        if(this.pressed(13)) {
          this.selected=this.cardId();this.selectedPrice=this.owner.price(this.selected);this.owner.sound(0x4001c);
          if(this.owner.wallet.bits<this.selectedPrice) {this.state=10;this.message=19;}
          else if((this.owner.collection.owned.get(this.selected)??0)===9) {this.state=10;this.message=20;}
          else this.state=5;
        } else if(this.pressed(14)) {this.owner.sound(0x800450bd);this.state=50;}
        return;
      }
      case 5: this.fold(0xbc,1);this.fold(0xcc,1);this.state=6;return;
      case 6:
        this.folded(0xcc);
        if(this.folded(0xbc)) {
          this.text(0x38,0x32,12);this.owner.widgets.textNumber(this.widget(0x38),1,this.selectedPrice);
          this.text(0x3c,0x32,13);this.text(0x40,0x32,14);
          this.owner.widgets.cursorPlace(this.widget(0x44),184,86+this.answer*16);
          this.owner.widgets.cursorShow(this.widget(0x44),1);this.confirm=true;this.state=7;
        } return;
      case 7: {
        const old=this.answer;
        if(this.pressed(4))this.answer=0;else if(this.pressed(6))this.answer=1;
        if(old!==this.answer) {this.owner.sound(0x8004513e);this.owner.widgets.cursorPlace(this.widget(0x44),184,86+this.answer*16);}
        if(this.pressed(13)) {
          this.owner.sound(0x8004503c);
          if(this.answer===0){grantCard(this.owner.collection,this.selected,1);this.owner.wallet.bits-=this.selectedPrice;this.owner.refreshBits();this.owner.revision++;}
          this.state=8;
        }else if(this.pressed(14)){this.owner.sound(0x800450bd);this.state=8;}
        return;
      }
      case 8: this.hide([0x38,0x3c,0x40]);this.owner.widgets.cursorShow(this.widget(0x44),0);this.confirm=false;this.answer=0;this.fold(0xbc,0);this.state=9;return;
      case 9:
      case 13: if(this.folded(0xbc))this.state=1;return;
      case 10: this.fold(0xbc,1);this.owner.mem.write32(this.object+0xd4,0);this.state=11;return;
      case 11: if(this.folded(0xbc)){this.text(0x38,0x32,this.message);this.refusal=true;this.state=12;}return;
      case 12:
        if(this.pressed(13)||this.pressed(14)){this.owner.sound(0x4001c);this.hide([0x38]);this.refusal=false;this.fold(0xbc,0);this.state=13;}return;
      case 50: this.fillDetail(false);this.hide([0x30,0x34]);this.fold(0xac,0);this.state=51;return;
      case 51:
        if(this.folded(0xac)){if(!this.closingReveal){this.reveal?.close();this.closingReveal=true;}else if(this.reveal?.mode===3)this.finished=true;}
        return;
    }
  }
  private tickBooster(): void {
    switch(this.state) {
      default: this.fold(0x6f0,1);this.state++;return;
      case 1: if(this.folded(0x6f0)){this.fillRows(true);this.fold(0x700,1);this.fold(0x710,1);this.state=2;}return;
      case 2:
        this.folded(0x710);
        if(this.folded(0x700)){this.fillPack(true);this.owner.widgets.cursorShow(this.widget(0x20),1);this.placePackCursor();this.state=3;}return;
      case 3: this.state=4;return;
      case 4: {
        const oldPage=this.page;
        if(!(this.owner.pad.held()&(1<<11))&&this.pressed(10))this.page=Math.max(0,this.page-1);
        else if(!(this.owner.pad.held()&(1<<10))&&this.pressed(11))this.page=Math.min(this.countPages()-1,this.page+1);
        if(oldPage!==this.page){this.cursor=this.page*8;this.owner.sound(0x8004513e);this.fillRows(true);this.fillPack(true);this.placePackCursor();return;}
        const old=this.cursor;const lo=this.page*8,hi=Math.min(lo+7,this.packs.length-1);
        if(this.pressed(4,true))this.cursor=Math.max(lo,this.cursor-2);else if(this.pressed(6,true))this.cursor=Math.min(hi,this.cursor+2);
        if(this.pressed(7,true))this.cursor=Math.max(lo,this.cursor-1);else if(this.pressed(5,true))this.cursor=Math.min(hi,this.cursor+1);
        if(old!==this.cursor){this.owner.sound(0x8004513e);this.fillPack(true);this.placePackCursor();return;}
        if(this.pressed(13)){this.owner.sound(0x8004503c);this.state=10;}
        else if(this.pressed(14)){this.owner.sound(0x800450bd);this.returning=false;this.state=50;}
        return;
      }
      case 10:
        this.fold(0x6f0,0);this.fillRows(false);this.fold(0x700,0);this.fillPack(false);
        this.owner.widgets.cursorShow(this.widget(0x20),0);this.text(0x30,0x32,16);this.text(0x34,0x32,4);this.state=11;return;
      case 11:
        this.folded(0x6f0);
        if(this.folded(0x700)) {
          if(this.reveal){this.reveal.mode=3;this.reveal=null;return;}
          const id=this.packs[this.cursor]!;
          const set=this.owner.resources.boosters.find((r)=>r.setId===id)??this.owner.resources.boosters[0];
          if(!set||set.pools.length!==6)throw new Error('Invalid booster pool record');
          const pull=set.pools.map((pool)=>pool.cards[(this.owner.random()|0)%16]!);
          for(const card of pull)grantCard(this.owner.collection,card,1);
          this.owner.collection.packs.set(id,(this.owner.collection.packs.get(id)??0)-1);this.owner.revision++;
          this.reveal=new CardShopReveal(pull,this.owner.sound);this.revealCursor=0;this.fold(0x720,1);this.state=12;
        }return;
      case 12: if(this.folded(0x720)&&this.reveal?.mode===1){this.fillDetail(true);this.state=13;}return;
      case 13: {
        const old=this.revealCursor;
        if(this.pressed(7,true))this.revealCursor=Math.max(0,this.revealCursor-1);else if(this.pressed(5,true))this.revealCursor=Math.min(5,this.revealCursor+1);
        if(old!==this.revealCursor){this.owner.sound(0x4001b);this.fillDetail(true);return;}
        if(this.pressed(14)){this.owner.sound(0x800450bd);this.returning=true;this.state=50;}return;
      }
      case 50:
        this.fold(0x710,0);this.hide([0x30,0x34]);this.state=this.returning?51:55;return;
      case 51: if(this.folded(0x710)){this.fold(0x720,0);this.fillDetail(false);this.reveal?.close();this.state=52;}return;
      case 52:
        if(this.folded(0x720)||!this.reveal){
          const previous=this.packs[this.cursor]!;
          this.packs=this.owner.heldPacks();this.state=0;
          const lo=this.page*8, hi=Math.min(lo+7,this.packs.length-1);
          if((this.owner.collection.packs.get(previous)??0)<=0 &&
             (this.owner.collection.packs.get(this.packs[this.cursor]??previous)??0)<=0) {
            if(--this.cursor<lo) {
              if(--this.page>=0) this.cursor=hi;
              else this.state=60;
            }
          }
        }return;
      case 55: if(this.folded(0x710)){this.fold(0x6f0,0);this.fillRows(false);this.fold(0x700,0);this.fillPack(false);this.owner.widgets.cursorShow(this.widget(0x20),0);this.state=56;}return;
      case 56: this.folded(0x6f0);if(this.folded(0x700))this.state=60;return;
      case 60: this.finished=true;return;
    }
  }
  private placePackCursor():void{
    const local=this.cursor%8;this.owner.widgets.cursorPlace(this.widget(0x20),29+(local%2)*131,57+Math.floor(local/2)*14);
  }
  retire():void{
    this.owner.widgets.retireTask({address:this.object,children:this.context} as never);
    this.owner.widgets.arena.free(this.context);this.owner.widgets.arena.free(this.object);
  }
  private paint():void{
    // Picture calls are read straight from F0x80083BA8/8008674C/800857B0.
    const d=this.owner.draw;const m=this.owner.mem;
    const sprite=(clip:number,x:number,y:number)=>d.drawSprite(0x063e0000,clip,x,y);
    const panel=(offset:number,clip:number,x:number,y:number,pivotX:number,pivotY:number)=>{
      const value=m.read32(this.object+offset+8);if(!value)return;
      d.initDrawContext();d.setLayer(0x1000,6);d.setOrigin(0x280,0);
      if(value!==0x1000){d.setScale(value,0x1000,0x1000);d.setPos(pivotX,pivotY);}sprite(clip,x,y);
    };
    if(this.kind==='buy') {
      this.paintDetail(0xac);
      panel(0xbc,0x2c,123,51,320,63);
      if(this.confirm) panel(0xcc,0x2d,175,80,320,100);
    }else{
      if(this.rows){d.initDrawContext();d.setLayer(0x1000,6);
        for(let i=0;i<8;i++){const id=this.packs[this.page*8+i];if(!id)continue;
          const x=40+(i%2)*131,y=57+Math.floor(i/2)*14;
          d.drawSprite(0x02860000,this.owner.resources.itemIcons.get(id)??0,x,y);sprite(49,x,y);
        }
        if(this.countPages()>=2){d.paletteShift(Math.floor(this.owner.frame/11)%4);
          if(this.page>0)sprite(72,30,116);
          if(this.page<this.countPages()-1)sprite(71,253,116);
          d.paletteShift(0);
        }
      }
      // The list and bottom prompt fold vertically, unlike the detail band.
      for(const [offset,clip,x,y,px,py] of [[0x6f0,43,0,50,160,92],[0x710,42,0,189,160,207]]) {
        const value=m.read32(this.object+offset!+8);if(!value)continue;
        d.initDrawContext();d.setLayer(0x1000,6);d.setOrigin(0x280,0);
        if(value!==0x1000){d.setScale(0x1000,value,0x1000);d.setPos(px!,py!);}sprite(clip!,x!,y!);
      }
      const packFold=m.read32(this.object+0x708);
      if(packFold){d.initDrawContext();d.setLayer(0x1000,6);
        if(packFold===0x1000)d.drawSprite(0x02860000,this.owner.resources.itemIcons.get(this.packs[this.cursor]!)??0,128,138);
        else{d.setScale(packFold,0x1000,0x1000);d.setPos(320,143);}
        sprite(46,121,131);
      }
      this.paintDetail(0x720);
    }
    if(this.reveal){
      const r=this.reveal;
      d.initDrawContext();d.setLayer(0x1000,6);d.setOrigin(0x280,0);
      const ids=r.mode===2&&r.state<3?r.previous:r.cards;
      // F0x80085678 stops the whole six-slot draw at the first slot whose id is
      // out of range (0x80085678 0x8008569C: `addiu v0, a0, -1; sltiu v0,
      // 0x13A; beqz v0 -> epilogue`), it does not skip that slot and continue.
      for(let i=0;i<r.visible;i++){ if(!this.gridCard(ids[i]??0,i)) break; }
      d.initDrawContext();d.setLayer(0x1000,5);
      if(r.mode===2){d.paletteShift(r.palette);for(let i=0;i<r.dealt;i++)sprite(6,35+i*42,68);}
      if(this.kind==='buy'&&this.state===2){d.paletteShift(m.read32(0x8008cb10+((Math.floor(this.owner.frame/4)%6)*4)));sprite(7,36+this.cursor*42,68);}
    }
  }
  private paintDetail(offset: number):void {
    const d=this.owner.draw,m=this.owner.mem;
    const value=m.read32(this.object+offset+8);if(!value)return;
    const id=this.cardId();const card=this.owner.resources.cards.find((r)=>r.id===id);if(!card)return;
    d.initDrawContext();d.setLayer(0x1000,6);d.setOrigin(0x280,0);
    if(value!==0x1000){d.setScale(value,0x1000,0x1000);d.setPos(320,135);}
    const sprite=(clip:number,x:number,y:number)=>d.drawSprite(0x063e0000,clip,x,y);
    // record colour byte selects the normal card's stat furniture. Program
    // cards use the first branch of the resident kind classifier.
    const colours=['white','blue','green','red','black','brown'];
    // F0x8001EBCC: resident record-kind classifier (not a boolean program flag).
    const category=card.kind==='digimon'?16:card.programCategory??0;
    const classifier=m.read32(0x8004dfcc+category*4);
    const program=classifier!==0;
    sprite(classifier===1?18:classifier===2?19:20+colours.indexOf(card.colour),259,126);sprite(13,252,124);
    if(value!==0x1000)d.setPos(320,135);sprite(10,130,124);
    if(value!==0x1000)d.setPos(320,175);sprite(16,259,164);sprite(13,252,162);
    if(value!==0x1000)d.setPos(320,165);
    const hint=program||[69,112,155,198,241].includes(id);
    sprite(hint?11:12,hint?74:199,146);
    if(this.kind==='buy') {
      if(value!==0x1000)d.setPos(320,200);sprite(41,214,191);
    } else if(this.state===13) {
      d.initDrawContext();d.setLayer(0x1000,4);
      d.paletteShift(m.read32(0x8008caf8+Math.floor(this.owner.frame/5)%6*4));sprite(7,36+this.revealCursor*42,68);
    }
  }
  private gridCard(id:number,index:number):boolean{
    if(id<1||id>=0x13b)return false;
    const card=this.owner.resources.cards.find((r)=>r.id===id);if(!card)return true;
    const d=this.owner.draw;const x=35+(index%6)*42,y=68+Math.floor(index/6)*54;
    const colours=['white','blue','green','red','black','brown'];
    d.calls.push({method:"cardSprite",args:[id,x+4,y+2,255]});
    if(card.kind!=='digimon')d.drawSprite(0x063e0000,29,x+4,y+33);
    else {
      const digits=[Math.floor((card.ap??0)/10)||null,(card.ap??0)%10, -2, Math.floor((card.hp??0)/10)||null,(card.hp??0)%10];
      for(let j=0;j<5;j++)if(digits[j]!==null)d.drawSprite(0x063e0000,digits[j]===-2?28:30+digits[j]!,x+4+(j<3?j*7:19+(j-3)*7),y+33);
    }
    d.drawSprite(0x063e0000,colours.indexOf(card.colour),x,y);
    return true;
  }
}
