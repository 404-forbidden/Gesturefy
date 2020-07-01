import {
  isURL,
  isHTTPURL,
  isLegalURL,
  sanitizeFilename,
  dataURItoBlob,
  displayNotification
} from "/core/commons.js";

/*
 * Commands
 */

export function DuplicateTab (sender, data) {
  let index;

  switch (this.getSetting("position")) {
    case "before":
      index = sender.tab.index;
    break;
    case "after":
      index = sender.tab.index + 1;
    break;
    case "start":
      index = 0;
    break;
    case "end":
      index = Number.MAX_SAFE_INTEGER;
    break;
    default:
      index = null;
    break;    
  }

  browser.tabs.duplicate(sender.tab.id, {
    active: this.getSetting("focus"),
    index: index
  });
}


export function NewTab (sender, data) {
  let index;

  switch (this.getSetting("position")) {
    case "before":
      index = sender.tab.index;
    break;
    case "after":
      index = sender.tab.index + 1;
    break;
    case "start":
      index = 0;
    break;
    case "end":
      index = Number.MAX_SAFE_INTEGER;
    break;
    default:
      index = null;
    break;    
  }

  browser.tabs.create({
    active: this.getSetting("focus"),
    index: index
  })
}


export function CloseTab (sender, data) {
  // remove tab if not pinned or remove-pinned-tabs option is enabled
  if (this.getSetting("closePinned") || !sender.tab.pinned) {
    const queryTabs = browser.tabs.query({
      windowId: sender.tab.windowId,
      active: false,
      hidden: false
    });
    queryTabs.then((tabs) => {
      // if there are other tabs to focus
      if (tabs.length > 0) {
        let nextTab = null;
        if (this.getSetting("nextFocus") === "next") {
          // get closest tab to the right or the closest tab to the left
          nextTab = tabs.reduce((acc, cur) =>
            (acc.index <= sender.tab.index && cur.index > acc.index) || (cur.index > sender.tab.index && cur.index < acc.index) ? cur : acc
          );
        }
        else if (this.getSetting("nextFocus") === "previous") {
          // get closest tab to the left or the closest tab to the right
          nextTab = tabs.reduce((acc, cur) =>
            (acc.index >= sender.tab.index && cur.index < acc.index) || (cur.index < sender.tab.index && cur.index > acc.index) ? cur : acc
          );
        }
        // get the previous tab
        else if (this.getSetting("nextFocus") === "recent") {
          nextTab = tabs.reduce((acc, cur) => acc.lastAccessed > cur.lastAccessed ? acc : cur);
        }
        if (nextTab) browser.tabs.update(nextTab.id, { active: true });
      }
      browser.tabs.remove(sender.tab.id);
    });
  }
}


export function CloseRightTabs (sender, data) {
  const queryTabs = browser.tabs.query({
    currentWindow: true,
    pinned: false,
    hidden: false
  });
  queryTabs.then((tabs) => {
    // filter all tabs to the right
    tabs = tabs.filter((tab) => tab.index > sender.tab.index);
    // create array of tap ids
    tabs = tabs.map((tab) => tab.id);
    browser.tabs.remove(tabs);
  });
}


export function CloseLeftTabs (sender, data) {
  const queryTabs = browser.tabs.query({
    currentWindow: true,
    pinned: false,
    hidden: false
  });
  queryTabs.then((tabs) => {
    // filter all tabs to the left
    tabs = tabs.filter((tab) => tab.index < sender.tab.index);
    // create array of tap ids
    tabs = tabs.map((tab) => tab.id);
    browser.tabs.remove(tabs);
  });
}


export function CloseOtherTabs (sender, data) {
  const queryTabs = browser.tabs.query({
    currentWindow: true,
    pinned: false,
    active: false,
    hidden: false
  });
  queryTabs.then((tabs) => {
    // create array of tap ids
    tabs = tabs.map((tab) => tab.id);
    browser.tabs.remove(tabs);
  });
}


export function RestoreTab (sender, data) {
  const queryClosedTabs = browser.sessions.getRecentlyClosed();
  queryClosedTabs.then((sessions) => {
    // exclude windows and tabs from different windows
    if (this.getSetting("currentWindowOnly")) {
      sessions = sessions.filter((session) => {
        return session.tab && session.tab.windowId === sender.tab.windowId;
      });
    }
    if (sessions.length > 0) {
      const mostRecently = sessions.reduce((prev, cur) => prev.lastModified > cur.lastModified ? prev : cur);
      const sessionId = mostRecently.tab ? mostRecently.tab.sessionId : mostRecently.window.sessionId;
      browser.sessions.restore(sessionId);
    }
  });
}


export function ReloadTab (sender, data) {
  browser.tabs.reload(sender.tab.id, { bypassCache: this.getSetting("cache") });
}


export function StopLoading (sender, data) {
  browser.tabs.executeScript(sender.tab.id, {
    code: 'window.stop()',
    runAt: 'document_start'
  });
}


export function ReloadFrame (sender, data) {
  if (sender.frameId) browser.tabs.executeScript(sender.tab.id, {
    code: `window.location.reload(${this.getSetting("cache")})`,
    runAt: 'document_start',
    frameId: sender.frameId
  });
}


export function ReloadAllTabs (sender, data) {
  const queryTabs = browser.tabs.query({
    currentWindow: true,
    hidden: false
  });
  queryTabs.then((tabs) => {
    for (let tab of tabs)
      browser.tabs.reload(tab.id, { bypassCache: this.getSetting("cache") });
  });
}


