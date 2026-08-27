'use client';

import * as React from 'react';

import type { RouteNode } from '../Route';
import type { ExpoLinkingOptions } from '../getLinkingConfig';
import { warnIfScreenParam } from '../navigationParams';
import { deepFreeze } from '../react-navigation/core/deepFreeze';
import { useClientLayoutEffect } from '../react-navigation/core/useClientLayoutEffect';
import type { InitialState, NavigationAction, NavigationState } from '../react-navigation/routers';
import { getChainFromStateKey } from '../react-navigation/routers/stateKeys';
import useLatestCallback from '../utils/useLatestCallback';
import {
  completeNavigationState,
  createSeededNavigationState,
} from './createSeededNavigationState';
import { getNavigateAction } from './getNavigationAction';
import { indexNavigationTree, reduceNavigationTree, resolveOrigin } from './reduceNavigationTree';
import type { RouterRegistry } from './routerRegistry';
import type { RoutingIntent } from './routingQueue';
import { resetNavigatorState } from './stateUtils';
import type { StoreRedirects } from './types';

type ReducerConfig = {
  registry: RouterRegistry;
  routesWithRemovalPrevented: readonly string[];
  version: number;
  routeNode?: RouteNode;
  linking?: ExpoLinkingOptions;
  redirects?: StoreRedirects[];
};

type TreeOperation =
  | RoutingIntent
  | {
      type: 'NAVIGATOR_UNMOUNTED';
      stateKey: string;
      routeNode: RouteNode;
    }
  | {
      type: 'NAVIGATOR_CHANGED';
      stateKey: string;
      routerType: string | undefined;
    };

type Options = {
  initialState: InitialState | undefined;
  routeNode?: RouteNode;
  registry: RouterRegistry;
  routesWithRemovalPrevented?: readonly string[];
  linking?: ExpoLinkingOptions;
  redirects?: StoreRedirects[];
};

export type NavigationTreeReport = {
  version: number;
  events: NavigationTreeReportEvent[];
};

export type NavigationTreeReportEvent =
  | { type: 'removed-routes'; routeKeys: readonly string[]; action: NavigationAction }
  | { type: 'prevented-routes'; routeKeys: readonly string[]; action: NavigationAction }
  | { type: 'action-dispatched'; action: NavigationAction; state: NavigationState };

type NavigationTreeResult = {
  state: NavigationState;
  report: NavigationTreeReport | undefined;
};

const warnedActions = new WeakSet<NavigationAction>();
const ACTIONS_WITHOUT_REMOVAL_PREVENTION = new Set(['ROUTE_NAMES_CHANGED']);

function warnIfStaleState(state: NavigationState) {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  let focusedState: NavigationState | undefined = state;
  while (focusedState) {
    if (focusedState.stale) {
      console.error('Detected stale state. This is likely a bug in Expo Router.');
      return;
    }
    focusedState = focusedState.routes[focusedState.index]?.state as NavigationState | undefined;
  }
}

function warnUnhandledAction(action: NavigationAction) {
  if (process.env.NODE_ENV === 'production' || warnedActions.has(action)) {
    return;
  }
  warnedActions.add(action);

  const payload =
    typeof action.payload === 'object' && action.payload !== null ? action.payload : undefined;
  let message = `The action '${action.type}'${
    payload ? ` with payload ${JSON.stringify(payload)}` : ''
  } was not handled by any navigator.`;

  switch (action.type) {
    case 'NAVIGATE':
    case 'PUSH':
    case 'REPLACE':
    case 'JUMP_TO':
      if (payload && 'name' in payload && typeof payload.name === 'string') {
        message += `\n\nDo you have a route named '${payload.name}'?`;
      } else {
        message += '\n\nYou need to pass the name of the screen to navigate to. This may be a bug.';
      }
      break;
    case 'GO_BACK':
    case 'POP':
    case 'POP_TO_TOP':
      message += '\n\nIs there any screen to go back to?';
      break;
    case 'OPEN_DRAWER':
    case 'CLOSE_DRAWER':
    case 'TOGGLE_DRAWER':
      message += '\n\nIs your screen inside a Drawer navigator?';
      break;
  }

  console.error(
    `${message}\n\nThis is a development-only warning and won't be shown in production.`
  );
}

