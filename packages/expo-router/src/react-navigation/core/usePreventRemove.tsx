'use client';
import * as React from 'react';

import { ScreenRemovalPreventionSetterContext } from '../../global-state/removalPrevention';
import useLatestCallback from '../../utils/useLatestCallback';
import type { NavigationAction } from '../routers';
import type { EventListenerCallback, EventMapCore } from './types';
import { useClientLayoutEffect } from './useClientLayoutEffect';
import { useNavigation } from './useNavigation';

/**
 * Prevents the screen from being removed while `preventRemove` is `true` and calls `callback`
 * with the blocked navigation action.
 *
 * To continue from the same handler, call the returned `disablePrevention` function before
 * navigating.
 *
 * @example
 * ```tsx
 * const [hasUnsavedChanges, setHasUnsavedChanges] = useState(true);
 * const [showConfirm, setShowConfirm] = useState(false);
 *
 * const disablePrevention = usePreventRemove(hasUnsavedChanges, () => setShowConfirm(true));
 *
 * {showConfirm && (
 *   <Button
 *     title="Discard changes"
 *     onPress={() => {
 *       setHasUnsavedChanges(false);
 *       disablePrevention();
 *       router.back();
 *     }}
 *   />
 * )}
 * ```
 *
 * @param preventRemove Boolean indicating whether to prevent screen from being removed.
 * @param callback Optional function called when the screen was prevented from being removed.
 */
export function usePreventRemove(
  preventRemove: boolean,
  callback?: (options: { data: { action: NavigationAction } }) => void
) {
  const id = React.useId();
  const navigation = useNavigation();
  const setPreventRemove = React.use(ScreenRemovalPreventionSetterContext);

  if (setPreventRemove === undefined) {
    throw new Error(
      "Couldn't find the prevent remove context. Is your component inside Screen or Layout?"
    );
  }

  useClientLayoutEffect(() => {
    setPreventRemove(id, preventRemove);
    return () => {
      setPreventRemove(id, false);
    };
  }, [id, preventRemove, setPreventRemove]);

  const removePreventedListener = useLatestCallback<
    EventListenerCallback<EventMapCore<any>, 'removePrevented'>
  >((event) => {
    if (preventRemove && callback) {
      callback({ data: event.data });
    }
  });

  React.useEffect(
    () =>
      callback ? navigation.addListener('removePrevented', removePreventedListener) : undefined,
    [navigation, removePreventedListener]
  );
  // TODO(@ubax): use standard useCallback if possible
  // TODO(@ubax): add repeat function which will call this and repeat the action
  // TODO(@ubax): add sync between disable and wether the prop did change as well
  return useLatestCallback(() => setPreventRemove(id, false));
}