export function ZoomIn (sender, data) {
  const zoomSetting = this.getSetting("step");
  // try to get single number
  const zoomStep = Number(zoomSetting);
  // array of default zoom levels
  let zoomLevels = [.3, .5, .67, .8, .9, 1, 1.1, 1.2, 1.33, 1.5, 1.7, 2, 2.4, 3];
  // maximal zoom level
  let maxZoom = 3;

  // if no zoom step value exists and string contains comma, assume a list of zoom levels
  if (!zoomStep && zoomSetting && zoomSetting.includes(",")) {
    // get and override default zoom levels
    zoomLevels = zoomSetting.split(",").map(z => parseFloat(z)/100);
    // get and override max zoom boundary but cap it to 300%
    maxZoom = Math.min(Math.max(...zoomLevels), maxZoom);
  }

  const queryZoom = browser.tabs.getZoom(sender.tab.id);
  queryZoom.then((currentZoom) => {
    let zoom = currentZoom;
    if (zoomStep) {
      zoom = Math.min(maxZoom, zoom + zoomStep/100);
    }
    else {
      zoom = zoomLevels.reduce((acc, cur) => cur > zoom && cur < acc ? cur : acc, maxZoom);
    }
    if (zoom > currentZoom) browser.tabs.setZoom(sender.tab.id, zoom);
  });
}


export function ZoomOut (sender, data) {
  const zoomSetting = this.getSetting("step");
  // try to get single number
  const zoomStep = Number(zoomSetting);
  // array of default zoom levels
  let zoomLevels = [3, 2.4, 2, 1.7, 1.5, 1.33, 1.2, 1.1, 1, .9, .8, .67, .5, .3];
  // minimal zoom level
  let minZoom = .3;

  // if no zoom step value exists and string contains comma, assume a list of zoom levels
  if (!zoomStep && zoomSetting && zoomSetting.includes(",")) {
    // get and override default zoom levels
    zoomLevels = zoomSetting.split(",").map(z => parseFloat(z)/100);
    // get min zoom boundary but cap it to 30%
    minZoom = Math.max(Math.min(...zoomLevels), minZoom);
  }

  const queryZoom = browser.tabs.getZoom(sender.tab.id);
  queryZoom.then((currentZoom) => {
    let zoom = currentZoom;
    if (zoomStep) {
      zoom = Math.max(minZoom, zoom - zoomStep/100);
    }
    else {
      zoom = zoomLevels.reduce((acc, cur) => cur < zoom && cur > acc ? cur : acc, minZoom);
    }
    if (zoom < currentZoom) browser.tabs.setZoom(sender.tab.id, zoom);
  });
}


export function ZoomReset (sender, data) {
  browser.tabs.setZoom(sender.tab.id, 1);
}


export function PageBack (sender, data) {
  browser.tabs.goBack(sender.tab.id);
}


export function PageForth (sender, data) {
  browser.tabs.goForward(sender.tab.id);
}


// reverts the action if already pinned
export function TogglePin (sender, data) {
  browser.tabs.update(sender.tab.id, { pinned: !sender.tab.pinned });
}


// reverts the action if already muted
export function ToggleMute (sender, data) {
  browser.tabs.update(sender.tab.id, { muted: !sender.tab.mutedInfo.muted });
}


// reverts the action if already bookmarked
export function ToggleBookmark (sender, data) {
  const queryBookmarks = browser.bookmarks.search({
    url: sender.tab.url
  });
  queryBookmarks.then((bookmarks) => {
    if (bookmarks.length > 0)
      browser.bookmarks.remove(bookmarks[0].id)
    else browser.bookmarks.create({
      url: sender.tab.url,
      title: sender.tab.title
    });
  });
}


// reverts the action if already pinned
export function ToggleReaderMode (sender, data) {
  browser.tabs.toggleReaderMode(sender.tab.id);
}


export function ScrollTop (sender, data) {
  // returns true if there exist a scrollable element in the injected frame else false
  const runScroll = browser.tabs.executeScript(sender.tab.id, {
    code: `{
      const element = getClosestElement(TARGET, isScrollableY);
      if (element) scrollToY(0, ${this.getSetting("duration")}, element);
      !!element;
    }`,
    runAt: 'document_start',
    frameId: sender.frameId || 0
  });

  // if there was no scrollable element and the gesture was triggered from a frame
  // try scrolling the main scrollbar of the main frame
  runScroll.then((results) => {
    if (!results[0] && sender.frameId !== 0) {
      browser.tabs.executeScript(sender.tab.id, {
        code: `{
          const element = document.scrollingElement;
          if (isScrollableY(element)) {
            scrollToY(0, ${this.getSetting("duration")}, element);
          }
        }`,
        runAt: 'document_start',
        frameId: 0
      });
    }
  });
}


export function ScrollBottom (sender, data) {
  // returns true if there exist a scrollable element in the injected frame else false
  const runScroll = browser.tabs.executeScript(sender.tab.id, {
    code: `{
      const element = getClosestElement(TARGET, isScrollableY);
      if (element) scrollToY(element.scrollHeight - element.clientHeight, ${this.getSetting("duration")}, element);
      !!element;
    }`,
    runAt: 'document_start',
    frameId: sender.frameId || 0
  });

  // if there was no scrollable element and the gesture was triggered from a frame
  // try scrolling the main scrollbar of the main frame
  runScroll.then((results) => {
    if (!results[0] && sender.frameId !== 0) {
      browser.tabs.executeScript(sender.tab.id, {
        code: `{
          const element = document.scrollingElement;
          if (isScrollableY(element)) {
            scrollToY(element.scrollHeight - element.clientHeight, ${this.getSetting("duration")}, element);
          }
        }`,
        runAt: 'document_start',
        frameId: 0
      });
    }
  });
}


export function ScrollPageDown (sender, data) {
  // returns true if there exist a scrollable element in the injected frame else false
  const runScroll = browser.tabs.executeScript(sender.tab.id, {
    code: `{
      const element = getClosestElement(TARGET, isScrollableY);
      if (element) scrollToY(element.scrollTop + element.clientHeight * 0.95, ${this.getSetting("duration")}, element);
      !!element;
    }`,
    runAt: 'document_start',
    frameId: sender.frameId || 0
  });

  // if there was no scrollable element and the gesture was triggered from a frame
  // try scrolling the main scrollbar of the main frame
  runScroll.then((results) => {
    if (!results[0] && sender.frameId !== 0) {
      browser.tabs.executeScript(sender.tab.id, {
        code: `{
          const element = document.scrollingElement;
          if (isScrollableY(element)) {
            scrollToY(element.scrollTop + element.clientHeight * 0.95, ${this.getSetting("duration")}, element);
          }
        }`,
        runAt: 'document_start',
        frameId: 0
      });
    }
  });
}


