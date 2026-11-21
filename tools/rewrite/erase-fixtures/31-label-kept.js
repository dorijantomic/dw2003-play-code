function scan(xs) {
  loop: for (const x of xs) {
    if (x) continue loop;
  }
}
