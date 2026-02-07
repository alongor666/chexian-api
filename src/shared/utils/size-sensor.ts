type ResizeListener = (element: HTMLElement) => void;

type SensorEntry = {
  callbacks: Set<ResizeListener>;
  observer?: ResizeObserver;
};

const sensors = new Map<HTMLElement, SensorEntry>();

const getEntry = (element: HTMLElement): SensorEntry => {
  const existing = sensors.get(element);
  if (existing) {
    return existing;
  }

  const entry: SensorEntry = {
    callbacks: new Set<ResizeListener>(),
  };

  if (typeof ResizeObserver === 'function') {
    entry.observer = new ResizeObserver(() => {
      entry.callbacks.forEach((callback) => callback(element));
    });
    entry.observer.observe?.(element);
  }

  sensors.set(element, entry);
  return entry;
};

const unbind = (element: HTMLElement, callback: ResizeListener) => {
  const entry = sensors.get(element);
  if (!entry) {
    return;
  }

  entry.callbacks.delete(callback);
  if (entry.callbacks.size === 0) {
    clear(element);
  }
};

export const bind = (element: HTMLElement, callback: ResizeListener) => {
  const entry = getEntry(element);
  entry.callbacks.add(callback);
  callback(element);
  return () => unbind(element, callback);
};

export const clear = (element: HTMLElement) => {
  const entry = sensors.get(element);
  if (!entry) {
    return;
  }

  if (entry.observer?.disconnect) {
    entry.observer.disconnect();
  }

  sensors.delete(element);
};

export const ver = '1.0.2-safe';