export function ScrollPageUp (sender, data) {
  // returns true if there exist a scrollable element in the injected frame else false
  const runScroll = browser.tabs.executeScript(sender.tab.id, {
    code: `{
      const element = getClosestElement(TARGET, isScrollableY);
      if (element) scrollToY(element.scrollTop - element.clientHeight * 0.95, ${this.getSetting("duration")}, element);
      !!element;
    }`,
    runAt: 'document_start',
    frameId: sender.frameId || 0
  });

  // if there was no scrollable element and the gesture was triggered from a frame
  // try scrolling the main scrollbar of the main frame
  runScroll.then((results) => {
    if (!results[0] && sender.frameId !== 0) {
      browser.tabs.executeScript(sender.tab.id, {
        code: `{
          const element = document.scrollingElement;
          if (isScrollableY(element)) {
            scrollToY(element.scrollTop - element.clientHeight * 0.95, ${this.getSetting("duration")}, element);
          }
        }`,
        runAt: 'document_start',
        frameId: 0
      });
    }
  });
}


export function FocusRightTab (sender, data) {
  const queryInfo = {
    currentWindow: true,
    active: false,
    hidden: false
  }

  if (this.getSetting("excludeDiscarded")) queryInfo.discarded = false;

  const queryTabs = browser.tabs.query(queryInfo);
  queryTabs.then((tabs) => {
    let nextTab;
    // if there is at least one tab to the right of the current
    if (tabs.some(cur => cur.index > sender.tab.index)) {
      // get closest tab to the right or the closest tab to the left
      nextTab = tabs.reduce((acc, cur) =>
        (acc.index <= sender.tab.index && cur.index > acc.index) || (cur.index > sender.tab.index && cur.index < acc.index) ? cur : acc
      );
    }
    // get the most left tab if tab cycling is activated 
    else if (this.getSetting("cycling")) {
      nextTab = tabs.reduce((acc, cur) => acc.index < cur.index ? acc : cur);
    }
    // focus next tab if available
    if (nextTab) browser.tabs.update(nextTab.id, { active: true });
  });
}


export function FocusLeftTab (sender, data) {
  const queryInfo = {
    currentWindow: true,
    active: false,
    hidden: false
  }

  if (this.getSetting("excludeDiscarded")) queryInfo.discarded = false;

  const queryTabs = browser.tabs.query(queryInfo);
  queryTabs.then((tabs) => {
    let nextTab;
    // if there is at least one tab to the left of the current
    if (tabs.some(cur => cur.index < sender.tab.index)) {
      // get closest tab to the left or the closest tab to the right
      nextTab = tabs.reduce((acc, cur) =>
        (acc.index >= sender.tab.index && cur.index < acc.index) || (cur.index < sender.tab.index && cur.index > acc.index) ? cur : acc
      );
    }
    // else get most right tab if tab cycling is activated 
    else if (this.getSetting("cycling")) {
      nextTab = tabs.reduce((acc, cur) => acc.index > cur.index ? acc : cur);
    }
    // focus next tab if available
    if (nextTab) browser.tabs.update(nextTab.id, { active: true });
  });
}


export function FocusFirstTab (sender, data) {
  const queryInfo = {
    currentWindow: true,
    hidden: false
  };
  if (!this.getSetting("includePinned")) queryInfo.pinned = false;

  const queryTabs = browser.tabs.query(queryInfo);
  queryTabs.then((tabs) => {
    const firstTab = tabs.reduce((acc, cur) => acc.index < cur.index ? acc : cur);
    browser.tabs.update(firstTab.id, { active: true });
  });
}


export function FocusLastTab (sender, data) {
  const queryTabs = browser.tabs.query({
    currentWindow: true,
    hidden: false
  });
  queryTabs.then((tabs) => {
    const lastTab = tabs.reduce((acc, cur) => acc.index > cur.index ? acc : cur);
    browser.tabs.update(lastTab.id, { active: true });
  });
}


export function FocusPreviousSelectedTab (sender, data) {
  const queryTabs = browser.tabs.query({
    active: false,
    hidden: false
  });
  queryTabs.then((tabs) => {
    if (tabs.length > 0) {
      const lastAccessedTab = tabs.reduce((acc, cur) => acc.lastAccessed > cur.lastAccessed ? acc : cur);
      browser.tabs.update(lastAccessedTab.id, { active: true });
    }
  });
}


export function MaximizeWindow (sender, data) {
  const queryWindow = browser.windows.getCurrent();
  queryWindow.then((win) => {
    browser.windows.update(win.id, {
      state: 'maximized'
    });
  });
}


export function MinimizeWindow (sender, data) {
  const queryWindow = browser.windows.getCurrent();
  queryWindow.then((win) => {
    browser.windows.update(win.id, {
      state: 'minimized'
    });
  });
}


export function ToggleWindowSize (sender, data) {
  const queryWindow = browser.windows.getCurrent();
  queryWindow.then((win) => {
    if (win.state === 'maximized') browser.windows.update(win.id, {
        state: 'normal'
    });
    else browser.windows.update(win.id, {
        state: 'maximized'
    });
  });
}


// maximizes the window if it is already in full screen mode
export function ToggleFullscreen (sender, data) {
  const queryWindow = browser.windows.getCurrent();
  queryWindow.then((win) => {
    if (win.state === 'fullscreen') browser.windows.update(win.id, {
      state: 'maximized'
    });
    else browser.windows.update(win.id, {
      state: 'fullscreen'
    });
  });
}


export function NewWindow (sender, data) {
  browser.windows.create({});
}


