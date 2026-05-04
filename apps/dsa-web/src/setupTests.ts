import '@testing-library/jest-dom';

function installStorageMock(name: 'localStorage' | 'sessionStorage') {
  const current = globalThis[name] as Partial<Storage> | undefined;
  if (
    typeof current?.getItem === 'function' &&
    typeof current?.setItem === 'function' &&
    typeof current?.removeItem === 'function' &&
    typeof current?.clear === 'function'
  ) {
    return;
  }

  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: {
      get length() {
        return storage.size;
      },
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, String(value)),
    },
  });
}

installStorageMock('localStorage');
installStorageMock('sessionStorage');

class IntersectionObserverMock implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds = [0];

  disconnect() {}

  observe() {}

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve() {}
}

Object.defineProperty(globalThis, 'IntersectionObserver', {
  writable: true,
  value: IntersectionObserverMock,
});
