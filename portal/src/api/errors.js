export function friendlyMessage(err) {
  const status = err?.status;
  if (status === 0) return "Can't reach the server. Check that the API is running.";
  if (status === 401) {
    // the API also sends 401 when a company's accounting login needs redoing
    if (/connection|authori[sz]ed again/i.test(err.message || '')) return err.message;
    return "You're not signed in, or your session has expired.";
  }
  if (status === 403) return "You don't have access to this.";
  if (status === 404) return "That company or record wasn't found.";
  if (status === 400) return err.message || 'The request had an invalid parameter.';
  if (status >= 500) return 'The server ran into a problem. Try again in a moment.';
  return 'Something went wrong loading this data.';
}
