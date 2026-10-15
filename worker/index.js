import legacy from './legacy-worker.js';
import random from './random-api.js';
export { validateFinish } from './legacy-worker.js';
export default {fetch(request,env){return new URL(request.url).pathname.startsWith('/api/v2/')?random.fetch(request,env):legacy.fetch(request,env);}};
