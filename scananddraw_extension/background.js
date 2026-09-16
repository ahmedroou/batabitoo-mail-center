// ScanAndDraw Background Service (Batabitoo Dual-Engine)

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['emailMode', 'currentIndex', 'totalRegs', 'isRunning'], (data) => {
    chrome.storage.local.set({
      emailMode: data.emailMode || 'temp', // Default: temp as requested
      currentIndex: data.currentIndex || 0,
      isRunning: data.isRunning || false,
      totalRegs: data.totalRegs || 200,
      lastRealEmail: ''
    });
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "GET_STATE") {
    chrome.storage.local.get(['emailMode', 'currentIndex', 'isRunning', 'totalRegs', 'lastRealEmail'], (data) => {
      sendResponse({
        emailMode: data.emailMode || 'temp',
        currentIndex: data.currentIndex || 0,
        total: data.totalRegs || 200,
        isRunning: data.isRunning || false,
        lastRealEmail: data.lastRealEmail || ''
      });
    });
    return true;
  }
  
  if (request.action === "START") {
    chrome.storage.local.set({ isRunning: true }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (request.action === "STOP") {
    chrome.storage.local.set({ isRunning: false }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "SUCCESS_NEXT") {
    chrome.storage.local.get(['currentIndex', 'isRunning', 'totalRegs'], (data) => {
      let nextIndex = (data.currentIndex || 0) + 1;
      let total = data.totalRegs || 200;
      
      if (nextIndex >= total) {
        chrome.storage.local.set({ isRunning: false, currentIndex: nextIndex });
        sendResponse({ finished: true, nextIndex });
        return;
      }

      chrome.storage.local.set({ 
        currentIndex: nextIndex,
        lastRealEmail: request.email || ''
      }, () => {
        sendResponse({ success: true, nextIndex });
      });
    });
    return true;
  }
});
