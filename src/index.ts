import fetch from 'fetch-everywhere';

import {compileRoute} from './compileRoute';
import {ResponseBuilder} from './responseBuilder';

export interface FetchMockConfig {
  readonly fallbackToNetwork?: boolean;
  readonly includeContentLength?: boolean;
  readonly isSandbox?: boolean;
  readonly sendAsJson?: boolean;
  readonly warnOnFallback?: boolean;
  readonly overwriteRoutes?: boolean;
}

export class FetchMock {
  global: any;
  uncompiledRoutes: any[] = [];
  fallbackResponse = this.fallbackResponse || undefined;
  mockCalls = {};
  allCalls = [];
  holdingPromises = [];
  config: FetchMockConfig = {
    fallbackToNetwork: false,
    includeContentLength: true,
    isSandbox: true,
    sendAsJson: true,
    warnOnFallback: true,
    overwriteRoutes: true
  }
  realFetch;

  set routes(items: any[]) {
    this.uncompiledRoutes = items;
  }

  get routes() {
    return this.uncompiledRoutes.map((route) => compileRoute(route));
  }

  constructor() {
    // Methods
    this.addRoute = this.addRoute.bind(this);
    this.called = this.called.bind(this);
    this.calls = this.calls.bind(this);
    this.callsFilteredByName = this.callsFilteredByName.bind(this);
    this.catch = this.catch.bind(this);
    this.createMock = this.createMock.bind(this);
    this.done = this.done.bind(this);
    this.executeRouter = this.executeRouter.bind(this);
    this.fetchHandler = this.fetchHandler.bind(this);
    this.flush = this.flush.bind(this);
    this.generateResponse = this.generateResponse.bind(this);
    this.getNativeFetch = this.getNativeFetch.bind(this);
    this.lastCall = this.lastCall.bind(this);
    this.lastOptions = this.lastOptions.bind(this);
    this.lastUrl = this.lastUrl.bind(this);
    this.mock = this.mock.bind(this);
    this.normalizeLastCall = this.normalizeLastCall.bind(this);
    this.once = this.once.bind(this);
    this.push = this.push.bind(this);
    this.reset = this.reset.bind(this);
    this.restore = this.restore.bind(this);
    this.router = this.router.bind(this);
    this.spy = this.spy.bind(this);

    // Set global object
    if(typeof global !== 'undefined') {
      this.global = global;
    } else if(typeof window !== 'undefined') {
      this.global = window;
    }

    // Set fetch methods
    const methods: string[] = ['get', 'post', 'put', 'delete', 'head', 'patch'];
    methods.forEach((method: string) => {
      this[method] = function(matcher, response, options = {}) {
        return this.mock(matcher, response, {...options, method: method.toUpperCase()});
      }
      this[`${method}Once`] = function(matcher, response, options = {}) {
        return this.once(matcher, response, {...options, method: method.toUpperCase()});
      }
    });
  }

  mock(matcher, response, options = {}) {
    let route;

    // Handle the variety of parameters accepted by mock (see README)
    if(matcher && response) {
      route = {matcher, response, ...options};
    } else if(matcher && matcher.matcher) {
      route = matcher;
    } else {
      throw new Error('Invalid parameters passed to fetch-mock');
    }

    this.addRoute(route);

    return this.createMock();
  }

  addRoute(uncompiledRoute) {
    const getMatcher = (route, propName) => (route2) => route[propName] === route2[propName];
    const route = compileRoute(uncompiledRoute);

    const clashes = this.routes.filter(getMatcher(route, 'name'));
    const overwriteRoutes = ('overwriteRoutes' in route) ? route.overwriteRoutes : this.config.overwriteRoutes;

    if(overwriteRoutes === false || !clashes.length) {
      this.uncompiledRoutes.push(uncompiledRoute);
      return this.routes.push(route);
    }

    const methodsMatch = getMatcher(route, 'method');

    if(overwriteRoutes === true) {
      const index = this.routes.indexOf(clashes.find(methodsMatch));
      this.uncompiledRoutes.splice(index, 1, uncompiledRoute);
      return this.routes.splice(index, 1, route);
    }

    if(clashes.some((existingRoute) => !route.method || methodsMatch(existingRoute))) {
      throw new Error('Adding route with same name as existing route. See `overwriteRoutes` option.');
    }

    this.uncompiledRoutes.push(uncompiledRoute);
    return this.routes.push(route);
  };

  createMock() {
    const {isSandbox} = this.config;

    if(!isSandbox) {
      // Do this here rather than in the constructor to ensure it's scoped to the test
      this.realFetch = this.realFetch || this.global.fetch;
      this.global.fetch = this.fetchHandler;
    }

    return this;
  }

  catch(response) {
    if(this.fallbackResponse) {
      console.warn('calling fetchMock.catch() twice - are you sure you want to overwrite the previous fallback response');// eslint-disable-line
    }
    this.fallbackResponse = response || 'ok';
    return this.createMock();
  }

  spy() {
    this.createMock();
    return this.catch(this.getNativeFetch())
  }

  once(matcher, response, options = {}) {
    return this.mock(matcher, response, {...options, repeat: 1});
  };

  reset() {
    this.allCalls = [];
    this.holdingPromises = [];
    this.mockCalls = {};
    this.routes.forEach((route) => route.reset && route.reset());
    return this;
  }

  restore() {
    if(this.realFetch) {
      this.global.fetch = this.realFetch;
      this.realFetch = undefined;
    }
    this.fallbackResponse = undefined;
    this.routes = [];
    this.uncompiledRoutes = [];
    this.reset();
    return this;
  }

