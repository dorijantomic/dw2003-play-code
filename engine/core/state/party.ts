import type { PartyReader } from "../types.ts";

export class Party implements PartyReader {
  private members: number[] = [];
  private leadId: number | undefined;

  contains(id: number): boolean {
    return this.members.includes(id);
  }

  size(): number {
    return this.members.length;
  }

  add(id: number): void {
    if (!this.members.includes(id)) this.members.push(id);
    if (this.leadId === undefined) this.leadId = id;
  }

  remove(id: number): void {
    this.members = this.members.filter(m => m !== id);
    if (this.leadId === id) this.leadId = this.members[0];
  }

  setLead(id: number): void {
    if (this.members.includes(id)) this.leadId = id;
  }

  lead(): number | undefined {
    return this.leadId;
  }

  toJSON(): { members: number[]; lead?: number } {
    return this.leadId === undefined
      ? { members: [...this.members] }
      : { members: [...this.members], lead: this.leadId };
  }

  load(o: { members: number[]; lead?: number }): void {
    this.members = [...o.members];
    this.leadId = o.lead;
  }
}