export function NewPrivateWindow (sender, data) {
  const createPrivateWindow = browser.windows.create({
    incognito: true
  });
  createPrivateWindow.catch((error) => {
    if (error.message === 'Extension does not have permission for incognito mode') displayNotification(
      browser.i18n.getMessage('commandErrorNotificationTitle', browser.i18n.getMessage("commandLabelNewPrivateWindow")),
      browser.i18n.getMessage('commandErrorNotificationMessageMissingIncognitoPermissions'),
      "https://github.com/Robbendebiene/Gesturefy/wiki/Missing-incognito-permission"
    );
  });
}


export function MoveTabToStart (sender, data) {
  // query pinned tabs if current tab is pinned or vice versa
  const queryTabs = browser.tabs.query({
    currentWindow: true,
    pinned: sender.tab.pinned,
    hidden: false
  });
  queryTabs.then((tabs) => {
    const mostLeftTab = tabs.reduce((acc, cur) => cur.index < acc.index ? cur : acc);
    browser.tabs.move(sender.tab.id, {
      index: mostLeftTab.index
    });
  });
}


export function MoveTabToEnd (sender, data) {
  // query pinned tabs if current tab is pinned or vice versa
  const queryTabs = browser.tabs.query({
    currentWindow: true,
    pinned: sender.tab.pinned,
    hidden: false
  });
  queryTabs.then((tabs) => {
    const mostRightTab = tabs.reduce((acc, cur) => cur.index > acc.index ? cur : acc);
    browser.tabs.move(sender.tab.id, {
      index: mostRightTab.index + 1
    });
  });
}


export function MoveTabToNewWindow (sender, data) {
  browser.windows.create({
    tabId: sender.tab.id
  });
}


export function MoveRightTabsToNewWindow (sender, data) {
  const queryProperties = {
    currentWindow: true,
    pinned: false,
    hidden: false
  };
  // exclude current tab if specified
  if (!this.getSetting("includeCurrent")) queryProperties.active = false;
  // query only unpinned tabs
  const queryTabs = browser.tabs.query(queryProperties);
  queryTabs.then((tabs) => {
    const rightTabs = tabs.filter((ele) => ele.index >= sender.tab.index);
    const rightTabIds = rightTabs.map((ele) => ele.id);
    // create new window with the first tab and move corresponding tabs to the new window
    if (rightTabIds.length > 0) {
      const windowProperties = {
        tabId: rightTabIds.shift()
      };
      if (!this.getSetting("focus")) windowProperties.state = "minimized";
      const createWindow = browser.windows.create(windowProperties);
      createWindow.then((win) => {
        browser.tabs.move(rightTabIds, {
          windowId: win.id,
          index: 1
        });
      });
    }
  });
}


export function MoveLeftTabsToNewWindow (sender, data) {
  const queryProperties = {
    currentWindow: true,
    pinned: false,
    hidden: false
  };
  // exclude current tab if specified
  if (!this.getSetting("includeCurrent")) queryProperties.active = false;
  // query only unpinned tabs
  const queryTabs = browser.tabs.query(queryProperties);
  queryTabs.then((tabs) => {
    const leftTabs = tabs.filter((ele) => ele.index <= sender.tab.index);
    const leftTabIds = leftTabs.map((ele) => ele.id);
    // create new window with the last tab and move corresponding tabs to the new window
    if (leftTabIds.length > 0) {
      const windowProperties = {
        tabId: leftTabIds.pop()
      };
      if (!this.getSetting("focus")) windowProperties.state = "minimized";
      const createWindow = browser.windows.create(windowProperties);
      createWindow.then((win) => {
        browser.tabs.move(leftTabIds, {
          windowId: win.id,
          index: 0
        });
      });
    }
  });
}


export function CloseWindow (sender, data) {
  browser.windows.remove(sender.tab.windowId);
}


export function URLLevelUp (sender, data) {
  browser.tabs.executeScript(sender.tab.id, {
    code: `
      const newPath = window.location.pathname.replace(/\\/([^/]+)\\/?$/g, '');
      window.location.assign( window.location.origin + newPath );
    `,
    runAt: 'document_start'
  });
}


export function IncreaseURLNumber (sender, data) {
  if (isLegalURL(sender.tab.url)) {
    const url = new URL(sender.tab.url),
          numbers = /[0-9]+/;

    if (url.pathname.match(numbers)) {
      url.pathname = incrementLastNumber(url.pathname);
    }
    else if (url.search.match(numbers)) {
      url.search = incrementLastNumber(url.search);
    }
    // only update url on number occurrence
    else return;

    browser.tabs.update(sender.tab.id, { "url": url.href });
  }

  function incrementLastNumber (string) {
    // regex matches only last number occurrence
    return string.replace(/(\d+)(?!.*\d)/, (match, offset, string) => {
      const incrementedNumber = Number(match) + 1;
      // calculate leading zeros | round to 0 in case the number got incremented by another digit and there are no leading zeros
      const leadingZeros = Math.max(match.length - incrementedNumber.toString().length, 0);
      // append leading zeros to number
      return '0'.repeat(leadingZeros) + incrementedNumber;
    });
  }
}


export function DecreaseURLNumber (sender, data) {
  if (isLegalURL(sender.tab.url)) {
    const url = new URL(sender.tab.url),
          // match number greater than zero
          numbers = /\d*[1-9]{1}\d*/;

    if (url.pathname.match(numbers)) {
      url.pathname = decrementLastNumber(url.pathname);
    }
    else if (url.search.match(numbers)) {
      url.search = decrementLastNumber(url.search);
    }
    // only update url on number occurrence
    else return;

    browser.tabs.update(sender.tab.id, { "url": url.href });
  }

  function decrementLastNumber (string) {
    // regex matches only last number occurrence
    return string.replace(/(\d+)(?!.*\d)/, (match, offset, string) => {
      const decrementedNumber = Number(match) - 1;
      // calculate leading zeros | round to 0 in case the number got incremented by another digit and there are no leading zeros
      const leadingZeros = Math.max(match.length - decrementedNumber.toString().length, 0);
      // append leading zeros to number
      return '0'.repeat(leadingZeros) + decrementedNumber;
    });
  }
}


