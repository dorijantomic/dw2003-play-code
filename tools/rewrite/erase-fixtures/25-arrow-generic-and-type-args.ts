const list = <T,>(items: T[], fn: (x: T) => T): T[] => items.map<T>(fn);
