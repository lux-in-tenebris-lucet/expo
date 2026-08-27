'use client';
import * as React from 'react';
import { use } from 'react';

import type { NavigationState, ParamListBase, PartialState } from '../routers';
import { NavigationBuilderContext } from './NavigationBuilderContext';
import { NavigationStateContext } from './NavigationStateContext';
import { RootNavigationStateContext } from './RootNavigationStateContext';
import type { NavigationProp } from './types';

type Options = {
  key?: string;
  navigation?: NavigationProp<ParamListBase>;
  options?: object | undefined;
};

function isRouteFocused(
  state: NavigationState | PartialState<NavigationState>,
  key: string
): boolean {
  let currentState: NavigationState | PartialState<NavigationState> | undefined = state;

  while (currentState) {
    const route:
      | {
          key?: string;
          state?: NavigationState | PartialState<NavigationState>;
        }
      | undefined = currentState.routes[currentState.index ?? 0];

    if (!route) {
      return false;
    }

    if (route.key === key) {
      return true;
    }

    currentState = route.state;
  }

  return false;
}

export function useOptionsGetters({ key, options, navigation }: Options) {
  const optionsRef = React.useRef<object | undefined>(options);
  const optionsGettersFromChildRef = React.useRef<Record<string, () => object | undefined | null>>(
    {}
  );

  const { onOptionsChange } = use(NavigationBuilderContext);
  const { addOptionsGetter: parentAddOptionsGetter } = use(NavigationStateContext);
  const rootState = use(RootNavigationStateContext);
  const isFocused =
    key !== undefined && rootState !== undefined
      ? isRouteFocused(rootState, key)
      : (navigation?.isFocused() ?? true);

  const optionsChangeListener = React.useCallback(() => {
    const hasChildren = Object.keys(optionsGettersFromChildRef.current).length;

    if (isFocused && !hasChildren) {
      onOptionsChange(optionsRef.current ?? {}, key);
    }
  }, [isFocused, key, onOptionsChange]);

  React.useEffect(() => {
    optionsRef.current = options;
    optionsChangeListener();
  }, [options, optionsChangeListener]);

  const getOptionsFromListener = React.useCallback(() => {
    for (const key in optionsGettersFromChildRef.current) {
      if (key in optionsGettersFromChildRef.current) {
        const result = optionsGettersFromChildRef.current[key]?.();

        // null means unfocused route
        if (result !== null) {
          return result;
        }
      }
    }

    return null;
  }, []);

  const getCurrentOptions = React.useCallback(() => {
    if (!(navigation?.isFocused() ?? true)) {
      return null;
    }

    const optionsFromListener = getOptionsFromListener();

    if (optionsFromListener !== null) {
      return optionsFromListener;
    }

    return optionsRef.current;
  }, [navigation, getOptionsFromListener]);

  React.useEffect(() => {
    return parentAddOptionsGetter?.(key!, getCurrentOptions);
  }, [getCurrentOptions, parentAddOptionsGetter, key]);

  const addOptionsGetter = React.useCallback(
    (key: string, getter: () => object | undefined | null) => {
      optionsGettersFromChildRef.current[key] = getter;
      optionsChangeListener();

      return () => {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete optionsGettersFromChildRef.current[key];
        optionsChangeListener();
      };
    },
    [optionsChangeListener]
  );

  return {
    addOptionsGetter,
    getCurrentOptions,
  };
}
