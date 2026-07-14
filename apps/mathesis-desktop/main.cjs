const { app, BrowserWindow, clipboard, globalShortcut, screen } = require("electron");

const MATHESIS_ORIGIN = "https://mathesis-app.vercel.app";
const LOOKUP_SHORTCUT = "CommandOrControl+Shift+M";
let lookupWindow = null;

function buildLookupUrl(word) {
  const url = new URL(MATHESIS_ORIGIN);
  url.searchParams.set("lookup", word);
  return url.toString();
}

function getClipboardLookup() {
  const value = clipboard.readText().normalize("NFC").trim();

  if (!value || value.length > 120 || /[\r\n]/u.test(value)) {
    return null;
  }

  return value;
}

function isMathesisUrl(rawUrl) {
  try {
    return new URL(rawUrl).origin === MATHESIS_ORIGIN;
  } catch {
    return false;
  }
}

function openLookup() {
  const word = getClipboardLookup();
  if (!word) return;

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor).workArea;
  const width = Math.min(920, display.width - 32);
  const height = Math.min(900, display.height - 32);
  const x = Math.min(Math.max(display.x + 16, cursor.x - 120), display.x + display.width - width - 16);
  const y = Math.min(Math.max(display.y + 16, cursor.y - 80), display.y + display.height - height - 16);

  if (!lookupWindow || lookupWindow.isDestroyed()) {
    lookupWindow = new BrowserWindow({
      backgroundColor: "#f8f2e8",
      height,
      icon: undefined,
      minHeight: 480,
      minWidth: 520,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: `${__dirname}/preload.cjs`,
        webSecurity: true,
      },
      width,
      x,
      y,
    });

    lookupWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    lookupWindow.webContents.on("will-navigate", (event, targetUrl) => {
      if (!isMathesisUrl(targetUrl)) event.preventDefault();
    });
    lookupWindow.once("ready-to-show", () => lookupWindow?.show());
  }

  lookupWindow.loadURL(buildLookupUrl(word));
  lookupWindow.show();
  lookupWindow.focus();
}

app.whenReady().then(() => {
  globalShortcut.register(LOOKUP_SHORTCUT, openLookup);
  app.on("activate", openLookup);
});

app.on("will-quit", () => globalShortcut.unregisterAll());
