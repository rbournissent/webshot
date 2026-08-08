# WebShot - Full Page Scrolling Screenshot & Cropper (Chrome Extension)

WebShot is a powerful, high-performance Chrome Extension (Manifest V3) that captures full-page scrolling screenshots of any webpage, stitches them seamlessly into a high-resolution canvas, provides an interactive cropping studio, and exports to JPG with customizable compression and background fill.

---

## Key Features

1. **Continuous Auto-Scroll & Capture Engine**
   - **Continuous Scroll Mode**: Auto-scrolls the page step-by-step and stitches indefinitely until you click **"Stop & Edit"** or press `Escape`.
   - **Full Page Auto-Detect Mode**: Automatically scrolls to the bottom of the page and stops upon reaching the end.
   - **Visible Area Mode**: Instant snapshot of the current viewport.
   - **Floating In-Page HUD**: A sleek floating pill showing live frame count, scrolled pixels, and quick controls (**Stop & Edit**, **Pause / Resume**, **Cancel**).
   - **Smart Header Filtering**: Automatically handles sticky/fixed navigation bars to prevent duplicate banners in stitched screenshots.

2. **Studio Canvas Editor & Interactive Cropper**
   - **8-Point Precision Resize Handles**: Resize crop boxes from any corner or edge with live `W × H px` dimensions.
   - **Aspect Ratio Presets**: `Free`, `1:1 (Square)`, `16:9 (Landscape)`, `4:3 (Standard)`, `9:16 (Story/Reels)`, `3:2 (Photo)`.
   - **Aspect Ratio Locking & Boundary Clamping**: Smoothly drag or resize within canvas bounds.
   - **Composition Grid**: Rule-of-thirds grid lines for framing.
   - **Hardware-Accelerated Pan & Zoom**: Mouse wheel zoom, Pan/Hand tool (`Space + Drag`), Fit-to-Screen, and 100% Actual Size.
   - **Minimap Navigator**: Thumbnail navigator in the bottom right corner with an interactive viewport indicator.

3. **JPG Export & Clipboard Pipeline**
   - **JPG Quality Control**: Slider from 10% to 100% (default 92%) with live estimated file size calculation (`~1.4 MB`).
   - **Background Fill**: Clean `#ffffff` (White), `#0f172a` (Slate), `#000000` (Pure Black), or custom color picker (prevents black alpha artifacts in JPGs).
   - **Export Selection**: Choose between exporting the **Cropped Selection** or the **Full Page Capture**.
   - **One-Click Actions**: Direct JPG Download with custom filename formatting or instant **Copy to Clipboard**.

---

## Installation Guide (Load Unpacked)

1. Open Google Chrome (or any Chromium-based browser like Brave, Edge, Opera).
2. In the address bar, go to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click the **Load unpacked** button in the top-left.
5. Select the project directory:
   ```
   /home/rodrigo/projects/webshot
   ```
6. The **WebShot** extension icon will now appear in your browser toolbar! Pin it for quick access.

---

## How to Use

1. Navigate to any webpage you wish to capture (or open `demo/index.html`).
2. Click the **WebShot** extension icon (or press `Alt + Shift + S`).
3. Select **Continuous Scroll** (or your preferred mode) and click **"Start Auto-Scroll & Capture"**.
4. The page will begin auto-scrolling smoothly. When you have captured everything you need, click **"Stop & Edit"** on the floating HUD (or press `Escape`).
5. The **WebShot Studio** tab will open automatically.
6. Adjust the crop box using the handles or choose an aspect ratio preset (e.g., `16:9` or `1:1`).
7. Click **"Download JPG Image"** or **"Copy"** to export your screenshot!

---

## Project Structure

```
webshot/
├── manifest.json              # Manifest V3 specification & permissions
├── icons/                     # Extension icons (16px, 32px, 48px, 128px)
├── popup/                     # Extension popup interface
│   ├── popup.html             # Popup layout & mode selector
│   ├── popup.css              # Dark glassmorphic styling
│   └── popup.js               # Popup controller & launch triggers
├── background/                # Background Service Worker
│   └── background.js          # Tab capture orchestration & storage
├── content/                   # Content scripts injected into web pages
│   ├── content.js             # Auto-scroll loop, scroll coordinator, HUD manager
│   └── content.css            # Floating HUD styling
├── editor/                    # Dedicated Post-Capture Studio
│   ├── editor.html            # Canvas stage, toolbar, sidebar, and export modal
│   ├── editor.css             # Dark theme studio stylesheet & handles
│   ├── editor.js              # Canvas stitcher, pan/zoom, JPG exporter
│   └── cropper.js             # Interactive 8-handle crop box engine
└── demo/                      # Test page for immediate verification
    ├── index.html             # Long scrollable landing page
    └── style.css              # Landing page styling
```
