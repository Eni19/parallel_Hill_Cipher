// Mesma aritmetica inteira e mesma derivacao de A de image_hill.c.
const MASK = (1n << 64n) - 1n;
const GAMMA = 0x9e3779b97f4a7c15n;
const U64 = n => n & MASK;

function randomBytes(seed, index, count) {
  let state = U64(seed ^ U64(BigInt(index) * GAMMA));
  const bytes = [];
  for (let i = 0; i < count; i++) {
    state = U64(state + GAMMA);
    let z = U64((state ^ (state >> 30n)) * 0xbf58476d1ce4e5b9n);
    z = U64((z ^ (z >> 27n)) * 0x94d049bb133111ebn);
    bytes.push(Number((z ^ (z >> 31n)) & 255n));
  }
  return bytes;
}

export function matrixForBlock(seed, index, size = 4) {
  if (size === 1) return [[255]];
  const a = randomBytes(seed, index, size === 4 ? 4 : 1);
  if (size < 4) {
    const x = a[0], pair = [[x, (1 - x * x) & 255], [1, (-x) & 255]];
    return size === 2 ? pair : [[...pair[0], 0], [...pair[1], 0], [0, 0, 255]];
  }
  const [a00, a01, a10, a11] = a;
  const q00 = a00 * a00 + a01 * a10, q01 = a00 * a01 + a01 * a11;
  const q10 = a10 * a00 + a11 * a10, q11 = a10 * a01 + a11 * a11;
  return [
    [a00, a01, (1 - q00) & 255, (-q01) & 255],
    [a10, a11, (-q10) & 255, (1 - q11) & 255],
    [1, 0, (-a00) & 255, (-a01) & 255],
    [0, 1, (-a10) & 255, (-a11) & 255]
  ];
}

export function transformBlocks(bytes, seed, firstBlock = 0) {
  for (let off = 0; off < bytes.length; off += 4) {
    const size = Math.min(4, bytes.length - off);
    const key = matrixForBlock(seed, firstBlock + off / 4, size);
    const input = bytes.slice(off, off + size);
    for (let row = 0; row < size; row++) {
      let sum = 0;
      for (let col = 0; col < size; col++) sum += key[row][col] * input[col];
      bytes[off + row] = sum & 255;
    }
  }
  return bytes;
}
