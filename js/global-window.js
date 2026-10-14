// Only one computation runs at a time; slider changes replace the queued request.
export function createGlobalWindow(phantom, onUpdate, makeWorker = () => new Worker(new URL('./global-window-worker.js', import.meta.url), { type: 'module' })) {
  const cache = new Map();
  let worker;
  let running = false;
  let wanted;
  let lastMaximum;
  let failed = false;
  function dispatch() {
    if (running || !wanted || cache.has(wanted.key) || failed) return;
    running = true;
    worker.postMessage(wanted);
  }
  return {
    getMaximum(sequence, parameters) {
      if (failed) return undefined;
      if (!worker) {
        try { worker = makeWorker(); }
        catch { failed = true; return undefined; }
        worker.onmessage = ({ data }) => {
          running = false;
          cache.set(data.key, data.maximum);
          if (cache.size > 64) cache.delete(cache.keys().next().value);
          if (data.key === wanted.key) {
            lastMaximum = data.maximum;
            onUpdate();
          }
          dispatch();
        };
        worker.onerror = () => { failed = true; running = false; worker.terminate(); onUpdate(); };
        // Clone once; the original maps remain available to image and ROI rendering.
        worker.postMessage({ volume: phantom.getVolume() });
      }
      const key = JSON.stringify([sequence, parameters]);
      wanted = { key, sequence, parameters: { ...parameters } };
      if (cache.has(key)) {
        lastMaximum = cache.get(key);
        return lastMaximum;
      }
      dispatch();
      return lastMaximum;
    },
    get pending() { return !failed && wanted && !cache.has(wanted.key); },
    get failed() { return failed; },
    dispose() { worker?.terminate(); },
  };
}
