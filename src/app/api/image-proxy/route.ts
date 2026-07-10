import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { consumeRateLimit } from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 30;

const IMAGE_CACHE_HEADERS = {
  "Cache-Control":
    "public, max-age=0, s-maxage=31536000, stale-while-revalidate=604800",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
};
const IMAGE_ERROR_HEADERS = {
  "Cache-Control": "private, no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Content-Type-Options": "nosniff",
};
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_SOURCE_URL_LENGTH = 2_048;
const ALLOWED_IMAGE_HOSTS = [
  ".duckduckgo.com",
  ".openverse.engineering",
  ".openverse.org",
  ".pexels.com",
  ".pixabay.com",
  ".unsplash.com",
  ".wikimedia.org",
  ".wikipedia.org",
  "cdn.pixabay.com",
  "duckduckgo.com",
  "external-content.duckduckgo.com",
  "images.openverse.engineering",
  "images.pexels.com",
  "images.unsplash.com",
  "openverse.org",
  "pixabay.com",
  "plus.unsplash.com",
].map((host) => host.toLocaleLowerCase("en-US"));

function isPrivateIpAddress(address: string) {
  const normalized = address.trim().toLocaleLowerCase("en-US");
  const version = isIP(normalized);

  if (version === 4) {
    const [first = 0, second = 0] = normalized.split(".").map(Number);

    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  if (version === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.") ||
      /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./u.test(normalized) ||
      normalized.startsWith("::ffff:169.254.")
    );
  }

  return false;
}

function isBlockedPrivateHost(hostname: string) {
  const normalized = hostname.trim().toLocaleLowerCase("en-US");

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  ) {
    return true;
  }

  if (isIP(normalized)) {
    return isPrivateIpAddress(normalized);
  }

  return false;
}

async function resolvesToPublicAddress(hostname: string) {
  if (isIP(hostname)) {
    return !isPrivateIpAddress(hostname);
  }

  try {
    const addresses = await dnsLookup(hostname, { all: true, verbatim: true });

    if (addresses.length === 0) {
      return false;
    }

    return addresses.every((entry) => !isPrivateIpAddress(entry.address));
  } catch {
    return false;
  }
}

function isAllowedImageHost(hostname: string) {
  const normalized = hostname.trim().toLocaleLowerCase("en-US");

  return ALLOWED_IMAGE_HOSTS.some((allowedHost) =>
    allowedHost.startsWith(".")
      ? normalized === allowedHost.slice(1) || normalized.endsWith(allowedHost)
      : normalized === allowedHost,
  );
}

async function assertSafeImageUrl(sourceUrl: URL) {
  if (
    sourceUrl.href.length > MAX_SOURCE_URL_LENGTH ||
    sourceUrl.username ||
    sourceUrl.password
  ) {
    throw new Error("invalid-image-url");
  }

  if (
    !/^https?:$/i.test(sourceUrl.protocol) ||
    isBlockedPrivateHost(sourceUrl.hostname) ||
    !isAllowedImageHost(sourceUrl.hostname)
  ) {
    throw new Error("blocked-image-host");
  }

  if (!(await resolvesToPublicAddress(sourceUrl.hostname))) {
    throw new Error("blocked-image-address");
  }
}

async function readImageBufferWithLimit(response: Response) {
  const contentLength = Number(response.headers.get("content-length") ?? 0);

  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error("image-too-large");
  }

  const reader = response.body?.getReader();

  if (!reader) {
    return Buffer.from(await response.arrayBuffer());
  }

  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      size += value.byteLength;

      if (size > MAX_IMAGE_BYTES) {
        throw new Error("image-too-large");
      }

      chunks.push(value);
    }
  }

  return Buffer.concat(chunks);
}

async function fetchValidatedImage(sourceUrl: URL, redirectsRemaining = MAX_REDIRECTS) {
  await assertSafeImageUrl(sourceUrl);

  const response = await fetch(sourceUrl, {
    cache: "no-store",
    headers: {
      "user-agent": "Mathesis/0.1 image proxy",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(12_000),
  });

  if (
    redirectsRemaining > 0 &&
    [301, 302, 303, 307, 308].includes(response.status)
  ) {
    const location = response.headers.get("location")?.trim();

    if (!location) {
      throw new Error("missing-image-redirect");
    }

    return fetchValidatedImage(new URL(location, sourceUrl), redirectsRemaining - 1);
  }

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    throw new Error("too-many-image-redirects");
  }

  return response;
}

export async function GET(request: Request) {
  const rateLimit = await consumeRateLimit(request, "image-proxy", {
    intervalMs: 60_000,
    limit: 180,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { message: "Muitas imagens solicitadas em pouco tempo." },
      {
        headers: {
          ...IMAGE_ERROR_HEADERS,
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
        status: 429,
      },
    );
  }

  const { searchParams } = new URL(request.url);
  const rawSrc = searchParams.get("src")?.trim();

  if (!rawSrc) {
    return NextResponse.json(
      { message: "Informe a imagem." },
      { headers: IMAGE_ERROR_HEADERS, status: 400 },
    );
  }

  let sourceUrl: URL;

  try {
    sourceUrl = new URL(rawSrc);
  } catch {
    return NextResponse.json(
      { message: "URL de imagem invalida." },
      { headers: IMAGE_ERROR_HEADERS, status: 400 },
    );
  }

  try {
    const response = await fetchValidatedImage(sourceUrl);

    if (!response.ok) {
      return NextResponse.json(
        { message: "A imagem remota nao respondeu bem." },
        { headers: IMAGE_ERROR_HEADERS, status: 502 },
      );
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";

    if (!contentType.toLocaleLowerCase("en-US").startsWith("image/")) {
      return NextResponse.json(
        { message: "A resposta remota nao parece ser uma imagem." },
        { headers: IMAGE_ERROR_HEADERS, status: 415 },
      );
    }

    const buffer = await readImageBufferWithLimit(response);

    return new NextResponse(buffer, {
      headers: {
        ...IMAGE_CACHE_HEADERS,
        "Content-Type": contentType,
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";

    if (
      code === "invalid-image-url" ||
      code === "blocked-image-host" ||
      code === "blocked-image-address" ||
      code === "missing-image-redirect" ||
      code === "too-many-image-redirects"
    ) {
      return NextResponse.json(
        { message: "Host de imagem nao permitido." },
        { headers: IMAGE_ERROR_HEADERS, status: 400 },
      );
    }

    return NextResponse.json(
      { message: "Nao consegui carregar a imagem." },
      { headers: IMAGE_ERROR_HEADERS, status: 502 },
    );
  }
}