function navigationTreeReducer(
  result: NavigationTreeResult,
  { operation, config }: { operation: TreeOperation; config: ReducerConfig }
): NavigationTreeResult {
  const current =
    result.report !== undefined && result.report.version !== config.version
      ? { state: result.state, report: undefined }
      : result;
  const state = current.state;

  switch (operation.type) {
    case 'NAVIGATE_TO_HREF': {
      const { href, options } = operation.payload;
      let resolution: ReturnType<typeof getNavigateAction>;
      try {
        resolution = getNavigateAction(
          href,
          options,
          config,
          options.event,
          options.withAnchor,
          options.dangerouslySingular,
          !!options.__internal__PreviewKey,
          state
        );
      } catch (error) {
        const message =
          typeof error === 'object' && error != null && 'message' in error ? error.message : error;
        // TODO(@ubax): move console side effects out of the reducer.
        console.warn(
          `An error occurred when trying to handle navigation action ${JSON.stringify(operation)}: ${message}`
        );
        return current;
      }
      if (resolution.status === 'invalid') {
        const invalidHref = operation.payload.originalHref ?? resolution.href;
        // TODO(@ubax): move console side effects out of the reducer.
        console.warn(
          `Could not generate a valid navigation state for the given path: ${invalidHref}`
        );
        return current;
      }
      return navigationTreeReducer(current, {
        operation: { type: 'ACTION', payload: { action: resolution.action } },
        config,
      });
    }
    case 'ACTION': {
      const tree = indexNavigationTree(state);
      const origin = resolveOrigin(
        tree.rootNode,
        tree.nodes,
        config.registry,
        operation.payload.originKey
      );
      if (!origin) {
        // TODO(@ubax): move console side effects out of the reducer and restore `onUnhandledAction`.
        // https://linear.app/expo/issue/ENG-26123
        warnUnhandledAction(operation.payload.action);
        return current;
      }

      const result = reduceNavigationTree(operation.payload.action, config.registry, {
        origin,
        tree,
      });
      if (!result.handled) {
        // TODO(@ubax): move console side effects out of the reducer and restore `onUnhandledAction`.
        // https://linear.app/expo/issue/ENG-26123
        warnUnhandledAction(operation.payload.action);
        return current;
      }
      const nextState = config.routeNode
        ? completeNavigationState(result.nextState, config.routeNode)
        : result.nextState;
      if (nextState === state) {
        return current;
      }

      const removedRoutes = getRemovedRouteKeys(state, nextState);
      const preventedRouteKeys = new Set(config.routesWithRemovalPrevented);
      const preventedRoutes = ACTIONS_WITHOUT_REMOVAL_PREVENTION.has(operation.payload.action.type)
        ? []
        : removedRoutes.filter((routeKey) => preventedRouteKeys.has(routeKey));
      const committedState = preventedRoutes.length > 0 ? state : deepFreeze(nextState);
      // TODO(@ubax): add dev-only diagnostics to events for dev-tools.
      const events: NavigationTreeReportEvent[] =
        preventedRoutes.length > 0
          ? [
              {
                type: 'prevented-routes',
                routeKeys: preventedRoutes,
                action: operation.payload.action,
              },
            ]
          : [
              ...(removedRoutes.length > 0
                ? ([
                    {
                      type: 'removed-routes',
                      routeKeys: removedRoutes,
                      action: operation.payload.action,
                    },
                  ] satisfies NavigationTreeReportEvent[])
                : []),
              {
                type: 'action-dispatched',
                action: operation.payload.action,
                state: committedState,
              },
            ];
      const report: NavigationTreeReport = {
        version: config.version,
        events: current.report ? [...current.report.events, ...events] : events,
      };

      return { state: committedState, report };
    }
    case 'NAVIGATOR_UNMOUNTED': {
      if (!findStateByKey(state, operation.stateKey)) {
        return current;
      }
      const replacement = createSeededNavigationState(
        undefined,
        operation.routeNode,
        getChainFromStateKey(operation.stateKey)
      );
      const nextState = replaceNavigationState(state, operation.stateKey, replacement);
      const completeState = config.routeNode
        ? completeNavigationState(nextState, config.routeNode)
        : nextState;
      return { state: deepFreeze(completeState), report: current.report };
    }
    case 'NAVIGATOR_CHANGED': {
      const navigatorState = findStateByKey(state, operation.stateKey);
      if (!navigatorState) {
        return current;
      }
      const replacement = resetNavigatorState(navigatorState, operation.routerType);
      const nextState = replaceNavigationState(state, operation.stateKey, replacement);
      const completeState = config.routeNode
        ? completeNavigationState(nextState, config.routeNode)
        : nextState;
      return { state: deepFreeze(completeState), report: current.report };
    }
  }
}

