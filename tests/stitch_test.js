const assert = require('assert');

function calculateDirectStitch(slices) {
  if (!slices || slices.length === 0) return { width: 0, height: 0, drawOps: [] };

  const dpr = slices[0].devicePixelRatio || 1;
  const baseWidth = Math.round(slices[0].viewportWidth * dpr);
  const startY = slices[0].scrollY;
  const lastSlice = slices[slices.length - 1];
  
  // Total canvas height from top of first slice to bottom of last slice
  const totalHeight = Math.round((lastSlice.scrollY + lastSlice.viewportHeight - startY) * dpr);
  
  const drawOps = [];
  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    const destY = Math.round((slice.scrollY - startY) * dpr);
    const destH = Math.round(slice.viewportHeight * (slice.devicePixelRatio || dpr));
    const destW = Math.round(slice.viewportWidth * (slice.devicePixelRatio || dpr));

    drawOps.push({
      sliceIndex: i,
      destY: destY,
      destH: destH,
      destW: destW
    });
  }

  return { width: baseWidth, height: totalHeight, drawOps };
}

// Test 1: 3 slices of a 2000px page
console.log('Testing Direct Canvas Offset Stitcher...');
const slices = [
  { scrollY: 0, viewportWidth: 1200, viewportHeight: 800, devicePixelRatio: 1 },
  { scrollY: 600, viewportWidth: 1200, viewportHeight: 800, devicePixelRatio: 1 },
  { scrollY: 1200, viewportWidth: 1200, viewportHeight: 800, devicePixelRatio: 1 }
];

const res = calculateDirectStitch(slices);
console.log('Stitched Canvas Width:', res.width, 'Height:', res.height);
assert.strictEqual(res.width, 1200);
assert.strictEqual(res.height, 2000); // 1200 + 800 = 2000px
assert.strictEqual(res.drawOps[0].destY, 0); // Top of page
assert.strictEqual(res.drawOps[1].destY, 600); // Middle of page
assert.strictEqual(res.drawOps[2].destY, 1200); // Bottom of page (reaches 1200 + 800 = 2000px!)

console.log('✓ All slices positioned with 100% exact canvas coordinates from top to bottom!');
