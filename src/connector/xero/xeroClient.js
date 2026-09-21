const XERO_BASE_URL = "https://api.xero.com/api.xro/2.0";

/**
 * Makes an authenticated GET request to the Xero Accounting API.
 *
 * @param {string} endpoint - Xero endpoint, e.g. "Contacts"
 * @param {string} accessToken - Valid OAuth access token
 * @param {string} tenantId - Authorised Xero tenant ID
 * @param {Object} queryParams - Optional URL query parameters
 * @returns {Promise<Object>} Xero JSON response
 */
export async function xeroRequest(
    endpoint,
    accessToken,
    tenantId,
    queryParams = {}
) {
    const url = new URL(`${XERO_BASE_URL}/${endpoint}`);

    // Add optional query parameters
    Object.entries(queryParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            url.searchParams.append(key, value);
        }
    });

    const response = await fetch(url, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "xero-tenant-id": tenantId,
            Accept: "application/json"
        }
    });

    if (!response.ok) {
        const errorBody = await response.text();

        throw new Error(
            `Xero API request failed: ${response.status} ${response.statusText}\n${errorBody}`
        );
    }

    return response.json();
}