export function useNavigationTreeReducer({
  initialState,
  routeNode,
  registry,
  routesWithRemovalPrevented = [],
  linking,
  redirects,
}: Options) {
  const [version, setVersion] = React.useState(0);
  const [result, reactDispatch] = React.useReducer(
    navigationTreeReducer,
    initialState,
    (value): NavigationTreeResult => {
      validateInitialState(value);
      if (value == null) {
        throw new Error(
          'The navigation container is missing its initial state. Expo Router always seeds a complete initial state before rendering the navigation container, so this is most likely a bug in expo-router. Please report it at https://github.com/expo/expo/issues.'
        );
      }
      // TODO(@ubax): check if deepFreeze is needed here.
      return { state: deepFreeze(value), report: undefined };
    }
  );
  const config = React.useMemo(
    () => ({ registry, routesWithRemovalPrevented, version, routeNode, linking, redirects }),
    [registry, routesWithRemovalPrevented, version, routeNode, linking, redirects]
  );
  const previousRegistryRef = React.useRef(registry);

  const processAction = React.useCallback(
    (operation: TreeOperation) => reactDispatch({ operation, config }),
    [config]
  );
  const process = React.useEffectEvent(processAction);
  const processIntent = React.useCallback(
    (intent: RoutingIntent) => processAction(intent),
    [processAction]
  );
  const handleAction = useLatestCallback((action: NavigationAction, originKey?: string) => {
    const payload =
      typeof action.payload === 'object' && action.payload !== null ? action.payload : undefined;
    const params =
      payload &&
      'params' in payload &&
      typeof payload.params === 'object' &&
      payload.params !== null
        ? payload.params
        : undefined;
    warnIfScreenParam(params);
    processAction({ type: 'ACTION', payload: { action, originKey } });
  });
  const resetNavigator = useLatestCallback((stateKey: string, routerType: string | undefined) => {
    processAction({ type: 'NAVIGATOR_CHANGED', stateKey, routerType });
  });

  React.useInsertionEffect(() => {
    warnIfStaleState(result.state);
  }, [result.state]);

  React.useEffect(() => setVersion((value) => value + 1), [result]);

  useClientLayoutEffect(() => {
    const previousRegistry = previousRegistryRef.current;
    previousRegistryRef.current = registry;
    for (const [stateKey, entry] of previousRegistry) {
      if (!registry.has(stateKey) && entry.routeNode) {
        process({ type: 'NAVIGATOR_UNMOUNTED', stateKey, routeNode: entry.routeNode });
      }
    }
  }, [registry]);

  return {
    state: result.state,
    report: result.report?.version === version ? result.report : undefined,
    resetNavigator,
    handleAction,
    processIntent,
  };
}

function getRemovedRouteKeys(current: NavigationState, next: NavigationState): string[] {
  const nextRouteKeys = new Set<string>();
  visitRoutes(next, true, (routeKey) => nextRouteKeys.add(routeKey));

  const removedRoutes: string[] = [];
  visitRoutes(current, true, (routeKey) => {
    if (!nextRouteKeys.has(routeKey)) {
      removedRoutes.push(routeKey);
    }
  });
  return removedRoutes;
}

function visitRoutes(
  state: NavigationState,
  excludePreloaded: boolean,
  visit: (routeKey: string) => void
) {
  // TODO(@ubax): find a universal way to exclude preloaded routes.
  const routes =
    excludePreloaded && state.type === 'stack'
      ? state.routes.slice(0, state.index + 1)
      : state.routes;
  for (let index = routes.length - 1; index >= 0; index--) {
    const route = routes[index]!;
    if (route.state?.stale === false) {
      visitRoutes(route.state, excludePreloaded, visit);
    }
    visit(route.key);
  }
}

function validateInitialState(
  state: InitialState | undefined
): asserts state is NavigationState | undefined {
  if (state === undefined) {
    return;
  }

  const index = 'index' in state ? state.index : undefined;
  const routeNames = 'routeNames' in state ? state.routeNames : undefined;
  const routeKeySeq = 'routeKeySeq' in state ? state.routeKeySeq : undefined;
  if (
    !('stale' in state) ||
    state.stale !== false ||
    !('key' in state) ||
    typeof state.key !== 'string' ||
    !Number.isInteger(index) ||
    !Number.isInteger(routeKeySeq) ||
    routeKeySeq! < 0 ||
    !Array.isArray(routeNames) ||
    state.routes.some(
      (route) =>
        !('key' in route) || typeof route.key !== 'string' || !routeNames?.includes(route.name)
    ) ||
    (state.routes.length === 0 ? index !== -1 : index! < 0 || index! >= state.routes.length)
  ) {
    throw new Error(
      'The navigation container received an incomplete initial state. Expo Router always seeds a complete initial state with valid `key`, `routeKeySeq`, `index`, `routeNames`, route keys, and `stale: false` at every level, so this is most likely a bug in expo-router. Please report it at https://github.com/expo/expo/issues.'
    );
  }

  for (const route of state.routes) {
    validateInitialState(route.state);
  }
}

export function findStateByKey(root: NavigationState, key: string): NavigationState | undefined {
  if (root.key === key) {
    return root;
  }
  for (const route of root.routes) {
    if (route.state?.stale === false) {
      const state = findStateByKey(route.state, key);
      if (state) {
        return state;
      }
    }
  }
  return undefined;
}

export function replaceNavigationState(
  state: NavigationState,
  stateKey: string,
  replacement: NavigationState
): NavigationState {
  if (state.key === stateKey) {
    return replacement;
  }

  let changed = false;
  const routes = state.routes.map((route) => {
    if (route.state?.stale !== false) {
      return route;
    }
    const nextState = replaceNavigationState(route.state, stateKey, replacement);
    if (nextState === route.state) {
      return route;
    }
    changed = true;
    return { ...route, state: nextState };
  });
  return changed ? { ...state, routes } : state;
}
