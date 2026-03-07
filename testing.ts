const clearQueueFns = new Set<() => Promise<void>>();

export const registerQueueClearFn = (clearQueue: () => Promise<void>): (() => void) => {
  clearQueueFns.add(clearQueue);
  return () => {
    clearQueueFns.delete(clearQueue);
  };
};

export const clearQueueForTests = async () => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('This function is only available in test environments');
  }

  const clearers = Array.from(clearQueueFns);
  if (!clearers.length) {
    return;
  }

  // Let React commit any queued state updates, then drain a few passes to catch
  // newly-mounted translated content in the same test tick.
  for (let pass = 0; pass < 3; pass += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await Promise.all(clearers.map((clearQueue) => clearQueue()));
  }
};