export function OpenImageInNewTab (sender, data) {
  let index;

  switch (this.getSetting("position")) {
    case "before":
      index = sender.tab.index;
    break;
    case "after":
      index = sender.tab.index + 1;
    break;
    case "start":
      index = 0;
    break;
    case "end":
      index = Number.MAX_SAFE_INTEGER;
    break;
    default:
      index = null;
    break;    
  }

  if (data.target.nodeName.toLowerCase() === "img" && data.target.src) {
    browser.tabs.create({
      url: data.target.src,
      active: this.getSetting("focus"),
      index: index,
      openerTabId: sender.tab.id
    });
  }
}


export function OpenLinkInNewTab (sender, data) {
  let url = null;

  // only allow http/https urls to open from text selection to better mimic the firefox behaviour
  if (isHTTPURL(data.textSelection)) url = data.textSelection;
  // check if the provided url can be opened by webextensions (is not privileged)
  else if (data.link && isLegalURL(data.link.href)) url = data.link.href;

  if (url || this.getSetting("emptyTab")) {
    let index;

    switch (this.getSetting("position")) {
      case "before":
        index = sender.tab.index;
      break;
      case "after":
        index = sender.tab.index + 1;
      break;
      case "start":
        index = 0;
      break;
      case "end":
        index = Number.MAX_SAFE_INTEGER;
      break;
      default:
        // default behaviour - insert new tabs as adjacent children
        // depnds on browser.tabs.insertRelatedAfterCurrent and browser.tabs.insertAfterCurrent
        index = null;
      break;
    }

    // open new tab
    browser.tabs.create({
      url: url,
      active: this.getSetting("focus"),
      index: index,
      openerTabId: sender.tab.id
    });
  }
}


export function OpenLinkInNewWindow (sender, data) {
  let url = null;
  // only allow http/https urls to open from text selection to better mimic the firefox behaviour
  if (isHTTPURL(data.textSelection)) url = data.textSelection;
  // check if the provided url can be opened by webextensions (is not privileged)
  else if (data.link && isLegalURL(data.link.href)) url = data.link.href;

  if (url || this.getSetting("emptyWindow")) browser.windows.create({
    url: url
  })
}


export function OpenLinkInNewPrivateWindow (sender, data) {
  let url = null;
  // only allow http/https urls to open from text selection to better mimic the firefox behaviour
  if (isHTTPURL(data.textSelection)) url = data.textSelection;
  // check if the provided url can be opened by webextensions (is not privileged)
  else if (data.link && isLegalURL(data.link.href)) url = data.link.href;

  if (url || this.getSetting("emptyWindow")) {
    const createPrivateWindow = browser.windows.create({
      url: url,
      incognito: true
    });
    createPrivateWindow.catch((error) => {
      if (error.message === 'Extension does not have permission for incognito mode') displayNotification(
        browser.i18n.getMessage('commandErrorNotificationTitle', browser.i18n.getMessage("commandLabelNewPrivateWindow")),
        browser.i18n.getMessage('commandErrorNotificationMessageMissingIncognitoPermissions'),
        "https://github.com/Robbendebiene/Gesturefy/wiki/Missing-incognito-permission"
      );
    });
  }
}


export function LinkToNewBookmark (sender, data) {
  let url = null, title = null;

  if (isURL(data.textSelection))
    url = data.textSelection;
  else if (data.link && data.link.href) {
    url = data.link.href;
    title = data.link.title || data.link.textContent || data.target.title || null;
  }

  if (url) browser.bookmarks.create({
    url: url,
    title: title || new URL(url).hostname
  });
}


export function SearchTextSelection (sender, data) {
  const tabProperties = {
    active: this.getSetting("focus"),
    openerTabId: sender.tab.id
  };

  // define tab position
  switch (this.getSetting("position")) {
    case "before":
      tabProperties.index = sender.tab.index;
    break;
    case "after":
      tabProperties.index = sender.tab.index + 1;
    break;
    case "start":
      tabProperties.index = 0;
    break;
    case "end":
      tabProperties.index = Number.MAX_SAFE_INTEGER;
    break;  
  }

  // either use specified search engine url or default search engine
  if (this.getSetting("searchEngineURL")) {
    tabProperties.url = this.getSetting("searchEngineURL") + encodeURIComponent(data.textSelection);
    browser.tabs.create(tabProperties);
  }
  else {
    const createTab = browser.tabs.create(tabProperties);
    createTab.then((tab) => {
      browser.search.search({
        query: data.textSelection,
        tabId: tab.id
      });
    });
  }
}


export function SearchClipboard (sender, data) {
  const queryClipboardText = navigator.clipboard.readText();
  const tabProperties = {
    active: this.getSetting("focus"),
    openerTabId: sender.tab.id
  };

  queryClipboardText.then((clipboardText) => {
    // define tab position
    switch (this.getSetting("position")) {
      case "before":
        tabProperties.index = sender.tab.index;
      break;
      case "after":
        tabProperties.index = sender.tab.index + 1;
      break;
      case "start":
        tabProperties.index = 0;
      break;
      case "end":
        tabProperties.index = Number.MAX_SAFE_INTEGER;
      break;   
    }
      
    // either use specified search engine url or default search engine
    if (this.getSetting("searchEngineURL")) {
      tabProperties.url = this.getSetting("searchEngineURL") + encodeURIComponent(clipboardText);
      browser.tabs.create(tabProperties);
    }
    else {
      const createTab = browser.tabs.create(tabProperties);
      createTab.then((tab) => {
        browser.search.search({
          query: clipboardText,
          tabId: tab.id
        });
      });
    }
  });
}


