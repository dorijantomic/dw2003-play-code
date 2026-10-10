// One origin for every browser verifier in tools/.
//
// Each verifier keeps its own default port, so with VERIFY_PORT unset this
// returns exactly the URL that script always used. Set VERIFY_PORT to point a
// verifier at a different locally served web/ tree, which is what lets several
// verifiers run at the same time instead of all queueing on 8741/8742.
export function baseUrl(defaultPort) {
  return `http://localhost:${process.env.VERIFY_PORT ?? defaultPort}`;
}