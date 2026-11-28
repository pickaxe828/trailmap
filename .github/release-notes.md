## Install Trailmap {{VERSION}}

**1. The extension**

- **Chrome, Helium, Brave, Edge, Arc or Vivaldi:**
  1. Unzip `trailmap-{{VERSION}}-chrome.zip` into a folder you will keep.
  2. Open `chrome://extensions` and turn on **Developer mode**.
  3. Choose **Load unpacked** and pick that folder.
  - To update later, unzip the new version over the same folder and click **Reload**. The extension ID is always `boahmdajmiicaicaopfgkcdaahidmalm`.
- **Firefox or Zen:**
  - If this release has `trailmap-{{VERSION}}-firefox.xpi`, open `about:addons` and choose ⚙ → **Install Add-on From File…**.
  - Otherwise, unzip `trailmap-{{VERSION}}-firefox.zip`, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and pick its `manifest.json`. Temporary add-ons are removed when the browser restarts.

**2. The companion** (needed for AI notes, Ask and Obsidian sync)

1. Download the archive for your machine: `darwin-arm64` for Apple silicon, `darwin-x64` for Intel Macs, `linux-x64`, or `linux-arm64`.
2. Unpack it into a folder you will keep, for example `~/.trailmap/bin`. The browser launches the companion from wherever it was installed, so moving it later breaks the connection.
3. Run:

```sh
mkdir -p ~/.trailmap/bin && tar -xzf trailmap-companion-{{VERSION}}-darwin-arm64.tar.gz -C ~/.trailmap/bin
xattr -d com.apple.quarantine ~/.trailmap/bin/trailmap-companion 2>/dev/null   # macOS: the binary is not notarized
~/.trailmap/bin/trailmap-companion install
```

`install` registers the companion with every supported browser it finds. To limit it, use `--browser chromium` or `--browser firefox`.

Check your downloads against `SHA256SUMS` with `shasum -a 256 -c SHA256SUMS --ignore-missing`.
