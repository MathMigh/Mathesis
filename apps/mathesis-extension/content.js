const MAX_WORD_LENGTH = 120;
let lastSentWord = "";
let lastSentAt = 0;

function normalizeLanguage(language) {
  const value = (language || "").toLocaleLowerCase();

  if (value.startsWith("pt")) return "portuguese";
  if (value.startsWith("en")) return "english";
  if (value.startsWith("la") || value.includes("latin")) return "latin";

  return undefined;
}

function readSelectedWord() {
  const selection = window.getSelection();
  const value = selection?.toString().normalize("NFC").trim() ?? "";

  if (!selection || selection.isCollapsed || !value || value.length > MAX_WORD_LENGTH || /[\r\n]/u.test(value)) {
    return "";
  }

  return value;
}

function selectionLooksLexical(word) {
  return /^[\p{L}\p{M}'\u2019.-]+$/u.test(word) && /\p{L}/u.test(word);
}

function sendLookup(word) {
  const now = Date.now();
  const key = word.toLocaleLowerCase();

  if (key === lastSentWord && now - lastSentAt < 1200) {
    return;
  }

  lastSentWord = key;
  lastSentAt = now;

  chrome.runtime.sendMessage({
    language: normalizeLanguage(document.documentElement.lang),
    type: "MATHESIS_OPEN_LOOKUP",
    word
  });
}

function handleSelection() {
  const word = readSelectedWord();
  if (!word || !selectionLooksLexical(word)) {
    return;
  }

  sendLookup(word);
}

document.addEventListener("selectionchange", () => {
  window.clearTimeout(handleSelection.timer);
  handleSelection.timer = window.setTimeout(handleSelection, 250);
});

document.addEventListener("mouseup", () => {
  window.setTimeout(handleSelection, 0);
});
