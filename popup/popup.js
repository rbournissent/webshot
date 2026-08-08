/**
 * WebShot - Popup Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  const modeCards = document.querySelectorAll('.mode-card');
  const scrollDelaySelect = document.getElementById('scrollDelay');
  const toggleHideFixed = document.getElementById('toggleHideFixed');
  const btnStartCapture = document.getElementById('btnStartCapture');
  const btnQuickStop = document.getElementById('btnQuickStop');
  const activeBanner = document.getElementById('activeBanner');
  const errorMessage = document.getElementById('errorMessage');

  let selectedMode = 'continuous';

  // Load saved preferences
  chrome.storage.local.get(['pref_mode', 'pref_delay', 'pref_hide_fixed'], (data) => {
    if (data.pref_mode) {
      selectedMode = data.pref_mode;
      updateActiveCard(selectedMode);
    }
    if (data.pref_delay) {
      scrollDelaySelect.value = data.pref_delay;
    }
    if (data.pref_hide_fixed !== undefined) {
      toggleHideFixed.checked = data.pref_hide_fixed;
    }
  });

  // Check if active tab currently has a capture running
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_STATUS', tabId: tab.id }, (res) => {
      if (res && res.isCapturing) {
        activeBanner.classList.remove('hidden');
        btnStartCapture.querySelector('#btnLabel').textContent = 'Capturing... (Click to Stop)';
      }
    });
  }

  // Mode Selection
  modeCards.forEach((card) => {
    card.addEventListener('click', () => {
      selectedMode = card.dataset.mode;
      updateActiveCard(selectedMode);
      chrome.storage.local.set({ pref_mode: selectedMode });
    });
  });

  function updateActiveCard(mode) {
    modeCards.forEach((c) => {
      const radio = c.querySelector('input[type="radio"]');
      if (c.dataset.mode === mode) {
        c.classList.add('active');
        if (radio) radio.checked = true;
      } else {
        c.classList.remove('active');
        if (radio) radio.checked = false;
      }
    });
  }

  // Settings change listeners
  scrollDelaySelect.addEventListener('change', () => {
    chrome.storage.local.set({ pref_delay: parseInt(scrollDelaySelect.value, 10) });
  });

  toggleHideFixed.addEventListener('change', () => {
    chrome.storage.local.set({ pref_hide_fixed: toggleHideFixed.checked });
  });

  // Quick stop button
  btnQuickStop.addEventListener('click', async () => {
    if (tab && tab.id) {
      chrome.runtime.sendMessage({ type: 'STOP_CAPTURE', tabId: tab.id }, (res) => {
        window.close();
      });
    }
  });

  // Start Capture Trigger
  btnStartCapture.addEventListener('click', async () => {
    hideError();
    btnStartCapture.disabled = true;
    btnStartCapture.style.opacity = '0.7';

    try {
      const delay = parseInt(scrollDelaySelect.value, 10) || 350;
      const hideFixed = toggleHideFixed.checked;

      chrome.runtime.sendMessage({
        type: 'START_CAPTURE',
        tabId: tab.id,
        mode: selectedMode,
        delay: delay,
        hideFixedElements: hideFixed
      }, (res) => {
        if (chrome.runtime.lastError) {
          showError(chrome.runtime.lastError.message);
          btnStartCapture.disabled = false;
          btnStartCapture.style.opacity = '1';
          return;
        }

        if (res && !res.success) {
          showError(res.error || 'Failed to initialize capture session.');
          btnStartCapture.disabled = false;
          btnStartCapture.style.opacity = '1';
          return;
        }

        // Capture started successfully! Close popup so webpage HUD is visible
        window.close();
      });
    } catch (err) {
      showError(err.message);
      btnStartCapture.disabled = false;
      btnStartCapture.style.opacity = '1';
    }
  });

  function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.classList.remove('hidden');
  }

  function hideError() {
    errorMessage.textContent = '';
    errorMessage.classList.add('hidden');
  }
});
