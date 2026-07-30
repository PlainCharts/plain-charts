// @ts-check
// JSON GET/POST against the local server's settings API. Fails soft (offline).
/** @param {string} url @returns {Promise<any>} */
export const getJSON = (url) =>
  fetch(url)
    .then((r) => r.json())
    .catch(() => ({}));

/** @param {string} url @param {any} obj */
export const postJSON = (url, obj) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  }).catch(() => {});