export function OpenCustomURLInNewTab (sender, data) {
  let index;

  switch (this.getSetting("position")) {
    case "before":
      index = sender.tab.index;
    break;
    case "after":
      index = sender.tab.index + 1;
    break;
    case "start":
      index = 0;
    break;
    case "end":
      index = Number.MAX_SAFE_INTEGER;
    break;
    default:
      index = null;
    break;    
  }

  const createTab = browser.tabs.create({
    url: this.getSetting("url"),
    active: this.getSetting("focus"),
    index: index,
  });
  createTab.catch((error) => {
    // create error notification and open corresponding wiki page on click
    displayNotification(
      browser.i18n.getMessage('commandErrorNotificationTitle', browser.i18n.getMessage("commandLabelOpenCustomURLInNewTab")),
      browser.i18n.getMessage('commandErrorNotificationMessageIllegalURL'),
      "https://github.com/Robbendebiene/Gesturefy/wiki/Illegal-URL"
    );
  });
}


export function OpenCustomURL (sender, data) {
  const createTab = browser.tabs.update(sender.tab.id, {
    url: this.getSetting("url")
  });
  createTab.catch((error) => {
    // create error notification and open corresponding wiki page on click
    displayNotification(
      browser.i18n.getMessage('commandErrorNotificationTitle', browser.i18n.getMessage("commandLabelOpenCustomURL")),
      browser.i18n.getMessage('commandErrorNotificationMessageIllegalURL'),
      "https://github.com/Robbendebiene/Gesturefy/wiki/Illegal-URL"
    );
  });
}


export function OpenHomepage (sender, data) {
  const fetchHomepage = browser.browserSettings.homepageOverride.get({});
  fetchHomepage.then((result) => {
    let url = result.value,
        createHomepageTab;

    // try adding protocol on invalid url
    if (!isURL(url)) url = 'http://' + url;

    if (sender.tab.pinned) {
      createHomepageTab = browser.tabs.create({
        url: url,
        active: true,
      });
    }
    else {
      createHomepageTab = browser.tabs.update(sender.tab.id, {
        url: url
      });
    }

    createHomepageTab.catch((error) => {
      // create error notification and open corresponding wiki page on click
      displayNotification(
        browser.i18n.getMessage('commandErrorNotificationTitle', browser.i18n.getMessage("commandLabelOpenHomepage")),
        browser.i18n.getMessage('commandErrorNotificationMessageIllegalURL'),
        "https://github.com/Robbendebiene/Gesturefy/wiki/Illegal-URL"
      );
    });
  });
}


export function OpenLink (sender, data) {
  let url = null;
  // only allow http/https urls to open from text selection to better mimic the firefox behaviour
  if (isHTTPURL(data.textSelection)) url = data.textSelection;
  // check if the provided url can be opened by webextensions (is not privileged)
  else if (data.link && isLegalURL(data.link.href)) url = data.link.href;

  if (url) {
    if (sender.tab.pinned) {
      const queryTabs = browser.tabs.query({
        currentWindow: true,
        pinned: false
      });
      queryTabs.then((tabs) => {
        // get the lowest index excluding pinned tabs
        let mostLeftTabIndex = 0;
        if (tabs.length > 0) mostLeftTabIndex = tabs.reduce((min, cur) => min.index < cur.index ? min : cur).index;
        browser.tabs.create({
          url: url,
          active: true,
          index: mostLeftTabIndex,
          openerTabId: sender.tab.id
        });
      });
    }
    else browser.tabs.update(sender.tab.id, {
      url: url
    });
  }
}


export function ViewImage (sender, data) {
  if (data.target.nodeName.toLowerCase() === "img" && data.target.src) {
    if (sender.tab.pinned) {
      const queryTabs = browser.tabs.query({
        currentWindow: true,
        pinned: false
      });
      queryTabs.then((tabs) => {
        // get the lowest index excluding pinned tabs
        let mostLeftTabIndex = 0;
        if (tabs.length > 0) mostLeftTabIndex = tabs.reduce((min, cur) => min.index < cur.index ? min : cur).index;
        chrome.tabs.create({
          url: data.target.src,
          active: true,
          index: mostLeftTabIndex,
          openerTabId: sender.tab.id
        });
      });
    }
    else browser.tabs.update(sender.tab.id, {
      url: data.target.src
    });
  }
}


export function OpenURLFromClipboard (sender, data) {
  const queryClipboard = navigator.clipboard.readText();
  queryClipboard.then((clipboardText) => {
    if (clipboardText && isLegalURL(clipboardText)) browser.tabs.update(sender.tab.id, {
      url: clipboardText
    });
  });
}


export function OpenURLFromClipboardInNewTab (sender, data) {
  let index;

  switch (this.getSetting("position")) {
    case "before":
      index = sender.tab.index;
    break;
    case "after":
      index = sender.tab.index + 1;
    break;
    case "start":
      index = 0;
    break;
    case "end":
      index = Number.MAX_SAFE_INTEGER;
    break;
    default:
      index = null;
    break;    
  }

  const queryClipboard = navigator.clipboard.readText();
  queryClipboard.then((clipboardText) => {
    if (clipboardText && isLegalURL(clipboardText)) browser.tabs.create({
      url: clipboardText,
      active: this.getSetting("focus"),
      index: index
    });
  });
}


export function PasteClipboard (sender, data) {
  browser.tabs.executeScript(sender.tab.id, {
    code: 'document.execCommand("paste")',
    runAt: 'document_start',
    frameId: sender.frameId || 0
  });
}


export function SaveTabAsPDF (sender, data) {
  browser.tabs.saveAsPDF({});
}


export function PrintTab (sender, data) {
  browser.tabs.print();
}


export function OpenPrintPreview (sender, data) {
  browser.tabs.printPreview();
}


