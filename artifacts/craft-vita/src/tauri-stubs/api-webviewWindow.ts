export class WebviewWindow {
  constructor(_label: string, _options?: unknown) {}
  listen = async () => () => {};
  once = async () => () => {};
  emit = async () => {};
  show = async () => {};
  hide = async () => {};
  close = async () => {};
  setFocus = async () => {};
}
export const getCurrentWebviewWindow = () => new WebviewWindow("main");
