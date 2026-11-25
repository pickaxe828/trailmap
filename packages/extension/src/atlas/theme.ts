const communityTokens = ['blue', 'orange', 'purple', 'green', 'pink', 'cyan', 'red', 'teal', 'yellow']
  .map((color) => `--color-icon-${color}`);

/** Resolve light-dark(), color-mix(), oklch(), etc. to the hex format Sigma accepts. */
export function readAtlasColors(scope: HTMLElement) {
  const probe = document.createElement('span');
  probe.hidden = true;
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  scope.appendChild(probe);
  function hex(token: string) {
    probe.style.color = `var(${token})`;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = getComputedStyle(probe).color;
    ctx.fillRect(0, 0, 1, 1);
    const rgba = Array.from(ctx.getImageData(0, 0, 1, 1).data);
    if (rgba[3] === 255) rgba.pop();
    return '#' + rgba.map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  try {
    return { communities: communityTokens.map(hex), edge: hex('--color-border-emphasized'), label: hex('--color-text-primary'),
      font: getComputedStyle(probe).fontFamily };
  } finally { probe.remove(); }
}
