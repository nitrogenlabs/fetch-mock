import fetch from 'fetch-everywhere';
import glob from 'glob-to-regexp';
import express from 'path-to-regexp';
import querystring from 'querystring';
import URL from 'url';

export interface RouteType {
  readonly headers: any;
}

const normalizeRequest = (url, options) => {
  const {Request} = fetch;
  if(Request.prototype.isPrototypeOf(url)) {
    return {
      url: url.url,
      method: url.method,
      headers: (() => {
        const headers = {};
        url.headers.forEach((name: string) => headers[name] = url.headers.name);
        return headers;
      })()
    };
  } else {
    return {
      url,
      method: options && options.method || 'GET',
      headers: options && options.headers
    };
  }
};

const stringMatchers = {
  begin: (target: string) => ({url}) => url.indexOf(target) === 0,
  end: (target: string) => ({url}) => url.substr(-target.length) === target,
  glob: (target: string) => {
    const urlRX = glob(target)
    return ({url}) => urlRX.test(url)
  },
  express: (target: string) => {
    const urlRX = express(target)
    return ({url}) => urlRX.test(url)
  }
}

const headersToLowerCase = (headers: Headers) => Object.keys(headers).reduce((obj, k: string) => {
  obj[k.toLowerCase()] = headers[k]
  return obj;
}, {});


const areHeadersEqual = (actualHeader, expectedHeader) => {
  actualHeader = Array.isArray(actualHeader) ? actualHeader : [actualHeader];
  expectedHeader = Array.isArray(expectedHeader) ? expectedHeader : [expectedHeader];

  if(actualHeader.length !== expectedHeader.length) {
    return false;
  }

  return actualHeader.every((val, i) => val === expectedHeader[i])
}

const getHeaderMatcher = (options: any) => {
  const expectedHeaders: any = options.headers;

  if(!expectedHeaders) {
    return () => true;
  }

  const expectation = headersToLowerCase(expectedHeaders);

  return (route: RouteType) => {
    const {headers = {}} = route;
    let updatedHeaders: any;
    const {Headers} = fetch;

    if(headers instanceof Headers) {
      // node-fetch 1 Headers
      if(typeof headers.raw === 'function') {
        updatedHeaders = Object.entries(headers.raw());
      }

      updatedHeaders = [...headers].reduce((map, [key, val]) => {
        map[key] = val;
        return map;
      }, {});
    }

    const lowerCaseHeaders = headersToLowerCase(updatedHeaders);

    return Object.keys(expectation).every((headerName: string) => {
      return areHeadersEqual(lowerCaseHeaders[headerName], expectation[headerName]);
    })
  }
}

const getMethodMatcher = (route) => {
  return ({method}) => {
    return !route.method || route.method === (method ? method.toLowerCase() : 'get');
  };
}

const getQueryStringMatcher = (route) => {
  if(!route.query) {
    return () => true;
  }
  const keys = Object.keys(route.query);
  return ({url}) => {
    const query = querystring.parse(URL.parse(url).query);
    return keys.every((key: string) => query[key] === route.query[key]);
  }
}

const getUrlMatcher = (route) => {

  // When the matcher is a function it should not be compared with the url
  // in the normal way
  if(typeof route.matcher === 'function') {
    return () => true;
  }

  if(route.matcher instanceof RegExp) {
    const urlRX = route.matcher;
    return ({url}) => urlRX.test(url);
  }

  if(route.matcher === '*') {
    return () => true;
  }

  if(route.matcher.indexOf('^') === 0) {
    throw new Error('Using \'^\' to denote the start of a url is deprecated. Use \'begin:\' instead');
  }

  for(let shorthand in stringMatchers) {
    if(route.matcher.indexOf(shorthand + ':') === 0) {
      const url = route.matcher.replace(new RegExp(`^${shorthand}:`), '')
      return stringMatchers[shorthand](url);
    }
  }

  // if none of the special syntaxes apply, it's just a simple string match
  const expectedUrl = route.matcher;
  return ({url}) => {
    if(route.query && expectedUrl.indexOf('?')) {
      return url.indexOf(expectedUrl) === 0;
    }
    return url === expectedUrl;
  }
}

const sanitizeRoute = (route) => {
  route = {...route};

  if(typeof route.response === 'undefined') {
    throw new Error('Each route must define a response');
  }

  if(!route.matcher) {
    throw new Error('Each route must specify a string, regex or function to match calls to fetch');
  }

  if(!route.name) {
    route.name = route.matcher.toString();
    route.__unnamed = true;
  }

  if(route.method) {
    route.method = route.method.toLowerCase();
  }

  return route;
}

const getFunctionMatcher = (route) => {
  if(typeof route.matcher === 'function') {
    const matcher = route.matcher;
    return (req, [url, options]) => matcher(url, options);
  } else {
    return () => true;
  }
}

const generateMatcher = (route) => {
  const matchers = [
    getQueryStringMatcher(route),
    getMethodMatcher(route),
    getHeaderMatcher(route),
    getUrlMatcher(route),
    getFunctionMatcher(route)
  ];

  return (url, options) => {
    const req = normalizeRequest(url, options);
    return matchers.every((matcher) => matcher(req, [url, options]))
  };
}

const limitMatcher = (route) => {
  if(!route.repeat) {
    return;
  }

  const matcher = route.matcher;
  let timesLeft = route.repeat;
  route.matcher = (url, options) => {
    const match = timesLeft && matcher(url, options);

    if(match) {
      timesLeft--;
      return true;
    }

    return false;
  }
  route.reset = () => timesLeft = route.repeat;
}

export const compileRoute = (route) => {
  route = sanitizeRoute(route);
  route.matcher = generateMatcher(route);
  limitMatcher(route);
  return route;
};
