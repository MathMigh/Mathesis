function splitKeyList(value: string | undefined) {
  return (value ?? "")
    .split(/[\n,;]+/u)
    .map((key) => key.trim())
    .filter(isSafeApiKeyCandidate);
}

function isAllowedKeyListName(name: string) {
  return /^(?:AI_API_KEYS|GEMINI_API_KEYS)(?:_\d{1,3})?$/u.test(name);
}

function isSafeApiKeyCandidate(value: string) {
  return /^[A-Za-z0-9._-]{20,256}$/u.test(value);
}

function collectConfiguredKeyLists() {
  return Object.entries(process.env)
    .filter(([key, value]) =>
      Boolean(value) &&
      isAllowedKeyListName(key),
    )
    .flatMap(([, value]) => splitKeyList(value));
}

export function getGeminiApiKeys(additionalKeys: Array<string | undefined> = []) {
  return Array.from(
    new Set(
      [
        ...collectConfiguredKeyLists(),
        ...additionalKeys.flatMap(splitKeyList),
        process.env.AI_API_KEY,
        process.env.GEMINI_API_KEY,
        process.env.GOOGLE_GENERATIVE_AI_API_KEY,
        process.env.GOOGLE_AI_API_KEY,
      ]
        .map((key) => key?.trim())
        .filter(
          (key): key is string =>
            typeof key === "string" && isSafeApiKeyCandidate(key),
        ),
    ),
  );
}
