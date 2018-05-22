import 'fetch-everywhere';

import {ResponseBuilder} from './responseBuilder';

// const {Request, Response} = fetch as any;

describe('responses', () => {
  let builder: ResponseBuilder;
  const url: string = 'https://nitrogenlabs.com/api/';

  beforeEach(() => {
    const responseConfig = {};
    const fetchConfig = {};
    builder = new ResponseBuilder(url, responseConfig, fetchConfig);
  });

  describe('#exec', () => {
    beforeEach(() => {
      builder = new ResponseBuilder(url, {body: 'test'}, {});
    });

    it('should call redirect method', () => {
      const mockRedirect = jest.spyOn(builder, 'redirect');
      mockRedirect.mockImplementation(() => {});
      builder.exec();
      expect(mockRedirect).toHaveBeenCalled();
      mockRedirect.mockRestore();
    });

    it('should return a body in the mocked response', () => {
      const mockRedirect = jest.spyOn(builder, 'redirect');
      mockRedirect.mockImplementation(() => {});
      builder.exec();
      expect(mockRedirect.mock.calls[0][0].body).toEqual('test');
      mockRedirect.mockRestore();
    });
  });

  describe('#sendAsObject', () => {
    let mockRedirect;

    beforeEach(() => {
      mockRedirect = jest.fn();
      builder = new ResponseBuilder(url, {}, {});
      builder.redirect = mockRedirect;
    });

    it('should return true if config does not contain valid props', () => {
      const send: boolean = builder.sendAsObject();
      expect(send).toEqual(true);
    });
  });
});
