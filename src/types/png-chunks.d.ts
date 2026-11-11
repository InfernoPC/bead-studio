declare module 'png-chunks-extract' {
  const extract: (data: Uint8Array) => { name: string; data: Uint8Array }[];
  export default extract;
}
declare module 'png-chunks-encode' {
  const encode: (chunks: { name: string; data: Uint8Array }[]) => Uint8Array;
  export default encode;
}
