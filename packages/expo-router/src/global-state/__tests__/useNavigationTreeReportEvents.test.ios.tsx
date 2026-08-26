import { renderHook } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { unstable_navigationEvents } from '../../navigationEvents';
import type { NavigationState } from '../../react-navigation/routers';
import { RemovalPreventionProvider } from '../removalPrevention';
import type { NavigationTreeReport } from '../useNavigationTreeReducer';
import { useNavigationTreeReportEvents } from '../useNavigationTreeReportEvents';

const state: NavigationState = {
  stale: false,
  key: 'root',
  routeKeySeq: 0,
  index: 0,
  routeNames: ['index'],
  routes: [{ key: 'index', name: 'index' }],
};

function wrapper({ children }: PropsWithChildren) {
  return <RemovalPreventionProvider>{children}</RemovalPreventionProvider>;
}

test('emits only events appended to the current report', () => {
  const actions: string[] = [];
  const unsubscribe = unstable_navigationEvents.addListener('actionDispatched', (event) =>
    actions.push(event.actionType)
  );
  const firstEvent = { type: 'action-dispatched' as const, action: { type: 'FIRST' }, state };
  const report: NavigationTreeReport = { version: 1, events: [firstEvent] };
  const result = renderHook(
    ({ report }: { report: NavigationTreeReport }) => useNavigationTreeReportEvents(report),
    { wrapper, initialProps: { report } }
  );

  result.rerender({
    report: {
      version: 1,
      events: [firstEvent, { type: 'action-dispatched', action: { type: 'SECOND' }, state }],
    },
  });

  expect(actions).toEqual(['FIRST', 'SECOND']);
  unsubscribe();
});
