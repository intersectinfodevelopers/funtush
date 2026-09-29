/**
 * Express 4 never sees a rejected promise: an `async (req, res) => { throw … }`
 * handler with no try/catch leaves the request hanging (no response is ever
 * sent) and surfaces only as an unhandled rejection. With ~190 async handlers a
 * single missing try/catch is enough for an authenticated caller to pin
 * connections open until the server-side timeout — a cheap denial of service.
 *
 * This patches the router's Layer so a promise returned by any route handler or
 * middleware that rejects is forwarded to `next(err)`, i.e. to the normal error
 * handler. It must be imported before any router is created.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Layer = require("express/lib/router/layer");

type Handler = (req: unknown, res: unknown, next: (err?: unknown) => void) => unknown;

const wrap = (fn: Handler): Handler => {
  // 4-argument functions are error handlers; leave those alone
  if (fn.length === 4) return fn;
  return function wrapped(this: unknown, req, res, next) {
    const result = fn.call(this, req, res, next);
    if (result && typeof (result as Promise<unknown>).catch === "function") {
      (result as Promise<unknown>).catch(next);
    }
    return result;
  } as Handler;
};

Object.defineProperty(Layer.prototype, "handle", {
  enumerable: true,
  configurable: true,
  get() {
    return this.__handle;
  },
  set(fn: Handler) {
    this.__handle = wrap(fn);
  },
});
