class Base {
  paint(): number {
    return 0;
  }
}

class Widget extends Base {
  protected override paint(): number {
    return 1;
  }
}
