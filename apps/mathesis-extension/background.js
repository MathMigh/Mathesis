const MATHESIS_ORIGIN = "https://mathesis-app.vercel.app";
const MAX_WORD_LENGTH = 120;
let lastLookupKey = "";
let lastLookupAt = 0;

function normalizeLanguage(language) {
  if (language === "english" || language === "latin" || language === "portuguese") {
    return language;
  }

  return "";
}

function buildLookupUrl(word, language) {
  const url = new URL(MATHESIS_ORIGIN);
  url.searchParams.set("lookup", word);

  const normalizedLanguage = normalizeLanguage(language);
  if (normalizedLanguage) {
    url.searchParams.set("lang", normalizedLanguage);
  }

  return url.toString();
}

function shouldOpen(word) {
  const key = word.toLocaleLowerCase();
  const now = Date.now();

  if (key === lastLookupKey && now - lastLookupAt < 1200) {
    return false;
  }

  lastLookupKey = key;
  lastLookupAt = now;
  return true;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "MATHESIS_OPEN_LOOKUP" || typeof message.word !== "string") {
    return;
  }

  const word = message.word.normalize("NFC").trim();
  if (!word || word.length > MAX_WORD_LENGTH || /[\r\n]/u.test(word) || !shouldOpen(word)) {
    return;
  }

  chrome.windows.create({
    focused: true,
    height: 900,
    type: "popup",
    url: buildLookupUrl(word, message.language),
    width: 920
  });
});
