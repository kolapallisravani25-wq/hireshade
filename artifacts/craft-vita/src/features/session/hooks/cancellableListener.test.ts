import { describe, expect, it, vi } from "vitest";
import { attachCancellableListener } from "./cancellableListener";

/**
 * Deterministically reproduces the exact race React.StrictMode's dev-mode
 * double-invoke exposes: effect starts → listen() is pending → cleanup runs
 * → listen() later resolves. The just-resolved unlisten function must be
 * invoked immediately in that case, not stored/leaked.
 */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("attachCancellableListener", () => {
  it("14. cleanup running BEFORE the registration promise resolves causes the late-resolving listener to be immediately unlistened", async () => {
    const deferred = createDeferred<() => void>();
    const invokeUnlisten = vi.fn();

    const registration = attachCancellableListener(deferred.promise, invokeUnlisten);

    // Cleanup runs first (StrictMode's simulated unmount) — the promise is
    // still pending at this point.
    registration.cancel();
    expect(invokeUnlisten).not.toHaveBeenCalled();

    // The registration promise resolves AFTER cleanup already ran.
    const unlistenFn = () => {};
    deferred.resolve(unlistenFn);
    await Promise.resolve(); // flush the microtask queue

    // Must be invoked immediately instead of leaking.
    expect(invokeUnlisten).toHaveBeenCalledTimes(1);
    expect(invokeUnlisten).toHaveBeenCalledWith(unlistenFn);
  });

  it("normal case: cleanup running AFTER the promise already resolved unlistens exactly once", async () => {
    const unlistenFn = vi.fn();
    const invokeUnlisten = (fn: () => void) => fn();
    const registration = attachCancellableListener(Promise.resolve(unlistenFn), invokeUnlisten);

    await Promise.resolve(); // let it resolve and store the unlisten fn
    expect(unlistenFn).not.toHaveBeenCalled();

    registration.cancel();
    expect(unlistenFn).toHaveBeenCalledTimes(1);
  });

  it("calling cancel() twice does not double-invoke the unlisten function", async () => {
    const unlistenFn = vi.fn();
    const invokeUnlisten = (fn: () => void) => fn();
    const registration = attachCancellableListener(Promise.resolve(unlistenFn), invokeUnlisten);

    await Promise.resolve();
    registration.cancel();
    registration.cancel();
    expect(unlistenFn).toHaveBeenCalledTimes(1);
  });

  it("a rejected registration promise never invokes unlisten and cancel() is still safe to call", async () => {
    const invokeUnlisten = vi.fn();
    const registration = attachCancellableListener(
      Promise.reject(new Error("registration failed")),
      invokeUnlisten,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(() => registration.cancel()).not.toThrow();
    expect(invokeUnlisten).not.toHaveBeenCalled();
  });
});
