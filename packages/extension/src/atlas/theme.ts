const communityTokens = ['blue', 'orange', 'purple', 'green', 'pink', 'cyan', 'red', 'teal', 'yellow']
  .map((color) => `--color-icon-${color}`);

const FADED_SHARE = 0.4;
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** `share` of `color` over `backdrop`, as #rrggbb. */
export function blend(color: string, backdrop: string, share: number) {
  const [a, b] = [channels(color), channels(backdrop)];
  return '#' + a.map((value, i) => Math.round(value! * share + b[i]! * (1 - share)).toString(16).padStart(2, '0')).join('');
}

// One canvas pixel is enough to convert a computed theme color to Sigma's hex format.
const PROBE_PX = 1;

/** Resolve light-dark(), color-mix(), oklch(), etc. to the hex format Sigma accepts. */
export function readAtlasColors(scope: HTMLElement) {
  const probe = document.createElement('span');
  probe.hidden = true;
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  scope.appendChild(probe);
  function hex(token: string) {
    probe.style.color = `var(${token})`;
    ctx.clearRect(0, 0, PROBE_PX, PROBE_PX);
    ctx.fillStyle = getComputedStyle(probe).color;
    ctx.fillRect(0, 0, PROBE_PX, PROBE_PX);
    const rgba = Array.from(ctx.getImageData(0, 0, PROBE_PX, PROBE_PX).data);
    if (rgba[3] === 255) rgba.pop();
    return '#' + rgba.map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  try {
    // Concepts only seen on pages are the same colour blended toward the card, so they recede without changing hue.
    const backdrop = hex('--color-background-card');
    const communities = communityTokens.map(hex);
    return { communities, faded: communities.map((color) => blend(color, backdrop, FADED_SHARE)), edge: hex('--color-border-emphasized'), label: hex('--color-text-primary'),
      font: getComputedStyle(probe).fontFamily };
  } finally { probe.remove(); }
}
