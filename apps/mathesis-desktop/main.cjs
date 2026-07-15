const { app, BrowserWindow, clipboard, globalShortcut, screen } = require("electron");

const MATHESIS_ORIGIN = "https://mathesis-app.vercel.app";
const LOOKUP_SHORTCUT = "CommandOrControl+Shift+M";
const MAX_WORD_LENGTH = 120;
const CLIPBOARD_POLL_INTERVAL_MS = 650;
let lookupWindow = null;
let lastOpenedWord = "";
let lastClipboardValue = "";

function buildLookupUrl(word) {
  const url = new URL(MATHESIS_ORIGIN);
  url.searchParams.set("lookup", word);
  return url.toString();
}

function readClipboardWord() {
  const value = clipboard.readText().normalize("NFC").trim();

  if (!value || value.length > MAX_WORD_LENGTH || /[\r\n]/u.test(value)) {
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
  const word = readClipboardWord();
  if (!word) return;

  const key = word.toLocaleLowerCase();
  if (key === lastOpenedWord) return;
  lastOpenedWord = key;

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
      minHeight: 480,
      minWidth: 520,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: `${__dirname}/preload.cjs`,
        sandbox: true,
        webSecurity: true
      },
      width,
      x,
      y
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

function watchClipboard() {
  const word = readClipboardWord();
  if (!word || word === lastClipboardValue) {
    return;
  }

  lastClipboardValue = word;
  openLookup();
}

app.whenReady().then(() => {
  globalShortcut.register(LOOKUP_SHORTCUT, openLookup);
  lastClipboardValue = clipboard.readText().normalize("NFC").trim();
  setInterval(watchClipboard, CLIPBOARD_POLL_INTERVAL_MS);
  app.on("activate", openLookup);
});

app.on("will-quit", () => globalShortcut.unregisterAll());
