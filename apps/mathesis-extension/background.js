const MATHESIS_ORIGIN = "https://mathesis-app.vercel.app";

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

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "MATHESIS_OPEN_LOOKUP" || typeof message.word !== "string") {
    return;
  }

  const word = message.word.normalize("NFC").trim();
  if (!word || word.length > 120) {
    return;
  }

  chrome.windows.create({
    focused: true,
    height: 900,
    type: "popup",
    url: buildLookupUrl(word, message.language),
    width: 920,
  });
});
