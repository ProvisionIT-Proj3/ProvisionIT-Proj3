const { createHttpError } = require("./errors");

function assertRedirectUri(value, settingName) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw createHttpError(`${settingName} must be an absolute URL.`, 500, "INVALID_OAUTH_CONFIGURATION");
  }

  const isLocalHttp = url.protocol === "http:" && url.hostname === "localhost";
  if ((url.protocol !== "https:" && !isLocalHttp) || url.username || url.password || url.hash) {
    throw createHttpError(
      `${settingName} must use HTTPS (HTTP is allowed for localhost), without credentials or fragments.`,
      500,
      "INVALID_OAUTH_CONFIGURATION",
    );
  }
}

function buildRelativeApiUrl(path, baseUrl, providerName, errorCode) {
  const invalidPath = () => createHttpError(
    `${providerName} API requests require a relative path within the provider API.`, 400, errorCode,
  );
  if (typeof path !== "string" || !path || /[\\\s\u0000-\u001f\u007f]/.test(path)
    || /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//")) {
    throw invalidPath();
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(path.split(/[?#]/, 1)[0]);
  } catch {
    throw invalidPath();
  }
  // URL normalization understands encoded dot segments and backslashes.
  if (decodedPath.includes("\\") || /(^|\/)\.\.(\/|$)/.test(decodedPath)) throw invalidPath();

  const base = new URL(baseUrl);
  const url = new URL(path.replace(/^\/+/, ""), base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.hash) {
    throw invalidPath();
  }
  return url.toString();
}

module.exports = { assertRedirectUri, buildRelativeApiUrl };
