import * as React from "react";

const noop = () => () => {};

/**
 * `false` during SSR and the hydration pass, `true` afterwards.
 * Use to gate client-only values (theme, locale-formatted dates) without
 * triggering a hydration mismatch.
 */
export function useMounted() {
  return React.useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
