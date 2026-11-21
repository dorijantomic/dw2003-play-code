function scan(xs: string[]) {
  loop: for (const x of xs) {
    if (x) continue loop;
  }
}
