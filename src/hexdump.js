// Pure formatting helpers for the "last read" panel.

const DOT = '·'; // middle dot for non-printable bytes

function toHex(b, width) {
  return b.toString(16).padStart(width, '0');
}

// Classic hex+ASCII dump of a byte array, `bytesPerRow` bytes per line:
//   00000000  00 41 42 ff                                       |·AB·|
export function hexdump(bytes, { bytesPerRow = 16 } = {}) {
  const lines = [];
  const hexCols = bytesPerRow * 3 - 1;
  for (let row = 0; row < bytes.length; row += bytesPerRow) {
    const slice = Array.from(bytes.slice(row, row + bytesPerRow));
    const hex = slice.map((b) => toHex(b, 2)).join(' ').padEnd(hexCols, ' ');
    const ascii = slice.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : DOT)).join('');
    lines.push(`${toHex(row, 8)}  ${hex}  |${ascii}|`);
  }
  return lines.join('\n');
}

// Simple, human-facing description of a byte array.
export function byteStats(bytes) {
  const total = bytes.length;
  let printable = 0;
  const seen = new Set();
  for (const b of bytes) {
    if (b >= 32 && b < 127) printable++;
    seen.add(b);
  }
  return {
    total,
    printable,
    distinct: seen.size,
    printablePct: total ? Math.round((printable / total) * 100) : 0,
  };
}
