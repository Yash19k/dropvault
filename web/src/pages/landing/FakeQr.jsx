// Decorative QR-like grid (deterministic, not a real code).
export default function FakeQr({ className = 'block h-auto w-full' }) {
  const n = 25;
  const cells = [];
  const finders = [[0, 0], [n - 7, 0], [0, n - 7]];
  const finder = (x, y) => finders.some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
  const finderOn = (x, y) => {
    for (const [fx, fy] of finders) {
      const dx = x - fx; const dy = y - fy;
      if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) {
        return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
      }
    }
    return false;
  };
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const quiet = (x === 7 || y === 7 || x === n - 8) && (finder(x - 1, y) || finder(x, y - 1) || finder(x + 1, y));
      const h = Math.imul(x * 374761393 + y * 668265263, 1274126177) >>> 0;
      const on = finder(x, y) ? finderOn(x, y) : !quiet && (h % 100) < 47;
      if (on) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />);
    }
  }
  return <svg viewBox={`0 0 ${n} ${n}`} className={className} fill="#1b1b18" shapeRendering="crispEdges">{cells}</svg>;
}
