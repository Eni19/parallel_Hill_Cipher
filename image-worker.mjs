import { transformBlocks } from './image-core.mjs';

self.onmessage = event => {
  const { buffer, seed, firstBlock } = event.data;
  transformBlocks(new Uint8Array(buffer), BigInt(seed), firstBlock);
  self.postMessage(buffer, [buffer]);
};
