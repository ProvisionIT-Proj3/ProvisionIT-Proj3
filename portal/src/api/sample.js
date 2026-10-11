// pages the API can't serve yet, these always run on sample data
export const SAMPLE_ONLY = ['/invoices', '/payments', '/customers'];

export const isSample = (path) => import.meta.env.VITE_USE_MOCK === 'true' || SAMPLE_ONLY.includes(path);
