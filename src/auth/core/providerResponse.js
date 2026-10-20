const { createHttpError } = require("./errors");

async function readProviderResponse(response, code, message) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createHttpError(message, 502, code, {
      oauthError: typeof body.error === "string" ? body.error : null,
    });
  }
  return body;
}

module.exports = { readProviderResponse };
