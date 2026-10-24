import { useEffect, useState } from "react";

export function useAsyncResource<T>(loader: () => Promise<T> | T, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const result = await loader();

        if (!active) {
          return;
        }

        setData(result);
      } catch (caught) {
        if (!active) {
          return;
        }

        // Shows up in `adb logcat -s ReactNativeJS` even in release builds.
        console.warn("[Schockboard] Laden fehlgeschlagen:", caught instanceof Error ? caught.message : caught);
        setError(caught instanceof Error ? caught : new Error("Unbekannter Fehler."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [...deps, revision]);

  return {
    data,
    loading,
    error,
    reload() {
      setRevision((value) => value + 1);
    },
  };
}
