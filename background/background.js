/**
 * WebShot - Background Service Worker (Manifest V3)
 * Orchestrates visible tab frame captures, session management, and editor launch.
 */

// Active capture sessions keyed by tabId
const captureSessions = new Map();

// Helper to get active tab
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Listen for keyboard command shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-capture') {
    const tab = await getActiveTab();
    if (tab && tab.id) {
      if (captureSessions.has(tab.id)) {
        await stopCaptureSession(tab.id);
      } else {
        await startCaptureSession(tab.id, { mode: 'continuous', speed: 'normal', delay: 350 });
      }
    }
  }
});

// Message router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : message.tabId;

  switch (message.type) {
    case 'START_CAPTURE':
      handleStartCapture(message, sendResponse);
      return true; // async response

    case 'CAPTURE_SLICE':
      handleCaptureSlice(sender.tab, message, sendResponse);
      return true; // async response

    case 'STOP_CAPTURE':
      handleStopCapture(tabId, message, sendResponse);
      return true; // async response

    case 'CANCEL_CAPTURE':
      handleCancelCapture(tabId, sendResponse);
      return true;

    case 'GET_SESSION_DATA':
      handleGetSessionData(message.sessionId, sendResponse);
      return true;

    case 'DOWNLOAD_IMAGE':
      handleDownloadImage(message, sendResponse);
      return true;

    case 'GET_ACTIVE_STATUS':
      sendResponse({ isCapturing: captureSessions.has(tabId) });
      return false;

    default:
      sendResponse({ status: 'unknown_command' });
      return false;
  }
});

/**
 * Initiates a new capture session
 */
