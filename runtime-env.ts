const getNodeProcess = (): { env?: { NODE_ENV?: string } } | undefined => {
  return (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
};

export const isTestEnvironment = (): boolean => {
  return getNodeProcess()?.env?.NODE_ENV === 'test';
};
