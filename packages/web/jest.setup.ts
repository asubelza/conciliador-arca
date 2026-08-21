import '@testing-library/jest-dom';

/**
 * Known, extensively-documented false positive: React 18 + jsdom + user-event
 * emits "not wrapped in act(...)" warnings for state updates that happen
 * *during* an already-awaited `userEvent.type/click/upload` call (e.g. the
 * per-keystroke onChange updates in UploadForm's tenant-id input) — the
 * update genuinely happens inside the interaction React/RTL themselves
 * dispatch, but the console.error fires on whichever later synchronous call
 * happens to run when React's internal scheduler flushes the warning check,
 * which is why the printed stack trace often points at an unrelated later
 * line. This is not a real bug: verified in this repo by isolating single
 * tests, wrapping every `userEvent` call in `act()`, using `userEvent.setup()`
 * (the current recommended API) with `delay: null`, and flushing a macrotask
 * tick after each interaction — the warning persists across all of those
 * regardless, while every assertion still passes. See e.g.
 * https://github.com/testing-library/user-event/issues/1075 and
 * https://github.com/testing-library/react-testing-library/issues/1051 for
 * the same conclusion from the library maintainers. Filtering this exact
 * message (and only this one) keeps real act warnings from other causes
 * visible while removing noise that would otherwise obscure them.
 */
const ACT_WARNING_PATTERN = /Warning: An update to .* inside a test was not wrapped in act\(/;

// Deliberately a plain reassignment, NOT jest.spyOn(...): test files in this
// package call `jest.restoreAllMocks()` in their own `afterEach`, which would
// undo a spy-based override after each file's first test and let the noise
// back in for every test after it.
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && ACT_WARNING_PATTERN.test(args[0])) {
    return;
  }
  originalConsoleError(...args);
};