async function handleStartCapture(options, sendResponse) {
  try {
    let tab;
    if (options.tabId) {
      tab = await chrome.tabs.get(options.tabId);
    } else {
      tab = await getActiveTab();
    }

    if (!tab || !tab.id) {
      sendResponse({ success: false, error: 'No active tab found.' });
      return;
    }

    // Check if target is a restricted chrome:// or edge:// url
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
      sendResponse({
        success: false,
        error: 'Chrome extensions cannot capture internal browser pages (chrome://). Please test on a standard website.'
      });
      return;
    }

    // Inject content scripts dynamically to ensure they are active
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['content/content.css']
      });
    } catch (e) {
      console.warn('CSS insertion notice:', e);
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/content.js']
      });
    } catch (e) {
      console.warn('Script execution notice:', e);
    }

    const sessionId = 'webshot_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const session = {
      id: sessionId,
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url,
      title: tab.title || 'webshot-capture',
      startTime: Date.now(),
      mode: options.mode || 'continuous', // 'continuous' | 'full' | 'visible'
      speed: options.speed || 'normal',
      delay: options.delay || 350,
      hideFixedElements: options.hideFixedElements ?? true,
      slices: [],
      metadata: {}
    };

    captureSessions.set(tab.id, session);

    // Send start signal to content script
    chrome.tabs.sendMessage(tab.id, {
      type: 'INIT_AUTO_SCROLL',
      session: {
        id: session.id,
        mode: session.mode,
        speed: session.speed,
        delay: session.delay,
        hideFixedElements: session.hideFixedElements
      }
    }, (res) => {
      if (chrome.runtime.lastError) {
        console.warn('Could not contact content script:', chrome.runtime.lastError.message);
      }
    });

    sendResponse({ success: true, sessionId: session.id });
  } catch (err) {
    console.error('Error starting capture:', err);
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Captures a single visible tab slice
 */
async function handleCaptureSlice(tab, sliceMeta, sendResponse) {
  if (!tab || !tab.id) {
    sendResponse({ success: false, error: 'Invalid tab' });
    return;
  }

  const session = captureSessions.get(tab.id);
  if (!session) {
    sendResponse({ success: false, error: 'Session not found or already stopped' });
    return;
  }

  try {
    // Capture the visible viewport as PNG DataURL
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

    const slice = {
      index: session.slices.length,
      dataUrl: dataUrl,
      scrollX: sliceMeta.scrollX,
      scrollY: sliceMeta.scrollY,
      viewportWidth: sliceMeta.viewportWidth,
      viewportHeight: sliceMeta.viewportHeight,
      devicePixelRatio: sliceMeta.devicePixelRatio || 1,
      totalDocumentWidth: sliceMeta.totalDocumentWidth,
      totalDocumentHeight: sliceMeta.totalDocumentHeight,
      timestamp: Date.now()
    };

    session.slices.push(slice);
    session.metadata = {
      documentWidth: sliceMeta.totalDocumentWidth,
      documentHeight: sliceMeta.totalDocumentHeight,
      viewportWidth: sliceMeta.viewportWidth,
      viewportHeight: sliceMeta.viewportHeight,
      devicePixelRatio: sliceMeta.devicePixelRatio || 1,
      pageTitle: sliceMeta.pageTitle || session.title,
      pageUrl: sliceMeta.pageUrl || session.url
    };

    sendResponse({
      success: true,
      sliceIndex: slice.index,
      totalSlices: session.slices.length
    });
  } catch (err) {
    console.error('CaptureVisibleTab error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Stops capture session and launches the editor tab
 */
async function handleStopCapture(tabId, message, sendResponse) {
  const session = captureSessions.get(tabId);
  if (!session) {
    // Maybe sessionId was passed directly
    if (message && message.sessionId) {
      for (const [id, s] of captureSessions.entries()) {
        if (s.id === message.sessionId) {
          await finalizeSession(id, s);
          sendResponse({ success: true, sessionId: s.id });
          return;
        }
      }
    }
    sendResponse({ success: false, error: 'No active session to stop.' });
    return;
  }

  try {
    await finalizeSession(tabId, session);
    sendResponse({ success: true, sessionId: session.id });
  } catch (err) {
    console.error('Error finalizing session:', err);
    sendResponse({ success: false, error: err.message });
  }
}

async function finalizeSession(tabId, session) {
  // Store session in chrome.storage.local (and IndexedDB via editor window)
  const sessionKey = 'session_' + session.id;
  
  // Clean up session from active map
  captureSessions.delete(tabId);

  // Notify content script to remove HUD overlay
  try {
    chrome.tabs.sendMessage(tabId, { type: 'CAPTURE_COMPLETED' });
  } catch (e) {
    // ignore if tab closed
  }

  // Save session payload to local storage
  const storageData = {};
  storageData[sessionKey] = {
    id: session.id,
    url: session.url,
    title: session.title,
    slices: session.slices,
    metadata: session.metadata,
    created: Date.now()
  };

  await chrome.storage.local.set(storageData);

  // Open the editor in a new tab
  const editorUrl = chrome.runtime.getURL(`editor/editor.html?session=${session.id}`);
  await chrome.tabs.create({ url: editorUrl });
}

/**
 * Cancels active capture
 */
function handleCancelCapture(tabId, sendResponse) {
  if (captureSessions.has(tabId)) {
    captureSessions.delete(tabId);
  }
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { type: 'TEARDOWN_HUD' }, () => {
      if (chrome.runtime.lastError) { /* ignore */ }
    });
  }
  sendResponse({ success: true });
}

/**
 * Retrieve session payload for Editor
 */
async function handleGetSessionData(sessionId, sendResponse) {
  if (!sessionId) {
    sendResponse({ success: false, error: 'No sessionId provided' });
    return;
  }

  const sessionKey = 'session_' + sessionId;
  const data = await chrome.storage.local.get([sessionKey]);

  if (data && data[sessionKey]) {
    sendResponse({ success: true, session: data[sessionKey] });
  } else {
    sendResponse({ success: false, error: 'Session data not found or expired' });
  }
}

/**
 * Download file via chrome.downloads
 */
async function handleDownloadImage(message, sendResponse) {
  try {
    const downloadId = await chrome.downloads.download({
      url: message.dataUrl,
      filename: message.filename || 'webshot-export.jpg',
      saveAs: message.saveAs ?? false
    });
    sendResponse({ success: true, downloadId });
  } catch (err) {
    console.error('Download error:', err);
    sendResponse({ success: false, error: err.message });
  }
}
