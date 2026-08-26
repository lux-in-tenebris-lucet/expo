import { act, renderHook } from '@testing-library/react-native';
import * as React from 'react';
import { use } from 'react';

import {
  GlobalRoutesWithRemovalPreventedContext,
  isRouteRemovalPrevented,
  PreventRemovalProvider,
  RemovalPreventionProvider,
  ScreenRemovalPreventionSetterContext,
} from '../removalPrevention';

function wrapper({ children }: React.PropsWithChildren) {
  return (
    <RemovalPreventionProvider>
      <PreventRemovalProvider routeKey="parent">
        <PreventRemovalProvider routeKey="child">{children}</PreventRemovalProvider>
      </PreventRemovalProvider>
    </RemovalPreventionProvider>
  );
}

test('aggregates callers and publishes the prevented route', () => {
  const result = renderHook(
    () => ({
      routes: use(GlobalRoutesWithRemovalPreventedContext),
      setPrevented: use(ScreenRemovalPreventionSetterContext)!,
    }),
    { wrapper }
  );

  act(() => result.result.current.setPrevented('first', true));

  expect(result.result.current.routes).toEqual(['child']);

  act(() => result.result.current.setPrevented('second', true));
  act(() => result.result.current.setPrevented('first', false));

  expect(result.result.current.routes).toEqual(['child']);

  act(() => result.result.current.setPrevented('second', false));

  expect(result.result.current.routes).toEqual([]);
});

test('detects prevention in an active descendant but not a preloaded route', () => {
  const route = {
    key: 'parent',
    name: 'parent',
    state: {
      stale: false as const,
      type: 'stack',
      key: 'stack',
      routeKeySeq: 0,
      index: 0,
      routeNames: ['active', 'preloaded'],
      routes: [
        { key: 'active', name: 'active' },
        { key: 'preloaded', name: 'preloaded' },
      ],
    },
  };

  expect(isRouteRemovalPrevented(route, ['active'])).toBe(true);
  expect(isRouteRemovalPrevented(route, ['preloaded'])).toBe(false);
  expect(isRouteRemovalPrevented(route, ['parent'])).toBe(true);
});
