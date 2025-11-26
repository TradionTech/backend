export function ok<T>(data: T) {
  return { ok: true, data };
}
export function fail(message: string, status = 400) {
  const err = new Error(message) as any;
  err.status = status;
  throw err;
}

