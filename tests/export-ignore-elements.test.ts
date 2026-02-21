/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { createExportIgnoreElements } from '../src/shared/export/ignoreElements';

// Simple DOM mock for bun test since it lacks a native DOM environment by default
if (typeof document === 'undefined') {
  (globalThis as any).document = {
    createElement: (tagName: string) => ({
      tagName: tagName.toUpperCase(),
      classList: {
        contains: (className: string) => false,
        add: function (className: string) {
          const self = this as any;
          self._classes = self._classes || new Set();
          self._classes.add(className);
          self.contains = (c: string) => self._classes.has(c);
        }
      }
    })
  };
}

describe('export ignoreElements', () => {
  it('should ignore elements marked with no-export class', () => {
    const el = document.createElement('div');
    el.classList.add('no-export');
    const ignore = createExportIgnoreElements();
    expect(ignore(el)).toBe(true);
  });

  it('should ignore common interactive tag names by default', () => {
    const ignore = createExportIgnoreElements();
    expect(ignore(document.createElement('button'))).toBe(true);
    expect(ignore(document.createElement('input'))).toBe(true);
    expect(ignore(document.createElement('select'))).toBe(true);
    expect(ignore(document.createElement('textarea'))).toBe(true);
  });

  it('should not ignore normal content elements by default', () => {
    const ignore = createExportIgnoreElements();
    expect(ignore(document.createElement('div'))).toBe(false);
    expect(ignore(document.createElement('h1'))).toBe(false);
    expect(ignore(document.createElement('span'))).toBe(false);
  });

  it('should allow extending ignored tag names and deduplicate input', () => {
    const ignore = createExportIgnoreElements({
      ignoreTagNames: ['h1', 'H1', '  h1  '],
    });
    expect(ignore(document.createElement('h1'))).toBe(true);
  });
});

