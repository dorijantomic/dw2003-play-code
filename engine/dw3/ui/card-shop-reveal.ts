// stcrdshp F0x80085730 / F0x80085788 / F0x80085CD8 / F0x80085DA0.
// The reveal is a child of BOTH the stock screen and booster list. Its installed
// close method starts lifecycle 1 again; that lifecycle removes the cards.
export class CardShopReveal {
  mode = 0;
  state = 0;
  resume = 0;
  stamp = 0;
  visible = 0;
  dealt = 0;
  palette = 0;
  previous = [0, 0, 0, 0, 0, 0];
  cards: number[];
  private readonly sound: (id: number) => void;
  constructor(cards: readonly number[], sound: (id: number) => void) {
    this.sound = sound;
    this.cards = Array.from({ length: 6 }, (_, i) => cards[i] ?? 0);
  }
  begin(cards: readonly number[]): void {
    this.previous = this.cards.slice();
    this.cards = Array.from({ length: 6 }, (_, i) => cards[i] ?? 0);
    this.dealt = 0;
    this.palette = 0;
    this.mode = 2;
    this.state = 0;
  }
  close(): void { this.mode = 1; this.state = 1; }
  tick(frame: number): void {
    switch (this.mode) {
      case 0: this.mode = 1; this.begin(this.cards); return;
      case 1:
        if (this.state === 1) {
          if (this.visible !== 0) {
            this.visible--; this.state = 2; this.stamp = frame;
          } else this.mode = 3;
        } else if (this.state === 2 && frame - this.stamp >= 2) this.state = 1;
        return;
      case 2:
        switch (this.state) {
          case 1: if (frame - this.stamp >= 2) this.state = this.resume; return;
          case 2:
            this.visible = 6; this.stamp = frame; this.state = 3;
            this.sound(0x4001c); return;
          case 3:
            if (frame - this.stamp >= 2) {
              this.stamp = frame;
              if (++this.palette >= 11) this.mode = 1;
            }
            return;
          default:
            this.dealt++;
            if (this.dealt < 6) { this.resume = this.state; this.state = 1; this.stamp = frame; }
            else { this.dealt = 6; this.state = 2; }
            this.sound(0x800460bd); return;
        }
      case 3: return;
      default: throw new Error('Unknown card reveal lifecycle');
    }
  }
}