export function SaveScreenshot (sender, data) {
  const queryScreenshot = browser.tabs.captureVisibleTab();
  queryScreenshot.then((url) => {
    // convert data uri to blob
    url = URL.createObjectURL(dataURItoBlob(url));

    const queryDownload = browser.downloads.download({
      url: url,
      // remove special file name characters
      filename: sanitizeFilename(sender.tab.title) + '.png',
      saveAs: true
    });
    queryDownload.then((downloadId) => {
      // catch error and free the blob for gc
      if (browser.runtime.lastError) URL.revokeObjectURL(url);
      else browser.downloads.onChanged.addListener(function clearURL(downloadDelta) {
        if (downloadId === downloadDelta.id && downloadDelta.state.current === "complete") {
          URL.revokeObjectURL(url);
          browser.downloads.onChanged.removeListener(clearURL);
        }
      });
    });
  });
}

export function CopyTabURL (sender, data) {
  navigator.clipboard.writeText(sender.tab.url);
}


export function CopyLinkURL (sender, data) {
  let url = null;
  if (isURL(data.textSelection)) url = data.textSelection;
  else if (data.link && data.link.href) url = data.link.href;
  else return;
  navigator.clipboard.writeText(url);
}


export function CopyTextSelection (sender, data) {
  navigator.clipboard.writeText(data.textSelection);
}


export function CopyImage (sender, data) {
  if (data.target.nodeName.toLowerCase() === "img" && data.target.src) {
    fetch(data.target.src).then(response => {
      const mimeType = response.headers.get("Content-Type");
    
      switch (mimeType) {
        case "image/jpeg":
          response.arrayBuffer().then(buffer => browser.clipboard.setImageData(buffer, "jpeg"));
        break;
      
        case "image/png":
          response.arrayBuffer().then(buffer => browser.clipboard.setImageData(buffer, "png"));
        break;

        // convert other file types to png using the canvas api
        default:
          response.blob().then((blob) => {
            const image = new Image();
            const objectURL = URL.createObjectURL(blob);
            image.onload = event => {
              const canvas = document.createElement('canvas');
                    canvas.width = image.naturalWidth;
                    canvas.height = image.naturalHeight;
              const ctx = canvas.getContext('2d');
                    ctx.drawImage(image, 0, 0);
              // free blob
              URL.revokeObjectURL(objectURL);
              // read png image from canvas as blob and write it to clipboard
              canvas.toBlob((blob) => {
                blob.arrayBuffer().then(buffer => browser.clipboard.setImageData(buffer, "png"));
              }, "image/png");
            };
            image.src = objectURL;
          });
        break;
      }
    });
  }
}


export function SaveImage (sender, data) {
  if (data.target.nodeName.toLowerCase() === "img" && data.target.src && isURL(data.target.src)) {
    const queryOptions = {
      saveAs: this.getSetting("promptDialog")
    };

    const urlObject = new URL(data.target.src);
    // if data url create blob
    if (urlObject.protocol === "data:") {
      queryOptions.url = URL.createObjectURL(dataURItoBlob(data.target.src));
      // get file extension from mime type
      const fileExtension =  data.target.src.split("data:image/").pop().split(";")[0];
      // construct file name
      queryOptions.filename = data.target.alt || data.target.title || "image";
      // remove special characters and add file extension
      queryOptions.filename = sanitizeFilename(queryOptions.filename) + "." + fileExtension;
    }
    // otherwise use normal url
    else queryOptions.url = data.target.src;

    // add referer header, because some websites modify the image if the referer is missing
    // get referrer from content script
    const executeScript = browser.tabs.executeScript(sender.tab.id, {
      code: "({ referrer: document.referrer, url: window.location.href })",
      runAt: "document_start",
      frameId: sender.frameId || 0
    });
    executeScript.then(returnValues => {
      // if the image is embedded in a website use the url of that website as the referer
      if (data.target.src !== returnValues[0].url) {
        // emulate no-referrer-when-downgrade
        // The origin, path, and querystring of the URL are sent as a referrer when the protocol security level stays the same (HTTP→HTTP, HTTPS→HTTPS)
        // or improves (HTTP→HTTPS), but isn't sent to less secure destinations (HTTPS→HTTP).
        if (!(new URL(returnValues[0].url).protocol === "https:" && new URL(data.target.src).protocol === "http:")) {
          queryOptions.headers = [ { name: "Referer", value: returnValues[0].url.split("#")[0] } ];
        }
      }
      // if the image is not embedded, but a referrer is set use the referrer
      else if (returnValues[0].referrer) {
        queryOptions.headers = [ { name: "Referer", value: returnValues[0].referrer } ];
      }
      
      // download image
      const queryDownload = browser.downloads.download(queryOptions);
      // handle blobs
      queryDownload.then((downloadId) => {
        const urlObject = new URL(queryOptions.url);
        // if blob file was created
        if (urlObject.protocol === "blob:") {
          // catch error and free the blob for gc
          if (browser.runtime.lastError) URL.revokeObjectURL(queryOptions.url);
          else browser.downloads.onChanged.addListener(function clearURL(downloadDelta) {
            if (downloadId === downloadDelta.id && downloadDelta.state.current === "complete") {
              URL.revokeObjectURL(queryOptions.url);
              browser.downloads.onChanged.removeListener(clearURL);
            }
          });
        }
      });
    });
  }
}


export function SaveLink (sender, data) {
  let url = null;
  if (isURL(data.textSelection)) url = data.textSelection;
  else if (data.link && data.link.href) url = data.link.href;

  if (url) {
    browser.downloads.download({
      url: url,
      saveAs: this.getSetting("promptDialog")
    });
  }
}


export function ViewPageSourceCode (sender, data) {
  browser.tabs.create({
    active: true,
    index: sender.tab.index + 1,
    url: "view-source:" + sender.tab.url
  });
}


export function OpenAddonSettings (sender, data) {
  browser.runtime.openOptionsPage();
}