  callsFilteredByName(name) {
    if(name === true) {
      return this.allCalls.filter((call) => !call.unmatched);
    }

    if(name === false) {
      return this.allCalls.filter((call) => call.unmatched);
    }

    if(typeof name === 'undefined') {
      return this.allCalls;
    }

    if(this.mockCalls[name]) {
      return this.mockCalls[name];
    }

    return this.allCalls.filter(([url]) => url === name || url.url === name);
  }

  calls(name, options: any = {}) {
    if(typeof options === 'string') {
      options = {method: options};
    }

    let updatedCalls = this.callsFilteredByName(name);

    if(options.method) {
      const testMethod = options.method.toLowerCase();
      updatedCalls = updatedCalls.filter((call) => {
        const [url, opts = {}] = call;
        const method = (url.method || opts.method || 'get').toLowerCase();
        return method === testMethod;
      });
    }

    return updatedCalls;
  }

  lastCall(name, options) {
    return [...this.calls(name, options)].pop();
  }

  normalizeLastCall(name, options) {
    const {Request} = fetch;
    const call = this.lastCall(name, options) || [];

    if(Request.prototype.isPrototypeOf(call[0])) {
      return [call[0].url, call[0]];
    }

    return call;
  }

  lastUrl(name, options) {
    return this.normalizeLastCall(name, options)[0];
  }

  lastOptions(name, options) {
    return this.normalizeLastCall(name, options)[1];
  }

  called(name, options) {
    return !!this.calls(name, options).length;
  }

  flush() {
    return Promise.all(this.holdingPromises);
  }

  done(name, options) {
    const names = name && typeof name !== 'boolean' ? [{name}] : this.routes;

    // Can't use array.every because
    // a) not widely supported
    // b) would exit after first failure, which would break the logging
    return names.map(({name, method}) => {
      // HACK - this is horrible. When the api is eventually updated to update other
      // filters other than a method string it will break... but for now it's ok-ish
      method = options || method;

      if(!this.called(name, method)) {
        console.warn(`Warning: ${name} not called`);// eslint-disable-line
        return false;
      }

      // would use array.find... but again not so widely supported
      const expectedTimes = (this.routes.filter((r) =>
        r.name === name && r.method === method) || [{}])[0].repeat;
      if(!expectedTimes) {
        return true;
      }

      const actualTimes = this.calls(name, method).length;

      if(expectedTimes > actualTimes) {
        console.warn(`Warning: ${name} only called ${actualTimes} times, but ${expectedTimes} expected`);// eslint-disable-line
        return false;
      } else {
        return true;
      }
    })
      .filter((bool: boolean) => !bool).length === 0
  }


  fetchHandler(url, opts) {
    const {Promise} = fetch;
    const response = this.executeRouter(url, opts);

    // If the response says to throw an error, throw it
    // It only makes sense to do this before doing any async stuff below
    // as the async stuff swallows catastrophic errors in a promise
    // Type checking is to deal with sinon spies having a throws property :-0
    if(response.throws && typeof response !== 'function') {
      throw response.throws;
    }

    // this is used to power the .flush() method
    let done;
    this.holdingPromises.push(new Promise((res) => done = res));

    // wrapped in this promise to make sure we respect custom Promise
    // constructors defined by the user
    return new Promise((res, rej) => {
      this.generateResponse(response, url, opts)
        .then(res, rej)
        .then(done, done);
    })
  }

  executeRouter(url, opts) {
    const response = this.router(url, opts);

    if(response) {
      return response;
    }

    if(this.config.warnOnFallback) {
      console.warn(`Unmatched ${opts && opts.method || 'GET'} to ${url}`); // eslint-disable-line
    }

    this.push(null, [url, opts]);

    if(this.fallbackResponse) {
      return this.fallbackResponse;
    }

    if(!this.config.fallbackToNetwork) {
      throw new Error(`No fallback response defined for ${opts && opts.method || 'GET'} to ${url}`)
    }

    return this.getNativeFetch();
  }

  async generateResponse(response, url, opts) {
    const {Response} = fetch;

    // We want to allow things like
    // - function returning a Promise for a response
    // - delaying (using a timeout Promise) a function's execution to generate
    //   a response
    // Because of this we can't safely check for function before Promisey-ness,
    // or vice versa. So to keep it DRY, and flexible, we keep trying until we
    // have something that looks like neither Promise nor function
    while(typeof response === 'function' || typeof response.then === 'function') {
      if(typeof response === 'function') {
        response = response(url, opts);
      } else {
        // Strange .then is to cope with non ES Promises... god knows why it works
        response = await response.then((it) => it);
      }
    }

    // If the response is a pre-made Response, respond with it
    if(Response.prototype.isPrototypeOf(response)) {
      return response;
    }

    // finally, if we need to convert config into a response, we do it
    return new ResponseBuilder(url, response, this.config).exec();
  }

  router(url: string, opts) {
    const route = this.routes.find((route) => route.matcher(url, opts));

    if(route) {
      this.push(route.name, [url, opts]);
      return route.response;
    }
  }

  getNativeFetch() {
    const {isSandbox} = this.config;
    const func = this.realFetch || (isSandbox && fetch);

    if(!func) {
      throw new Error('Falling back to network only available on gloabl fetch-mock, or by setting config.fetch on ' +
        'sandboxed fetch-mock');
    }

    return func;
  }

  push(name, args) {
    if(name) {
      this.mockCalls[name] = this.mockCalls[name] || [];
      this.mockCalls[name].push(args);
      this.allCalls.push(args);
    } else {
      args.unmatched = true;
      this.allCalls.push(args);
    }
  }
}
