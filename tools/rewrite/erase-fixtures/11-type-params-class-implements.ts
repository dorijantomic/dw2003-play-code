class Bag<T> implements Iterable<T> {
  items: T[] = [];
  get(i: number): T {
    return this.items[i];
  }
}
