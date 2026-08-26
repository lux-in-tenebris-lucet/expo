'use client';

import * as React from 'react';

import { unstable_navigationEvents } from '../navigationEvents';
import { useClientLayoutEffect } from '../react-navigation/core/useClientLayoutEffect';
import { GlobalRemovalEventEmitterRegistryContext } from './removalPrevention';
import type { NavigationTreeReport } from './useNavigationTreeReducer';

export function useNavigationTreeReportEvents(report: NavigationTreeReport | undefined) {
  const emitterRegistry = React.use(GlobalRemovalEventEmitterRegistryContext)!;
  const consumedReport = React.useRef<{ version: number; eventCount: number } | undefined>(
    undefined
  );

  useClientLayoutEffect(() => {
    if (report === undefined) {
      return;
    }

    const eventIndex =
      consumedReport.current?.version === report.version ? consumedReport.current.eventCount : 0;
    consumedReport.current = { version: report.version, eventCount: report.events.length };

    for (const event of report.events.slice(eventIndex)) {
      switch (event.type) {
        case 'prevented-routes':
          for (const routeKey of event.routeKeys) {
            emitterRegistry.emitRemovalEvent(routeKey, 'removePrevented', event.action);
          }
          break;
        case 'removed-routes':
          for (const routeKey of event.routeKeys) {
            emitterRegistry.emitRemovalEvent(routeKey, 'removed', event.action);
          }
          break;
        case 'action-dispatched':
          // TODO(@ubax): emit an event when the action is enqueued.
          unstable_navigationEvents.emit('actionDispatched', {
            actionType: event.action.type,
            payload: event.action.payload,
            state: event.state,
          });
          break;
      }
    }
  }, [emitterRegistry, report]);
}
