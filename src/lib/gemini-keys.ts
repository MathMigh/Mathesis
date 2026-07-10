function splitKeyList(value: string | undefined) {
  return (value ?? "")
    .split(/[\n,;]+/u)
    .map((key) => key.trim())
    .filter(isSafeApiKeyCandidate);
}

function isSafeApiKeyCandidate(value: string) {
  return /^[A-Za-z0-9._-]{20,256}$/u.test(value);
}

function collectConfiguredKeyLists() {
  const configuredLists = [
    process.env.AI_API_KEYS,
    process.env.GEMINI_API_KEYS,
  ];

  for (let index = 1; index <= 128; index += 1) {
    configuredLists.push(process.env[`AI_API_KEYS_${index}`]);
    configuredLists.push(process.env[`GEMINI_API_KEYS_${index}`]);
  }

  return configuredLists.flatMap(splitKeyList);
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
