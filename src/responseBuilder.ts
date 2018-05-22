import http from 'http';
import isEmpty from 'lodash/fp/isEmpty';
import isPlainObject from 'lodash/fp/isPlainObject';

import {FetchMockConfig} from './FetchMock';

export interface FetchMockResponseOptions {
  readonly headers: any;
  readonly status?: number;
  readonly statusText?: string;
  readonly url?: string;
}

export class ResponseBuilder {
  body: any;
  opts: FetchMockResponseOptions;
  url: string;
  responseConfig: any;
  fetchConfig: FetchMockConfig = {};
  responseConfigProps: string[] = [
    'body',
    'headers',
    'throws',
    'status',
    'redirectUrl',
    'includeContentLength',
    'sendAsJson'
  ];

  constructor(url, responseConfig, fetchConfig: FetchMockConfig = {}) {
    // Methods
    this.exec = this.exec.bind(this);
    this.getOption = this.getOption.bind(this);
    this.redirect = this.redirect.bind(this);
    this.sendAsObject = this.sendAsObject.bind(this);
    this.validateStatus = this.validateStatus.bind(this);

    // Variables
    this.url = typeof url === 'object' ? url.url : url;
    this.responseConfig = responseConfig;
    this.fetchConfig = fetchConfig;
  }

  exec() {
    // If the response config looks like a status, start to generate a simple response
    if(typeof this.responseConfig === 'number') {
      this.responseConfig = {status: this.responseConfig};
      // If the response config is not an object, or is an object that doesn't use
      // any reserved properties, assume it is meant to be the body of the response
    } else if(typeof this.responseConfig === 'string' || this.sendAsObject()) {
      this.responseConfig = {body: this.responseConfig};
    }

    const {body, headers = {}, opts = {}, redirectUrl, status: responseStatus} = this.responseConfig;
    const status: number = this.validateStatus(responseStatus);
    const {STATUS_CODES: statusCodes} = http;
    this.opts = {
      ...opts,
      headers: new Headers(headers),
      status,
      statusText: statusCodes[status.toString()],
      url: redirectUrl || this.url
    }

    let updatedBody: string | Buffer | Uint8Array;

    // Convert to json if we need to
    if(this.getOption('sendAsJson') && body !== null && typeof body === 'object') {
      updatedBody = JSON.stringify(body);

      if(!this.opts.headers.has('Content-Type')) {
        this.opts.headers.set('Content-Type', 'application/json');
      }
    } else if(isPlainObject(body)) {
      if(isEmpty(body)) {
        updatedBody = null;
      } else {
        updatedBody = body.toString();
      }
    } else {
      updatedBody = body;
    }

    // Add a Content-Length header if we need to
    if(
      this.getOption('includeContentLength') &&
      typeof updatedBody === 'string' &&
      !this.opts.headers.has('Content-Length')
    ) {
      this.opts.headers.set('Content-Length', updatedBody.length.toString());
    }

    this.body = updatedBody;

    return this.redirect(new Response(this.body, this.opts));
  }

  sendAsObject(): boolean {
    if(this.responseConfigProps.some((prop: string) => this.responseConfig[prop])) {
      if(Object.keys(this.responseConfig).every((key: string) => this.responseConfigProps.includes(key))) {
        return false;
      } else {
        return true;
      }
    } else {
      return true;
    }
  }

  validateStatus(status: number): number {
    if(!status) {
      return 200;
    }

    if(typeof status === 'number' && status >= 200 || status < 600) {
      return status;
    }

    throw new TypeError(`Invalid status ${status} passed on response object.
To respond with a JSON object that has status as a property assign the object to body
e.g. {"body": {"status: "registered"}}`);
  }

  getOption(name: string) {
    return this.responseConfig[name] === undefined ? this.fetchConfig[name] : this.responseConfig[name];
  }

  redirect(response) {
    const {redirectUrl} = this.responseConfig;
    // When mocking a followed redirect we must wrap the response in an object
    // which sets the redirected flag (not a writable property on the actual
    // response)
    if(redirectUrl) {
      response = Object.create(response, {
        redirected: {
          value: true
        },
        url: {
          value: redirectUrl
        },
        // TODO extend to all other methods and properties as requested by users
        // Such a nasty hack
        text: {
          value: response.text.bind(response)
        },
        json: {
          value: response.json.bind(response)
        }
      })
    }

    return response;
  }
}
