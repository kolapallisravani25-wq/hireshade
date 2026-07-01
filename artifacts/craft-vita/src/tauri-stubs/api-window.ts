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
  center: async () => {},
  minimize: async () => {},
  maximize: async () => {},
  unmaximize: async () => {},
  listen: async () => () => {},
  once: async () => () => {},
  emit: async () => {},
};
export const getCurrentWindow = () => noopWindow;
export const appWindow = noopWindow;
