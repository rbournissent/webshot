/**
 * WebShot Studio - Canvas Stitcher, Pan/Zoom Engine, & JPG Export Pipeline
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const compositeCanvas = document.getElementById('compositeCanvas');
  const ctx = compositeCanvas.getContext('2d');
  const canvasStage = document.getElementById('canvasStage');
  const viewportViewport = document.getElementById('viewportViewport');
  const canvasTransformWrapper = document.getElementById('canvasTransformWrapper');
  const cropperOverlay = document.getElementById('cropperOverlay');
  const cropBox = document.getElementById('cropBox');
  const cropBadge = document.getElementById('cropBadge');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingStatusText = document.getElementById('loadingStatusText');
  const pageTitleText = document.getElementById('pageTitle');
  const dimensionBadge = document.getElementById('dimensionBadge');
  const sliceCountBadge = document.getElementById('sliceCountBadge');
  
  // Crop Inputs & Controls
  const cropWidthInput = document.getElementById('cropWidthInput');
  const cropHeightInput = document.getElementById('cropHeightInput');
  const cropXInput = document.getElementById('cropXInput');
  const cropYInput = document.getElementById('cropYInput');
  const aspectRatioGroup = document.getElementById('aspectRatioGroup');
  const btnSelectAll = document.getElementById('btnSelectAll');
  const btnCenterCrop = document.getElementById('btnCenterCrop');
  const btnToggleGrid = document.getElementById('btnToggleGrid');
  
  // Export Controls
  const jpgQualitySlider = document.getElementById('jpgQualitySlider');
  const qualityValText = document.getElementById('qualityValText');
  const estFileSize = document.getElementById('estFileSize');
  const exportTargetRadios = document.querySelectorAll('input[name="exportTarget"]');
  const colorBtns = document.querySelectorAll('.color-btn');
  const customBgColor = document.getElementById('customBgColor');
  const btnDirectDownload = document.getElementById('btnDirectDownload');
  const btnCopyClipboard = document.getElementById('btnCopyClipboard');
  const btnOpenExportPanel = document.getElementById('btnOpenExportPanel');
  const exportDialog = document.getElementById('exportDialog');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const btnModalCancel = document.getElementById('btnModalCancel');
  const btnModalCopy = document.getElementById('btnModalCopy');
  const btnModalDownload = document.getElementById('btnModalDownload');
  const exportFilenameInput = document.getElementById('exportFilename');
  const modalExportRes = document.getElementById('modalExportRes');
  const modalExportSize = document.getElementById('modalExportSize');
  const modalQualityText = document.getElementById('modalQualityText');
  
  // Zoom & Pan Controls
  const btnZoomIn = document.getElementById('btnZoomIn');
  const btnZoomOut = document.getElementById('btnZoomOut');
  const btnFitScreen = document.getElementById('btnFitScreen');
  const btnActualSize = document.getElementById('btnActualSize');
  const btnPanTool = document.getElementById('btnPanTool');
  const zoomLevelText = document.getElementById('zoomLevelText');
  
  // Minimap
  const minimap = document.getElementById('minimap');
  const minimapCanvas = document.getElementById('minimapCanvas');
  const minimapViewportRect = document.getElementById('minimapViewportRect');
  const minimapCtx = minimapCanvas.getContext('2d');
  
  // Toast
  const toastNotification = document.getElementById('toastNotification');
  const toastMessage = document.getElementById('toastMessage');

  // State
  let sessionData = null;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let zoom = 1.0;
  let panOffset = { x: 0, y: 0 };
  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let isPanToolActive = false;
  let isSpacePressed = false;
  let selectedBgColor = '#ffffff';
  let exportTarget = 'crop'; // 'crop' | 'full'
  let cropper = null;

  // Initialize Cropper Instance
  cropper = new InteractiveCropper({
    container: cropperOverlay,
    cropBox: cropBox,
    shades: {
      top: document.getElementById('cropShadeTop'),
      bottom: document.getElementById('cropShadeBottom'),
      left: document.getElementById('cropShadeLeft'),
      right: document.getElementById('cropShadeRight')
    },
    badge: cropBadge,
    onCropChange: (cropRect) => {
      syncCropInputs(cropRect);
      estimateJpgSize();
    }
  });

  // Load Session Data
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session');

  if (!sessionId) {
    showLoadingError('No capture session specified. Please capture a page using the WebShot extension.');
    return;
  }

  chrome.runtime.sendMessage({ type: 'GET_SESSION_DATA', sessionId }, async (res) => {
    if (!res || !res.success || !res.session) {
      showLoadingError(res ? res.error : 'Failed to retrieve capture frames.');
      return;
    }

    sessionData = res.session;
    pageTitleText.textContent = sessionData.title || 'WebShot Capture';
    sliceCountBadge.textContent = `${sessionData.slices.length} slices`;
    exportFilenameInput.value = sanitizeFilename(sessionData.title || 'webshot-capture');

    // Stitch images onto canvas
    await stitchCapturedSlices(sessionData.slices);
  });

  /**
   * Stitches slices seamlessly onto canvas
   */
  async function stitchCapturedSlices(slices) {
    if (!slices || slices.length === 0) {
      showLoadingError('No frame slices found in this session.');
      return;
    }

    loadingStatusText.textContent = `Assembling ${slices.length} frames...`;

    try {
      // Preload image elements with synchronous decode check fallback
      const loadedImages = await Promise.all(
        slices.map((slice, i) => {
          return new Promise((resolve) => {
            if (!slice || !slice.dataUrl) {
              resolve(null);
              return;
            }
            const img = new Image();
            let settled = false;

            const done = () => {
              if (!settled) {
                settled = true;
                resolve({ img, slice });
              }
            };

            img.onload = done;
            img.onerror = (err) => {
              console.warn(`Could not decode slice #${i}:`, err);
              if (!settled) {
                settled = true;
                resolve(null);
              }
            };
            img.src = slice.dataUrl;

            // Handle instantaneous in-memory data URLs
            if (img.complete && img.naturalWidth > 0) {
              done();
            }
          });
        })
      );

      const validFrames = loadedImages.filter(Boolean);
      if (validFrames.length === 0) {
        showLoadingError('Could not process captured frame images.');
        return;
      }

      // 1. Sort frames strictly by vertical scroll position
      validFrames.sort((a, b) => (a.slice.scrollY || 0) - (b.slice.scrollY || 0));

      const firstImg = validFrames[0].img;
      const firstSlice = validFrames[0].slice;
      const dpr = firstSlice.devicePixelRatio || 1;
      const baseWidth = firstImg.naturalWidth;
      const firstHeight = firstImg.naturalHeight;

      // 2. Subpixel-perfect delta slice calculation
      let drawnHeight = firstHeight;
      const sliceSteps = [];

      for (let i = 1; i < validFrames.length; i++) {
        const prev = validFrames[i - 1].slice;
        const curr = validFrames[i].slice;
        const prevY_px = Math.round((prev.scrollY || 0) * dpr);
        const currY_px = Math.round((curr.scrollY || 0) * dpr);
        const new_pixels = currY_px - prevY_px;
        if (new_pixels <= 0) continue;

        const img = validFrames[i].img;
        const imgHeight = img.naturalHeight;
        
        // Clamp to prevent drawing outside image bounds (which causes white gaps)
        const safe_new_pixels = Math.min(new_pixels, imgHeight);
        const source_y = imgHeight - safe_new_pixels;

        sliceSteps.push({
          img,
          source_y,
          new_pixels: safe_new_pixels,
          dest_y: drawnHeight
        });

        drawnHeight += safe_new_pixels;
      }

      canvasWidth = baseWidth;
      canvasHeight = drawnHeight;

      // Set canvas dimensions exactly to drawn height (zero trailing white space)
      compositeCanvas.width = canvasWidth;
      compositeCanvas.height = canvasHeight;

      // Fill canvas background
      ctx.fillStyle = selectedBgColor || '#ffffff';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // 3. Draw Slice 0 (full initial viewport from top)
      ctx.drawImage(firstImg, 0, 0);

      // 4. Draw subsequent slices at exact destination Y coordinates
      sliceSteps.forEach((step) => {
        ctx.drawImage(
          step.img,
          0, step.source_y, step.img.naturalWidth, step.new_pixels,
          0, step.dest_y, canvasWidth, step.new_pixels
        );
      });

      // Update UI Badges
      dimensionBadge.textContent = `${canvasWidth} × ${canvasHeight} px`;

      // Render Minimap
      renderMinimap();

      // Initialize Cropper overlay (covers 100% of the screenshot by default)
      cropper.init(canvasWidth, canvasHeight, zoom);

      // Fit canvas to viewport
      fitToScreen();

      // Estimate initial JPG size
      estimateJpgSize();
    } catch (err) {
      console.error('Stitch error:', err);
    } finally {
      // Guaranteed to dismiss the loading overlay
      loadingOverlay.classList.add('hidden');
      loadingOverlay.style.display = 'none';
    }
  }

  /**
   * Renders miniature preview for minimap
   */
  function renderMinimap() {
    const mapWidth = 140;
    const mapHeight = 180;
    minimapCanvas.width = mapWidth;
    minimapCanvas.height = mapHeight;

    const scale = Math.min(mapWidth / canvasWidth, mapHeight / canvasHeight);
    const renderW = canvasWidth * scale;
    const renderH = canvasHeight * scale;
    const offsetX = (mapWidth - renderW) / 2;
    const offsetY = (mapHeight - renderH) / 2;

    minimapCtx.fillStyle = '#0f172a';
    minimapCtx.fillRect(0, 0, mapWidth, mapHeight);
    minimapCtx.drawImage(compositeCanvas, offsetX, offsetY, renderW, renderH);

    updateMinimapViewportRect();
  }

  function updateMinimapViewportRect() {
    if (!minimapViewportRect || canvasWidth === 0 || canvasHeight === 0) return;

    const mapWidth = 140;
    const mapHeight = 180;
    const scale = Math.min(mapWidth / canvasWidth, mapHeight / canvasHeight);
    const renderW = canvasWidth * scale;
    const renderH = canvasHeight * scale;
    const offsetX = (mapWidth - renderW) / 2;
    const offsetY = (mapHeight - renderH) / 2;

    const stageRect = canvasStage.getBoundingClientRect();
    const visibleW = Math.min(canvasWidth, stageRect.width / zoom);
    const visibleH = Math.min(canvasHeight, stageRect.height / zoom);
    const visibleX = Math.max(0, -panOffset.x / zoom);
    const visibleY = Math.max(0, -panOffset.y / zoom);

    const rectW = Math.max(8, visibleW * scale);
    const rectH = Math.max(8, visibleH * scale);
    const rectX = offsetX + (visibleX * scale);
    const rectY = offsetY + (visibleY * scale);

    minimapViewportRect.style.left = `${rectX}px`;
    minimapViewportRect.style.top = `${rectY}px`;
    minimapViewportRect.style.width = `${rectW}px`;
    minimapViewportRect.style.height = `${rectH}px`;
  }

  /**
   * Pan and Zoom Transformations
   */
  function setTransform(newZoom, newPanX, newPanY) {
    zoom = Math.max(0.05, Math.min(5.0, newZoom));
    
    const stageRect = canvasStage.getBoundingClientRect();
    const totalW = canvasWidth * zoom;
    const totalH = canvasHeight * zoom;

    // Center if smaller than viewport
    if (totalW < stageRect.width) {
      newPanX = (stageRect.width - totalW) / 2;
    }
    if (totalH < stageRect.height) {
      newPanY = (stageRect.height - totalH) / 2;
    }

    panOffset = { x: newPanX, y: newPanY };

    canvasTransformWrapper.style.transform = `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`;
    canvasTransformWrapper.style.transformOrigin = '0 0';

    zoomLevelText.textContent = `${Math.round(zoom * 100)}%`;

    if (cropper) {
      cropper.setZoom(zoom);
    }

    updateMinimapViewportRect();
  }

  function fitToScreen() {
    const stageRect = canvasStage.getBoundingClientRect();
    if (stageRect.width === 0 || stageRect.height === 0 || canvasWidth === 0 || canvasHeight === 0) return;

    const padding = 40;
    const scaleX = (stageRect.width - padding * 2) / canvasWidth;
    const scaleY = (stageRect.height - padding * 2) / canvasHeight;
    const fitZoom = Math.min(scaleX, scaleY, 1.0);

    const totalW = canvasWidth * fitZoom;
    const totalH = canvasHeight * fitZoom;

    const panX = (stageRect.width - totalW) / 2;
    const panY = totalH < stageRect.height ? (stageRect.height - totalH) / 2 : padding;

    setTransform(fitZoom, panX, panY);
  }

  function setActualSize() {
    const stageRect = canvasStage.getBoundingClientRect();
    const panX = (stageRect.width - canvasWidth) / 2;
    const panY = 40;
    setTransform(1.0, panX, panY);
  }

  // Zoom Button Listeners
  btnZoomIn.addEventListener('click', () => {
    setTransform(zoom * 1.25, panOffset.x, panOffset.y);
  });

  btnZoomOut.addEventListener('click', () => {
    setTransform(zoom / 1.25, panOffset.x, panOffset.y);
  });

  btnFitScreen.addEventListener('click', fitToScreen);
  btnActualSize.addEventListener('click', setActualSize);

  // Pan Tool Listener
  btnPanTool.addEventListener('click', () => {
    isPanToolActive = !isPanToolActive;
    btnPanTool.classList.toggle('active', isPanToolActive);
    viewportViewport.classList.toggle('panning', isPanToolActive);
  });

  // Mouse Wheel Zoom (smooth and fine-grained)
  viewportViewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    // Smooth zoom factor based on deltaY magnitude (gentle and natural)
    const normalizedDelta = Math.max(-100, Math.min(100, e.deltaY));
    const zoomFactor = Math.exp(-normalizedDelta * 0.0015);
    
    const stageRect = canvasStage.getBoundingClientRect();
    const mouseX = e.clientX - stageRect.left;
    const mouseY = e.clientY - stageRect.top;

    // Zoom centered around mouse cursor
    const newZoom = Math.max(0.05, Math.min(5.0, zoom * zoomFactor));
    const newPanX = mouseX - (mouseX - panOffset.x) * (newZoom / zoom);
    const newPanY = mouseY - (mouseY - panOffset.y) * (newZoom / zoom);

    setTransform(newZoom, newPanX, newPanY);
  }, { passive: false });

  // Pan by dragging canvas background or holding space
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isSpacePressed && document.activeElement.tagName !== 'INPUT') {
      isSpacePressed = true;
      viewportViewport.classList.add('panning');
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      isSpacePressed = false;
      if (!isPanToolActive) {
        viewportViewport.classList.remove('panning');
      }
    }
  });

  viewportViewport.addEventListener('mousedown', (e) => {
    if (isSpacePressed || isPanToolActive || e.target === viewportViewport || e.target === canvasStage) {
      isPanning = true;
      panStart = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
      e.preventDefault();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (isPanning) {
      const newPanX = e.clientX - panStart.x;
      const newPanY = e.clientY - panStart.y;
      setTransform(zoom, newPanX, newPanY);
    }
  });

  window.addEventListener('mouseup', () => {
    isPanning = false;
  });

  /**
   * Crop Inputs & Aspect Ratio Presets
   */
  function syncCropInputs(rect) {
    cropWidthInput.value = rect.width;
    cropHeightInput.value = rect.height;
    cropXInput.value = rect.x;
    cropYInput.value = rect.y;
    modalExportRes.textContent = `${rect.width} × ${rect.height} px`;
  }

  [cropWidthInput, cropHeightInput, cropXInput, cropYInput].forEach((input) => {
    input.addEventListener('change', () => {
      const w = parseInt(cropWidthInput.value, 10) || 100;
      const h = parseInt(cropHeightInput.value, 10) || 100;
      const x = parseInt(cropXInput.value, 10) || 0;
      const y = parseInt(cropYInput.value, 10) || 0;
      cropper.setCrop(x, y, w, h);
    });
  });

  aspectRatioGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.tool-btn');
    if (!btn) return;

    aspectRatioGroup.querySelectorAll('.tool-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    cropper.setAspectRatio(btn.dataset.ratio);
  });

  btnSelectAll.addEventListener('click', () => {
    aspectRatioGroup.querySelectorAll('.tool-btn').forEach((b) => b.classList.remove('active'));
    aspectRatioGroup.querySelector('[data-ratio="free"]').classList.add('active');
    cropper.selectAll();
    showToast('Selected full screenshot area');
  });

  btnCenterCrop.addEventListener('click', () => {
    cropper.centerCrop();
  });

  btnToggleGrid.addEventListener('click', () => {
    const isActive = btnToggleGrid.classList.toggle('active');
    cropper.toggleGrid(isActive);
  });

  /**
   * Background Fill Selector
   */
  colorBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      colorBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectedBgColor = btn.dataset.color;
    });
  });

  customBgColor.addEventListener('input', () => {
    colorBtns.forEach((b) => b.classList.remove('active'));
    selectedBgColor = customBgColor.value;
  });

  /**
   * Export Target Selector
   */
  exportTargetRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      exportTarget = radio.value;
      radio.closest('.radio-cards').querySelectorAll('.radio-card').forEach((c) => c.classList.remove('active'));
      radio.closest('.radio-card').classList.add('active');
      estimateJpgSize();
    });
  });

  /**
   * JPG Quality Slider & Live Size Estimation
   */
  jpgQualitySlider.addEventListener('input', () => {
    const quality = parseInt(jpgQualitySlider.value, 10);
    qualityValText.textContent = `${quality}%`;
    modalQualityText.textContent = `${quality}%`;
    estimateJpgSize();
  });

  async function estimateJpgSize() {
    if (canvasWidth === 0 || canvasHeight === 0) return;

    const quality = (parseInt(jpgQualitySlider.value, 10) || 92) / 100;
    const crop = cropper ? cropper.getCrop() : { width: canvasWidth, height: canvasHeight };
    const w = exportTarget === 'crop' ? crop.width : canvasWidth;
    const h = exportTarget === 'crop' ? crop.height : canvasHeight;

    // Formula approximation based on standard JPEG chroma subsampling
    const estBytes = (w * h * 3) * (quality * 0.12);
    const estFormatted = formatBytes(estBytes);

    estFileSize.textContent = `~${estFormatted}`;
    modalExportSize.textContent = `~${estFormatted}`;
    modalExportRes.textContent = `${w} × ${h} px`;
  }

  /**
   * JPG Rendering & Blob Generator
   */
  async function generateJpgBlob() {
    const quality = (parseInt(jpgQualitySlider.value, 10) || 92) / 100;
    const crop = cropper.getCrop();
    const isCrop = exportTarget === 'crop';

    const renderW = isCrop ? crop.width : canvasWidth;
    const renderH = isCrop ? crop.height : canvasHeight;
    const srcX = isCrop ? crop.x : 0;
    const srcY = isCrop ? crop.y : 0;

    // Create offscreen export canvas
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = renderW;
    exportCanvas.height = renderH;
    const exportCtx = exportCanvas.getContext('2d');

    // Fill background color (prevents black alpha in JPG)
    exportCtx.fillStyle = selectedBgColor || '#ffffff';
    exportCtx.fillRect(0, 0, renderW, renderH);

    // Draw stitched composite slice onto export canvas
    exportCtx.drawImage(compositeCanvas, srcX, srcY, renderW, renderH, 0, 0, renderW, renderH);

    return new Promise((resolve) => {
      exportCanvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/jpeg', quality);
    });
  }

  /**
   * Download Pipeline
   */
  async function performDownload() {
    showToast('Preparing high-res JPG export...');
    const blob = await generateJpgBlob();
    if (!blob) {
      showToast('Export failed', true);
      return;
    }

    const filename = `${exportFilenameInput.value.trim() || 'webshot'}.jpg`;
    const objectUrl = URL.createObjectURL(blob);

    // Try chrome.downloads API first, fallback to anchor tag
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_IMAGE',
      dataUrl: objectUrl,
      filename: filename
    }, (res) => {
      if (chrome.runtime.lastError || (res && !res.success)) {
        // Fallback standard anchor click
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      showToast(`Downloaded ${filename}!`);
    });
  }

  /**
   * Copy to Clipboard Pipeline
   */
  async function performClipboardCopy() {
    try {
      showToast('Copying JPG to clipboard...');
      const blob = await generateJpgBlob();
      
      // Convert to PNG for Clipboard API compatibility if needed
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
      showToast('Image copied to clipboard!');
    } catch (err) {
      // Fallback using PNG blob
      try {
        const crop = cropper.getCrop();
        const isCrop = exportTarget === 'crop';
        const renderW = isCrop ? crop.width : canvasWidth;
        const renderH = isCrop ? crop.height : canvasHeight;
        const srcX = isCrop ? crop.x : 0;
        const srcY = isCrop ? crop.y : 0;

        const offCanvas = document.createElement('canvas');
        offCanvas.width = renderW;
        offCanvas.height = renderH;
        const offCtx = offCanvas.getContext('2d');
        offCtx.fillStyle = selectedBgColor || '#ffffff';
        offCtx.fillRect(0, 0, renderW, renderH);
        offCtx.drawImage(compositeCanvas, srcX, srcY, renderW, renderH, 0, 0, renderW, renderH);

        offCanvas.toBlob(async (pngBlob) => {
          const item = new ClipboardItem({ 'image/png': pngBlob });
          await navigator.clipboard.write([item]);
          showToast('Image copied to clipboard!');
        }, 'image/png');
      } catch (copyErr) {
        console.error('Clipboard copy error:', copyErr);
        showToast('Clipboard access denied', true);
      }
    }
  }

  // Export Button Listeners
  btnDirectDownload.addEventListener('click', performDownload);
  btnCopyClipboard.addEventListener('click', performClipboardCopy);

  btnOpenExportPanel.addEventListener('click', () => {
    exportDialog.showModal();
  });

  btnCloseModal.addEventListener('click', () => exportDialog.close());
  btnModalCancel.addEventListener('click', () => exportDialog.close());
  btnModalDownload.addEventListener('click', () => {
    exportDialog.close();
    performDownload();
  });
  btnModalCopy.addEventListener('click', () => {
    exportDialog.close();
    performClipboardCopy();
  });

  /**
   * Toast helper
   */
  let toastTimer = null;
  function showToast(msg, isError = false) {
    toastMessage.textContent = msg;
    toastNotification.style.background = isError ? '#ef4444' : '#10b981';
    toastNotification.style.color = isError ? '#ffffff' : '#022c22';
    toastNotification.classList.remove('hidden');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastNotification.classList.add('hidden');
    }, 2800);
  }

  function showLoadingError(msg) {
    loadingOverlay.classList.remove('hidden');
    loadingStatusText.textContent = msg;
    loadingStatusText.style.color = '#ef4444';
    const spinner = loadingOverlay.querySelector('.spinner');
    if (spinner) spinner.style.display = 'none';
  }

  function sanitizeFilename(str) {
    return str.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').slice(0, 40);
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / 1048576).toFixed(2) + ' MB';
  }
});
