/**
 * WebShot - In-Page Content Script & Auto-Scroll Controller
 */

(() => {
  // Clean up any previous instance when re-injecting
  if (window.__webshot_controller) {
    window.__webshot_controller.teardown();
  }

  let isCapturing = false;
  let isPaused = false;
  let currentSession = null;
  let hudContainer = null;
  let hudShadowRoot = null;
  let originalScrollPos = { x: 0, y: 0 };
  let lastCapturedScrollY = -1;

  // Controller reference
  window.__webshot_controller = {
    startAutoScroll,
    stopAndOpenEditor,
    teardown
  };

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'INIT_AUTO_SCROLL':
        startAutoScroll(message.session);
        sendResponse({ success: true });
        break;

      case 'CAPTURE_COMPLETED':
      case 'TEARDOWN_HUD':
        teardown();
        sendResponse({ success: true });
        break;

      default:
        break;
    }
  });

  /**
   * Starts the auto-scroll capture workflow
   */
  async function startAutoScroll(session) {
    if (isCapturing) return;
    isCapturing = true;
    isPaused = false;
    currentSession = session;
    __mainScroller = null; // Clear cached scroller
    originalScrollPos = { x: window.scrollX || 0, y: getScrollTop() };
    lastCapturedScrollY = -1;

    // Inject floating HUD
    createFloatingHUD();

    // If visible mode, take 1 snapshot and stop immediately
    if (session.mode === 'visible') {
      await captureCurrentView(true);
      return;
    }

    // Scroll to the very top of document first and verify Y=0
    for (let t = 0; t < 10; t++) {
      performScroll(0);
      await waitForScroll();
      if (getScrollTop() === 0) break;
      await sleep(100);
    }
    await sleep(350); // Additional delay to ensure rendering of the top

    // Start auto-scroll capture loop
    runScrollCaptureLoop();
  }

  /**
   * Main auto-scroll capture loop
   */
  async function runScrollCaptureLoop() {
    let sliceIndex = 0;

    while (isCapturing) {
      // If paused, wait until resumed
      while (isPaused && isCapturing) {
        await sleep(150);
      }

      if (!isCapturing) break;

      // Hide HUD for clean screenshot frame
      hideHUD();
      await sleep(currentSession ? currentSession.delay : 300);

      // Read state AFTER the sleep so dynamic/lazy-loaded content is accounted for
      const docHeight = getDocHeight();
      const viewportHeight = window.innerHeight;
      const currentScrollY = getScrollTop();

      // On subsequent slices (sliceIndex > 0), hide floating sticky sidebars & fixed headers to prevent duplicate stamps
      if (sliceIndex > 0 && currentSession && currentSession.hideFixedElements !== false) {
        isolateStickyAndFixedElements();
      }

      // Trigger slice capture in background
      try {
        const captureResult = await sendBackgroundMessage({
          type: 'CAPTURE_SLICE',
          scrollX: window.scrollX || 0,
          scrollY: currentScrollY,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
          totalDocumentWidth: Math.max(
            document.body ? document.body.scrollWidth : 0,
            document.documentElement ? document.documentElement.scrollWidth : 0,
            window.innerWidth
          ),
          totalDocumentHeight: docHeight,
          pageTitle: document.title,
          pageUrl: window.location.href
        });

        lastCapturedScrollY = currentScrollY;

        // Restore HUD & DOM elements immediately after snapshot
        showHUD();
        restoreStickyAndFixedElements();

        if (!captureResult || !captureResult.success) {
          console.warn('Slice capture issue:', captureResult ? captureResult.error : 'Unknown');
        }

        sliceIndex++;
        updateHUDStats(sliceIndex, currentScrollY + viewportHeight);
      } catch (err) {
        showHUD();
        restoreStickyAndFixedElements();
        console.error('Error during slice capture:', err);
      }

      // Check if user clicked stop
      if (!isCapturing) break;

      // Check if we reached the bottom of document
      const atBottom = (currentScrollY + viewportHeight) >= (docHeight - 10);

      if (atBottom) {
        if (currentSession && currentSession.mode === 'full') {
          // Auto full-page mode finished!
          await sleep(250);
          await stopAndOpenEditor(false);
          break;
        } else {
          // Continuous mode at bottom: update HUD status
          setHUDBottomNotice();
          await sleep(1000);
          continue;
        }
      }

      // Scroll down by 65% of viewport height (guarantees generous 35% overlap so no items are cut off)
      const scrollStep = Math.max(100, Math.floor(viewportHeight * 0.65));
      const nextY = Math.min(currentScrollY + scrollStep, docHeight - viewportHeight);
      
      performScroll(nextY);
      await waitForScroll();
    }
  }

  let __mainScroller = null;

  function findMainScroller() {
    if (__mainScroller) return __mainScroller;

    const winHeight = window.innerHeight;
    let bestExplicitScroller = null;
    let maxExplicitScroll = 0;

    // Scan for explicitly defined scroll containers
    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.scrollHeight > el.clientHeight && el.clientHeight > 0) {
        try {
          const style = window.getComputedStyle(el);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay') {
            if (el.scrollHeight > maxExplicitScroll) {
              maxExplicitScroll = el.scrollHeight;
              bestExplicitScroller = el;
            }
          }
        } catch (e) {
          // Ignore
        }
      }
    }

    // If we found an explicit scroll container AND it occupies almost the entire screen,
    // it is almost certainly a Single Page App wrapper (e.g. #app on BestSecret).
    if (bestExplicitScroller && bestExplicitScroller.clientHeight >= winHeight * 0.75) {
      __mainScroller = bestExplicitScroller;
      return __mainScroller;
    }

    // Otherwise, default to standard document scrolling (e.g. GitHub, normal blogs).
    if (document.scrollingElement && document.scrollingElement.scrollHeight > winHeight) {
      __mainScroller = document.scrollingElement;
    } else if (document.body && document.body.scrollHeight > winHeight) {
      __mainScroller = document.body;
    } else {
      __mainScroller = document.documentElement;
    }

    return __mainScroller;
  }

  function getScrollTop() {
    const el = findMainScroller();
    if (el === document.documentElement || el === document.body || el === document.scrollingElement) {
      return Math.max(window.scrollY || 0, window.pageYOffset || 0, el.scrollTop);
    }
    return el.scrollTop;
  }

  function getDocHeight() {
    return Math.max(findMainScroller().scrollHeight, window.innerHeight);
  }

  function performScroll(y) {
    const el = findMainScroller();
    if (el === document.documentElement || el === document.body || el === document.scrollingElement) {
      window.scrollTo({ top: y, left: 0, behavior: 'instant' });
    }
    el.scrollTop = y;
  }

  async function waitForScroll() {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await sleep(120);
  }

  /**
   * Captures the visible area without scrolling
   */
  async function captureCurrentView(autoStop = true) {
    hideHUD();
    await sleep(200);

    await sendBackgroundMessage({
      type: 'CAPTURE_SLICE',
      scrollX: window.scrollX || 0,
      scrollY: getScrollTop(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      totalDocumentWidth: window.innerWidth,
      totalDocumentHeight: window.innerHeight,
      pageTitle: document.title,
      pageUrl: window.location.href
    });

    showHUD();
    if (autoStop) {
      await stopAndOpenEditor(false);
    }
  }

  /**
   * Finalizes capture and requests background to open editor tab
   */
  async function stopAndOpenEditor(captureCurrent = true) {
    if (!isCapturing && currentSession === null) return;
    const sessionToStop = currentSession;
    isCapturing = false;

    // Capture final viewport if not already captured
    const currentScrollY = getScrollTop();
    if (captureCurrent && Math.abs(currentScrollY - lastCapturedScrollY) > 20) {
      hideHUD();
      await sleep(150);

      try {
        await sendBackgroundMessage({
          type: 'CAPTURE_SLICE',
          scrollX: window.scrollX || 0,
          scrollY: currentScrollY,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
          totalDocumentWidth: Math.max(
            document.body ? document.body.scrollWidth : 0,
            document.documentElement ? document.documentElement.scrollWidth : 0,
            window.innerWidth
          ),
          totalDocumentHeight: getDocHeight(),
          pageTitle: document.title,
          pageUrl: window.location.href
        });
      } catch (e) {
        console.warn('Final slice note:', e);
      }
    }

    chrome.runtime.sendMessage({
      type: 'STOP_CAPTURE',
      sessionId: sessionToStop ? sessionToStop.id : null
    }, () => {
      teardown();
    });
  }

  /**
   * Cancels capture without saving
   */
  function cancelCapture() {
    isCapturing = false;
    chrome.runtime.sendMessage({
      type: 'CANCEL_CAPTURE'
    }, () => {
      teardown();
    });
  }

  /**
   * Toggles pause/resume
   */
  function togglePause() {
    isPaused = !isPaused;
    const btnPause = hudShadowRoot.querySelector('#btnPause');
    const pulseDot = hudShadowRoot.querySelector('#pulseDot');
    const statusText = hudShadowRoot.querySelector('#hudStatusText');

    if (isPaused) {
      if (btnPause) btnPause.textContent = '▶ Resume';
      if (pulseDot) pulseDot.classList.add('paused');
      if (statusText) statusText.textContent = 'Paused';
    } else {
      if (btnPause) btnPause.textContent = '⏸ Pause';
      if (pulseDot) pulseDot.classList.remove('paused');
      if (statusText) statusText.textContent = 'Capturing...';
    }
  }

  /**
   * Creates the modern floating HUD
   */
  function createFloatingHUD() {
    if (document.getElementById('webshot-hud-host')) return;

    hudContainer = document.createElement('div');
    hudContainer.id = 'webshot-hud-host';
    hudShadowRoot = hudContainer.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = `
      :host {
        all: initial;
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      }
      .hud-card {
        background: rgba(15, 23, 42, 0.94);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 14px;
        padding: 10px 16px;
        box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(99, 102, 241, 0.35);
        display: flex;
        align-items: center;
        gap: 14px;
        color: #f8fafc;
        user-select: none;
        transition: opacity 0.15s ease, transform 0.15s ease;
      }
      .hud-hidden {
        opacity: 0 !important;
        pointer-events: none !important;
      }
      .brand-box {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .pulse-dot {
        width: 10px;
        height: 10px;
        background: #10b981;
        border-radius: 50%;
        box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
        animation: pulse 1.4s infinite;
      }
      .pulse-dot.paused {
        background: #f59e0b;
        animation: none;
      }
      @keyframes pulse {
        0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
        70% { transform: scale(1.05); box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
        100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
      }
      .status-text {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: -0.2px;
      }
      .stats-badge {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.08);
        padding: 5px 10px;
        border-radius: 8px;
        font-size: 12px;
      }
      .stat-val {
        color: #38bdf8;
        font-weight: 700;
      }
      .btn-group {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      button {
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-family: inherit;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.15s ease;
        padding: 8px 14px;
        font-size: 13px;
        line-height: 1;
      }
      button:hover {
        transform: translateY(-1px);
      }
      button:active {
        transform: translateY(0);
      }
      .btn-stop {
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: #ffffff;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
      }
      .btn-stop:hover {
        box-shadow: 0 6px 18px rgba(16, 185, 129, 0.6);
      }
      .btn-secondary {
        background: rgba(255, 255, 255, 0.1);
        color: #cbd5e1;
        border: 1px solid rgba(255, 255, 255, 0.12);
      }
      .btn-secondary:hover {
        background: rgba(255, 255, 255, 0.16);
        color: #ffffff;
      }
      .btn-cancel {
        background: transparent;
        color: #94a3b8;
        padding: 8px;
      }
      .btn-cancel:hover {
        color: #ef4444;
        background: rgba(239, 68, 68, 0.12);
      }
      .kbd-badge {
        font-size: 10px;
        background: rgba(0, 0, 0, 0.4);
        padding: 2px 4px;
        border-radius: 4px;
        color: #a5b4fc;
        margin-left: 2px;
      }
    `;

    const hudEl = document.createElement('div');
    hudEl.className = 'hud-card';
    hudEl.id = 'hudCard';
    hudEl.innerHTML = `
      <div class="brand-box">
        <div class="pulse-dot" id="pulseDot"></div>
        <span class="status-text" id="hudStatusText">Capturing...</span>
      </div>

      <div class="stats-badge">
        <span>Slices: <span class="stat-val" id="statFrames">1</span></span>
        <span>•</span>
        <span><span class="stat-val" id="statHeight">0</span> px</span>
      </div>

      <div class="btn-group">
        <button class="btn-stop" id="btnStop" title="Finish and open editor (or press Esc)">
          <span>Stop & Edit</span>
          <span class="kbd-badge">Esc</span>
        </button>
        <button class="btn-secondary" id="btnPause" title="Pause or resume auto-scrolling">
          ⏸ Pause
        </button>
        <button class="btn-cancel" id="btnCancel" title="Cancel capture">
          ✕
        </button>
      </div>
    `;

    hudShadowRoot.appendChild(styleEl);
    hudShadowRoot.appendChild(hudEl);
    document.body.appendChild(hudContainer);

    // Bind HUD events
    hudShadowRoot.querySelector('#btnStop').addEventListener('click', () => stopAndOpenEditor(true));
    hudShadowRoot.querySelector('#btnPause').addEventListener('click', togglePause);
    hudShadowRoot.querySelector('#btnCancel').addEventListener('click', cancelCapture);

    // Keyboard shortcuts
    window.addEventListener('keydown', handleGlobalKeydown, true);
  }

  function handleGlobalKeydown(e) {
    if (!isCapturing) return;
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      stopAndOpenEditor(true);
    } else if (e.code === 'Space' && document.activeElement === document.body) {
      e.preventDefault();
      togglePause();
    }
  }

  function updateHUDStats(frames, height) {
    if (!hudShadowRoot) return;
    const statFrames = hudShadowRoot.querySelector('#statFrames');
    const statHeight = hudShadowRoot.querySelector('#statHeight');
    if (statFrames) statFrames.textContent = frames;
    if (statHeight) statHeight.textContent = Math.round(height).toLocaleString();
  }

  function setHUDBottomNotice() {
    if (!hudShadowRoot) return;
    const statusText = hudShadowRoot.querySelector('#hudStatusText');
    if (statusText) statusText.textContent = 'End of page reached • Click Stop & Edit';
  }

  function hideHUD() {
    if (hudShadowRoot) {
      const card = hudShadowRoot.querySelector('#hudCard');
      if (card) card.classList.add('hud-hidden');
    }
  }

  function showHUD() {
    if (hudShadowRoot) {
      const card = hudShadowRoot.querySelector('#hudCard');
      if (card) card.classList.remove('hud-hidden');
    }
  }

  let modifiedStickyFixedElements = [];

  /**
   * Hides floating sticky sidebars and fixed floating bars for subsequent frames
   * using non-destructive visibility hiding (zero layout shifts, zero DOM reflows).
   */
  function isolateStickyAndFixedElements() {
    restoreStickyAndFixedElements();
    modifiedStickyFixedElements = [];

    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el === hudContainer || (hudContainer && hudContainer.contains(el))) continue;

      try {
        const style = window.getComputedStyle(el);
        const pos = style.position;

        if (pos === 'sticky' || pos === 'fixed') {
          const rect = el.getBoundingClientRect();
          // Hide if element is currently floating or pinned in the viewport
          if (rect.height > 0 && rect.width > 0 && rect.top < 250) {
            modifiedStickyFixedElements.push({
              element: el,
              origVisibility: el.style.visibility
            });
            el.style.setProperty('visibility', 'hidden', 'important');
          }
        }
      } catch (err) {
        // Cross-origin CSS protection
      }
    }
  }

  /**
   * Restores original visibility of modified elements
   */
  function restoreStickyAndFixedElements() {
    for (let i = 0; i < modifiedStickyFixedElements.length; i++) {
      const item = modifiedStickyFixedElements[i];
      if (item.origVisibility) {
        item.element.style.visibility = item.origVisibility;
      } else {
        item.element.style.removeProperty('visibility');
      }
    }
    modifiedStickyFixedElements = [];
  }

  function teardown() {
    isCapturing = false;
    isPaused = false;
    restoreStickyAndFixedElements();
    window.removeEventListener('keydown', handleGlobalKeydown, true);

    if (hudContainer && hudContainer.parentNode) {
      hudContainer.parentNode.removeChild(hudContainer);
    }
    hudContainer = null;
    hudShadowRoot = null;
    window.__webshot_injected = false;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function sendBackgroundMessage(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: true });
        }
      });
    });
  }
})();