export function PopupAllTabs (sender, data) {
  const queryTabs = browser.tabs.query({
    currentWindow: true,
    hidden: false
  });
  queryTabs.then((tabs) => {
    // sort tabs if defined
    switch (this.getSetting("order")) {
      case "lastAccessedAsc":
        tabs.sort((a, b) => b.lastAccessed - a.lastAccessed);
      break;
      case "lastAccessedDesc":
        tabs.sort((a, b) => a.lastAccessed - b.lastAccessed);
      break;
      case "alphabeticalAsc":
        tabs.sort((a, b) => a.title.localeCompare(b.title));
      break;
      case "alphabeticalDesc":
        tabs.sort((a, b) => -a.title.localeCompare(b.title));
      break;
    }
    // map tabs to popup data structure
    const dataset = tabs.map((tab) => ({
      id: tab.id,
      label: tab.title,
      icon: tab.favIconUrl || null
    }));

    const channel = browser.tabs.connect(sender.tab.id, {
      name: "PopupRequest",
      frameId: 0
    });

    channel.postMessage({
      mousePosition: {
        x: data.mousePosition.x,
        y: data.mousePosition.y
      },
      dataset: dataset
    });

    channel.onMessage.addListener((message) => {
      browser.tabs.update(Number(message.id), {active: true});
      // immediately disconnect the channel since keeping the popup open doesn't make sense
      channel.disconnect();
    });
  });
}


export function PopupRecentlyClosedTabs (sender, data) {
  const queryTabs = browser.sessions.getRecentlyClosed({});
  queryTabs.then((session) => {
    // filter windows
    let dataset = session.filter((element) => "tab" in element)
        dataset = dataset.map((element) => ({
          id: element.tab.sessionId,
          label: element.tab.title,
          icon: element.tab.favIconUrl || null
        }));

    const channel = browser.tabs.connect(sender.tab.id, {
      name: "PopupRequest",
      frameId: 0
    });

    channel.postMessage({
      mousePosition: {
        x: data.mousePosition.x,
        y: data.mousePosition.y
      },
      dataset: dataset
    });

    channel.onMessage.addListener((message) => {
      browser.sessions.restore(message.id);
      // immediately disconnect the channel since keeping the popup open doesn't make sense
      // restored tab is always focused, probably because it is restored at its original tab index
      channel.disconnect();
    });
  });
}


export function PopupSearchEngines (sender, data) {
  const tabProperties = {
    openerTabId: sender.tab.id
  };
  // define tab position
  switch (this.getSetting("position")) {
    case "before":
      tabProperties.index = sender.tab.index;
    break;
    case "after":
      tabProperties.index = sender.tab.index + 1;
    break;
    case "start":
      tabProperties.index = 0;
    break;
    case "end":
      tabProperties.index = Number.MAX_SAFE_INTEGER;
    break;  
  }

  const querySearchEngines = browser.search.get();
  querySearchEngines.then((searchEngines) => {
    // map search engines
    const dataset = searchEngines.map((searchEngine) => ({
      id: searchEngine.name,
      label: searchEngine.name,
      icon: searchEngine.favIconUrl || null
    }));

    const channel = browser.tabs.connect(sender.tab.id, {
      name: "PopupRequest",
      frameId: 0
    });

    channel.postMessage({
      mousePosition: {
        x: data.mousePosition.x,
        y: data.mousePosition.y
      },
      dataset: dataset
    });

    channel.onMessage.addListener((message) => {
      // check if primaray button was pressed
      if (message.button === 0) {
        // focus new tab
        tabProperties.active = true;
        // disconnect channel / close popup
        channel.disconnect();
      }
      else {
        // always open in background if a non-primary button was clicked and keep popup open
        tabProperties.active = false;
      }

      const createTab = browser.tabs.create(tabProperties);
      createTab.then((tab) => {
        browser.search.search({
          query: data.textSelection,
          engine: message.id,
          tabId: tab.id
        });
      });
    });
  });
}


export function SendMessageToOtherAddon (sender, data) {
  let message = this.getSetting("message");

  if (this.getSetting("parseJSON")) {
    // parse message to json object if serializeable
    try {
      message = JSON.parse(this.getSetting("message"));
    }
    catch(error) {
      displayNotification(
        browser.i18n.getMessage('commandErrorNotificationTitle', browser.i18n.getMessage("commandLabelSendMessageToOtherAddon")),
        browser.i18n.getMessage('commandErrorNotificationMessageNotSerializeable'),
        "https://github.com/Robbendebiene/Gesturefy/wiki/Send-message-to-other-addon#error-not-serializeable"
      );
      console.log(error);
      return;
    }
  }
  const sending = browser.runtime.sendMessage(this.getSetting("extensionId"), message, {});
  sending.catch((error) => {
    if (error.message === 'Could not establish connection. Receiving end does not exist.') displayNotification(
      browser.i18n.getMessage('commandErrorNotificationTitle', browser.i18n.getMessage("commandLabelSendMessageToOtherAddon")),
      browser.i18n.getMessage('commandErrorNotificationMessageMissingRecipient'),
      "https://github.com/Robbendebiene/Gesturefy/wiki/Send-message-to-other-addon#error-missing-recipient"
    );
  });
}


export function ExecuteUserScript (sender, data) {
  const messageOptions = {};

  switch (this.getSetting("targetFrame")) {
    case "allFrames": break;

    case "topFrame":
      messageOptions.frameId = 0;
    break;

    case "sourceFrame":
    default:
      messageOptions.frameId = sender.frameId || 0;
    break;
  }

  // sends a message to the user script controller
  browser.tabs.sendMessage(
    sender.tab.id,
    {
      subject: "executeUserScript",
      data: this.getSetting("userScript")
    },
    messageOptions
  );
}


export function ClearBrowsingData (sender, data) {
  browser.browsingData.remove({}, {
    "cache": this.getSetting("cache"),
    "cookies": this.getSetting("cookies"),
    "downloads": this.getSetting("downloads"),
    "formData": this.getSetting("formData"),
    "history": this.getSetting("history"),
    "indexedDB": this.getSetting("indexedDB"),
    "localStorage": this.getSetting("localStorage"),
    "passwords": this.getSetting("passwords"),
    "pluginData": this.getSetting("pluginData"),
    "serviceWorkers": this.getSetting("serviceWorkers")
  });
}

