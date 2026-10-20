export class LogicalSize {
  constructor(public width: number, public height: number) {}
}
export class PhysicalSize {
  constructor(public width: number, public height: number) {}
}
const noopWindow = {
  show: async () => {},
  hide: async () => {},
  close: async () => {},
  setSize: async () => {},
  setPosition: async () => {},
  setFocus: async () => {},
  startDragging: async () => {},
  startResizeDragging: async (_direction?: unknown) => {},
  center: async () => {},
  minimize: async () => {},
  maximize: async () => {},
  unmaximize: async () => {},
  listen: async () => () => {},
  once: async () => () => {},
  emit: async () => {},
  outerPosition: async () => ({ x: 0, y: 0 }),
  scaleFactor: async () => (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1),
  onMoved: async () => () => {},
  onResized: async () => () => {},
  onCloseRequested: async () => () => {},
  onFocusChanged: async () => () => {},
  onScaleChanged: async () => () => {},
  onThemeChanged: async () => () => {},
};
export const getCurrentWindow = () => noopWindow;
export const appWindow = noopWindow;
