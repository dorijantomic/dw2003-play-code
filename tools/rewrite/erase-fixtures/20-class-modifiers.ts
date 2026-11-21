class Svc {
  private readonly name: string;
  constructor(name: string) {
    this.name = name;
  }
  protected read(): string {
    return this.name;
  }
}
