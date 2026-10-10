export interface ContentItem { id: string; $type: string; [k: string]: unknown; }
export class ContentDB {
  private byId = new Map<string, ContentItem>();
  addLayer(_name: string, items: ContentItem[]): void { for (const it of items) this.byId.set(it.id, it); }
  get<T extends ContentItem = ContentItem>(id: string): T | undefined { return this.byId.get(id) as T | undefined; }
  require<T extends ContentItem = ContentItem>(id: string): T {
    const it = this.byId.get(id); if (!it) throw new Error(`content id not found: ${id}`); return it as T;
  }
  all(type: string): ContentItem[] { return [...this.byId.values()].filter(i => i.$type === type); }
  validateRefs(refOf: (item: ContentItem) => string[]): void {
    for (const it of this.byId.values()) for (const r of refOf(it))
      if (!this.byId.has(r)) throw new Error(`dangling ref ${r} from ${it.id}`);
  }
}
