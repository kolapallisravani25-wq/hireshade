// Disable noisy debug logs globally in frontend runtimes (web + desktop webviews).
// Keep warnings and errors so important failures remain visible.
const noop = () => {};

// console.log = noop;
console.debug = noop;
console.info = noop;

export {};

