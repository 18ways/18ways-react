import '@testing-library/jest-dom';
import { TextEncoder } from 'util';
import { afterEach } from 'vitest';
import { resetTestRuntimeState } from './testing';

global.TextEncoder = TextEncoder;

afterEach(() => {
  resetTestRuntimeState();
});
