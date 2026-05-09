import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

export interface ReactMountManager {
  /**
   * Mount a React node into a container.
   * If the container already has a root, it is unmounted first.
   * Returns a dispose function that unmounts the root for this container.
   */
  mount(container: HTMLElement, component: ReactNode): () => void;
  /**
   * Unmount the React root associated with the given container, if any.
   */
  unmount(container: HTMLElement): void;
  /**
   * Unmount all React roots currently tracked by this manager.
   * Errors during individual unmounts are logged and do not interrupt iteration.
   */
  unmountAll(): void;
}

export function createReactMountManager(): ReactMountManager {
  const roots = new Map<HTMLElement, Root>();

  function unmount(container: HTMLElement): void {
    const root = roots.get(container);
    if (!root) return;
    try {
      root.unmount();
    } finally {
      roots.delete(container);
    }
  }

  function mount(container: HTMLElement, component: ReactNode): () => void {
    if (roots.has(container)) {
      unmount(container);
    }
    const root = createRoot(container);
    root.render(component);
    roots.set(container, root);
    return () => unmount(container);
  }

  function unmountAll(): void {
    for (const [container, root] of roots) {
      try {
        root.unmount();
      } catch (error) {
        console.error("[ReactMountManager] unmount failed", error);
      }
      roots.delete(container);
    }
  }

  return { mount, unmount, unmountAll };
}
