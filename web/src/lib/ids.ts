/** Client-side unique id (session ids, message keys). */
export const newId = (): string =>
  crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
