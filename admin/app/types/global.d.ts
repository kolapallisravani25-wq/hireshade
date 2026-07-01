declare module '*.css' {
  const styles: { readonly [className: string]: string };
  export default styles;
}

declare module '*.json' {
  const value: unknown;
  export default value;
}

declare module '@kottster/react/dist/style.css' {
  const kottsterStyles: undefined;
  export default kottsterStyles;
}

declare module 'grapesjs-preset-webpage' {
  import type { Plugin } from 'grapesjs';
  const webpagePlugin: Plugin;
  export default webpagePlugin;
}

declare module 'grapesjs-blocks-basic' {
  import type { Plugin } from 'grapesjs';
  const blocksBasicPlugin: Plugin;
  export default blocksBasicPlugin;
}
