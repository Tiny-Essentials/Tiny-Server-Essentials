import { createReadStream, existsSync } from 'fs';
import { stat } from 'fs/promises';
import { Readable as ReadableStream } from 'stream';
import { createHash, randomBytes } from 'crypto';
import { createServer, Server as HttpServer } from 'http';
import { Server as HttpsServer } from 'https';
import express from 'express';
import createHttpError from 'http-errors';

import TinyWebInstance from './TinyWebInstance.mjs';
import { extractIpList } from './Utils.mjs';

/** @typedef {import('express').Request} Request */
/**
 * @typedef {number} HttpStatusCode
 */

/**
 * @typedef {(req: Request) => string[]} IPExtractor
 */

/**
 * @typedef {(req: Request) => boolean} DomainValidator
 */

/**
 * Represents the structured data extracted from an HTTP Origin header.
 *
 * @typedef {Object} OriginData
 * @property {string|null} raw - The raw Origin header value.
 * @property {string} [protocol] - The protocol used (e.g., 'http' or 'https').
 * @property {string} [hostname] - The hostname extracted from the origin.
 * @property {string} [port] - The port number (explicit or default based on protocol).
 * @property {string} [full] - The full reconstructed URL from the origin.
 * @property {string} [error] - Any parsing error encountered while processing the origin.
 */

/**
 * TinyExpress provides a simple wrapper and factory for Express v5,
 * offering utilities and enhanced middleware management.
 *
 * This class is ideal for quickly spinning up an Express app with
 * strongly-typed middleware and error-handling support.
 *
 * @class
 */
class TinyExpress {
  /** @typedef {import('express').Application} ExpressApp */
  /** @typedef {import('express').Response} Response */
  /** @typedef {import('express').NextFunction} NextFunction */
  /** @typedef {import('http-errors').HttpError} HttpError */
  /** @typedef {import('express').RequestHandler} RequestHandler */
  /** @typedef {import('express').ErrorRequestHandler} ErrorRequestHandler */

  #domainTypeChecker = 'hostname';
  #forbiddenDomainMessage = 'Forbidden domain.';

  /** @type {{ [key: string]: IPExtractor }} */
  #ipExtractors = {};

  /** @type {string} */
  #activeExtractor = 'DEFAULT';

  /**
   * @type {{
   * refreshCookieName: string;
   * cookieName: string;
   * headerName: string;
   * errMessage: string;
   * enabled: boolean;
   * refreshInterval: number|null
   * }}
   * */
  #csrf = {
    refreshCookieName: '_csrfRefresh',
    cookieName: '_csrf',
    headerName: 'X-Csrf-Token',
    errMessage: 'Invalid or missing CSRF token',
    enabled: false,
    refreshInterval: null,
  };

  /**
   * A list of domain validators using different request properties.
   *
   * Each property in this object represents a header or request property to check the domain against.
   * Each associated array contains one or more callback functions that validate or extract the domain.
   *
   * @type {{
   *   [key: string]: DomainValidator
   * }}
   */
  #domainValidators = {};

  /**
   * A list of standard HTTP status codes, their default messages,
   * and some common non-official or less standard status codes.
   * Follows the format { [statusCode]: message }.
   *
   * @readonly
   * @type {Object<number|string, string>}
   */
  #httpCodes = {
    // Informational
    100: 'Continue',
    101: 'Switching Protocols',
    102: 'Processing', // WebDAV
    103: 'Early Hints', // RFC 8297

    // Successful
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    203: 'Non-Authoritative Information',
    204: 'No Content',
    205: 'Reset Content',
    206: 'Partial Content',
    207: 'Multi-Status', // WebDAV
    208: 'Already Reported', // WebDAV
    226: 'IM Used', // HTTP Delta encoding

    // Redirection
    300: 'Multiple Choices',
    301: 'Moved Permanently',
    302: 'Found',
    303: 'See Other',
    304: 'Not Modified',
    305: 'Use Proxy',
    306: 'Unused',
    307: 'Temporary Redirect',
    308: 'Permanent Redirect', // RFC 7538

    // Client Error
    400: 'Bad Request',
    401: 'Unauthorized',
    402: 'Payment Required',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    407: 'Proxy Authentication Required',
    408: 'Request Timeout',
    409: 'Conflict',
    410: 'Gone',
    411: 'Length Required',
    412: 'Precondition Failed',
    413: 'Request Entity Too Large',
    414: 'Request-URI Too Long',
    415: 'Unsupported Media Type',
    416: 'Requested Range Not Satisfiable',
    417: 'Expectation Failed',
    418: "I'm a teapot", // RFC 2324 (April Fools)
    421: 'Misdirected Request', // RFC 7540
    422: 'Unprocessable Entity', // WebDAV
    423: 'Locked', // WebDAV
    424: 'Failed Dependency', // WebDAV
    425: 'Too Early', // RFC 8470
    426: 'Upgrade Required',
    428: 'Precondition Required', // RFC 6585
    429: 'Too Many Requests', // RFC 6585
    431: 'Request Header Fields Too Large', // RFC 6585
    451: 'Unavailable For Legal Reasons', // RFC 7725

    // Server Error
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
    505: 'HTTP Version Not Supported',
    506: 'Variant Also Negotiates', // RFC 2295
    507: 'Insufficient Storage', // WebDAV
    508: 'Loop Detected', // WebDAV
    510: 'Not Extended', // RFC 2774
    511: 'Network Authentication Required', // RFC 6585

    // Common but unofficial
    520: 'Web Server Returned an Unknown Error', // Cloudflare
    521: 'Web Server Is Down', // Cloudflare
    522: 'Connection Timed Out', // Cloudflare
    523: 'Origin Is Unreachable', // Cloudflare
    524: 'A Timeout Occurred', // Cloudflare
    525: 'SSL Handshake Failed', // Cloudflare
    526: 'Invalid SSL Certificate', // Cloudflare
  };

  /**
   * Creates and initializes a new TinyExpress instance.
   *
   * This wrapper extends the base Express application with support for domain-based request validation,
   * automatic middleware injection, and customizable validator logic.
   *
   * When instantiated, the following behaviors are applied:
   * - Injects a middleware to validate incoming requests using the active domain validator (based on `#domainTypeChecker`).
   *   If the validator does not exist or the domain is invalid, a 403 Forbidden error is triggered.
   * - Automatically registers the default loopback domains: `localhost`, `127.0.0.1`, and `::1`.
   * - Registers default domain validators for `x-forwarded-host`, `hostname`, and `host` headers.
   *
   * @constructor
   * @param {ExpressApp} [app=express()] - An optional existing Express application instance.
   *                                       If not provided, a new instance is created using `express()`.
   */
  constructor(app = express()) {
    this.root = app;
    this.root.use(
      /** @type {RequestHandler} */
      (req, res, next) => {
        const type = this.#domainTypeChecker;
        let valid = false;
        if (type === 'ALL') {
          const validators = Object.values(this.#domainValidators);
          for (const validator of validators) {
            if (typeof validator !== 'function')
              throw new Error(`Domain validator "${type}" is not registered.`);
            valid = validator(req);
            if (valid) break;
          }
        } else {
          const validator = this.#domainValidators[type];
          if (typeof validator !== 'function')
            throw new Error(`Domain validator "${type}" is not registered.`);
          valid = validator(req);
        }
        if (!valid) {
          const err = createHttpError(403, this.#forbiddenDomainMessage);
          next(err);
          return;
        }
        next();
      },
    );
  }

  /**
   * Modifies a CSRF config option, only if the key exists and value is a string.
   * @param {string} key - Either "cookieName", "headerName", or "errMessage".
   * @param {string} value - The new value to assign.
   */
  setCsrfOption(key, value) {
    if (typeof key !== 'string')
      throw new Error(`Expected 'key' to be a string, got ${typeof key}`);
    if (key === 'enabled' || key === 'refreshInterval' || !Object.hasOwn(this.#csrf, key))
      throw new Error(
        `Invalid config key '${key}'. Allowed keys: ${Object.keys(this.#csrf)
          .filter((k) => !['enabled', 'refreshInterval'].includes(k))
          .join(', ')}`,
      );
    if (typeof value !== 'string' || value.trim() === '')
      throw new Error(`Value for '${key}' must be a non-empty string`);
    // @ts-ignore
    this.#csrf[key] = value;
  }

  /**
   * Sets the refresh interval in milliseconds for CSRF tokens.
   * @param {number|null} ms - Must be a positive number or null to disable.
   */
  setCsrfRefreshInterval(ms) {
    if (ms !== null && (!Number.isInteger(ms) || ms <= 0))
      throw new Error('refreshInterval must be a positive integer or null');
    this.#csrf.refreshInterval = ms;
  }

  /**
   * Returns a shallow copy of the current CSRF config.
   * @returns {{
   * refreshCookieName: string;
   * cookieName: string;
   * headerName: string;
   * errMessage: string;
   * enabled: boolean;
   * refreshInterval: number|null
   * }}
   */
  geCsrftOptions() {
    return { ...this.#csrf };
  }

  /**
   * Middleware to set a CSRF token cookie if it's not already set or expired.
   * @param {number} [bytes=24] - Number of bytes to generate for the CSRF token.
   * @param {{
   *   httpOnly?: boolean,
   *   sameSite?: 'lax' | 'strict' | 'none',
   *   secure?: boolean
   * }} [options={}]
   */
  installCsrfToken(bytes = 24, { httpOnly = false, sameSite = 'lax', secure = false } = {}) {
    if (this.#csrf.enabled) throw new Error('CSRF protection has already been enabled');
    if (!Number.isInteger(bytes) || bytes <= 0)
      throw new TypeError('bytes must be a positive integer');
    if (typeof httpOnly !== 'boolean') throw new TypeError('httpOnly must be a boolean');
    if (!['lax', 'strict', 'none'].includes(sameSite))
      throw new TypeError("sameSite must be one of 'lax', 'strict', or 'none'");
    if (typeof secure !== 'boolean') throw new TypeError('secure must be a boolean');

    this.#csrf.enabled = true;
    const refresh = this.#csrf.refreshInterval;

    this.root.use((req, res, next) => {
      let token = req.cookies?.[this.#csrf.cookieName];
      const csrfIssuedAt = Number(req.cookies?.[this.#csrf.refreshCookieName]);
      const now = Date.now();

      if (
        !token ||
        (refresh &&
          (!Number.isFinite(csrfIssuedAt) ||
            Number.isNaN(csrfIssuedAt) ||
            !csrfIssuedAt ||
            now - csrfIssuedAt > refresh))
      ) {
        token = randomBytes(bytes).toString('hex');
        res.cookie(this.#csrf.cookieName, token, {
          httpOnly,
          sameSite,
          secure,
        });

        req.cookies[this.#csrf.cookieName] = token;

        if (refresh) {
          res.cookie(this.#csrf.refreshCookieName, String(now), {
            httpOnly,
            sameSite,
            secure,
          });
          req.cookies[this.#csrf.refreshCookieName] = String(now);
        }
      }

      next();
    });
  }

  /**
   * Middleware to verify that the request contains a valid CSRF token in the header.
   * @returns {RequestHandler}
   */
  verifyCsrfToken() {
    return (req, res, next) => {
      const tokenFromCookie = req.cookies?.[this.#csrf.cookieName];
      const tokenFromHeader = req.get(this.#csrf.headerName);
      if (!tokenFromCookie || !tokenFromHeader || tokenFromCookie !== tokenFromHeader) {
        const err = createHttpError(403, this.#csrf.errMessage);
        next(err);
        return;
      }
      next();
    };
  }

  /**
   * Returns the current TinyWeb instance.
   *
   * @returns {TinyWebInstance} The active Http server.
   */
  getWeb() {
    if (!(this.web instanceof TinyWebInstance))
      throw new Error('this.web expects an instance of TinyWebInstance.');
    return this.web;
  }

  /**
   * Returns the current Http server instance.
   *
   * @returns {HttpServer | HttpsServer} The active Http server.
   */
  getServer() {
    return this.getWeb().getServer();
  }

  /**
   * Returns the Express app instance.
   *
   * @returns {import('express').Application} Express application instance.
   */
  getRoot() {
    return this.root;
  }

  /**
   * Init instance.
   *
   * @param {TinyWebInstance|HttpServer|HttpsServer} [web=new TinyWebInstance()] - An instance of TinyWebInstance.
   *
   * @throws {Error} If `web` is not an instance of TinyWebInstance.
   */
  init(web = new TinyWebInstance(createServer(this.root))) {
    if (
      !(web instanceof TinyWebInstance) &&
      // @ts-ignore
      !(web instanceof HttpServer) &&
      // @ts-ignore
      !(web instanceof HttpsServer)
    )
      throw new Error('init expects an instance of TinyWebInstance, HttpServer, or HttpsServer.');

    /** @type {TinyWebInstance} */ this.web;
    if (web instanceof TinyWebInstance) this.web = web;
    else this.web = new TinyWebInstance(web);

    if (!this.web.hasDomain('localhost')) this.web.addDomain('localhost');
    if (!this.web.hasDomain('127.0.0.1')) this.web.addDomain('127.0.0.1');
    if (!this.web.hasDomain('::1')) this.web.addDomain('::1');

    this.addDomainValidator('x-forwarded-host', (req) =>
      typeof req.headers['x-forwarded-host'] === 'string'
        ? this.web.canDomain(req.headers['x-forwarded-host'])
        : false,
    );

    this.addDomainValidator('hostname', (req) =>
      typeof req.hostname === 'string' ? this.web.canDomain(req.hostname) : false,
    );

    this.addDomainValidator('headerHost', (req) =>
      typeof req.headers.host === 'string' ? this.web.canDomain(req.headers.host) : false,
    );

    this.addIpExtractor('remoteAddress', (req) => extractIpList(req.socket?.remoteAddress));
    this.addIpExtractor('ip', (req) => extractIpList(req.ip));
    this.addIpExtractor('ips', (req) => extractIpList(req.ips));
  }

  /**
   * Parses the Origin header from an Express request and extracts structured information.
   *
   * @param {Request} req - The Express request object.
   * @returns {OriginData} An object containing detailed parts of the origin header.
   */
  getOrigin(req) {
    const raw = req.get('Origin');

    /** @type {OriginData} */
    const originInfo = {
      raw: raw || null,
    };

    try {
      if (raw) {
        const url = new URL(raw);
        originInfo.protocol = url.protocol.replace(':', '');
        originInfo.hostname = url.hostname;
        originInfo.port = url.port || (url.protocol === 'https:' ? '443' : '80');
        originInfo.full = url.href;
      }
    } catch (err) {
      originInfo.error = 'Invalid Origin header';
    }

    return originInfo;
  }

  /**
   * Registers a new IP extractor under a specific key.
   *
   * Each extractor must be a function that receives an Express `Request` and returns a string (IP) or null.
   * The key `"DEFAULT"` is reserved and cannot be used directly.
   *
   * @param {string} key
   * @param {IPExtractor} callback
   * @throws {Error} If the key is invalid or already registered.
   */
  addIpExtractor(key, callback) {
    if (typeof key !== 'string') throw new Error('Extractor key must be a string.');
    if (key === 'DEFAULT') throw new Error('"DEFAULT" is a reserved keyword.');
    if (typeof callback !== 'function') throw new Error('Extractor must be a function.');
    if (this.#ipExtractors[key]) throw new Error(`Extractor "${key}" already exists.`);
    this.#ipExtractors[key] = callback;
  }

  /**
   * Removes a registered IP extractor.
   *
   * Cannot remove the extractor currently in use unless it's set to "DEFAULT".
   *
   * @param {string} key
   * @throws {Error} If the key is invalid or in use.
   */
  removeIpExtractor(key) {
    if (typeof key !== 'string') throw new Error('Extractor key must be a string.');
    if (!(key in this.#ipExtractors)) throw new Error(`Extractor "${key}" not found.`);
    if (this.#activeExtractor === key)
      throw new Error(`Cannot remove extractor "${key}" because it is currently in use.`);
    delete this.#ipExtractors[key];
  }

  /**
   * Returns a shallow clone of the current extractors.
   *
   * @returns {{ [key: string]: IPExtractor }}
   */
  getIpExtractors() {
    return { ...this.#ipExtractors };
  }

  /**
   * Sets the currently active extractor key.
   *
   * @param {string} key
   * @throws {Error} If the key is not found.
   */
  setActiveIpExtractor(key) {
    if (key !== 'DEFAULT' && !(key in this.#ipExtractors))
      throw new Error(`Extractor "${key}" not found.`);
    this.#activeExtractor = key;
  }

  /**
   * Returns the current extractor function based on the active key.
   *
   * @returns {IPExtractor}
   */
  getActiveExtractor() {
    if (this.#activeExtractor === 'DEFAULT') {
      // Fallback behavior (standard Express logic)
      return (req) => {
        const ips = [
          ...extractIpList(req.ip),
          ...extractIpList(req.ips),
          ...extractIpList(req.socket?.remoteAddress),
        ];
        const uniqueIps = [...new Set(ips)];
        return uniqueIps;
      };
    }
    return this.#ipExtractors[this.#activeExtractor];
  }

  /**
   * Extracts the IP address from a request using the active extractor.
   * @param {Request} req
   * @returns {string[]}
   */
  extractIp(req) {
    return this.getActiveExtractor()(req);
  }

  /**
   * Registers a new domain validator under a specific key.
   *
   * Each validator must be a function that receives an Express `Request` object and returns a boolean.
   * The key `"ALL"` is reserved and cannot be used as a validator key.
   *
   * @param {string} key - The key name identifying the validator (e.g., 'host', 'x-forwarded-host').
   * @param {DomainValidator} callback - The validation function to be added.
   * @throws {Error} If the key is not a string.
   * @throws {Error} If the key is "ALL".
   * @throws {Error} If the callback is not a function.
   * @throws {Error} If a validator with the same key already exists.
   */
  addDomainValidator(key, callback) {
    if (typeof key !== 'string') throw new Error('Validator key must be a string.');
    if (key === 'ALL')
      throw new Error('"ALL" is a reserved keyword and cannot be used as a validator key.');
    if (typeof callback !== 'function') throw new Error('Validator callback must be a function.');
    if (this.#domainValidators[key]) throw new Error(`Validator with key "${key}" already exists.`);
    this.#domainValidators[key] = callback;
  }

  /**
   * Removes a registered domain validator by its key.
   *
   * Cannot remove the validator currently being used by the domain type checker,
   * unless the type checker is set to "ALL".
   *
   * @param {string} key - The key name of the validator to remove.
   * @throws {Error} If the key is not a string.
   * @throws {Error} If no validator is found under the given key.
   * @throws {Error} If the validator is currently in use by the domain type checker.
   */
  removeDomainValidator(key) {
    if (typeof key !== 'string') throw new Error('Validator key must be a string.');
    if (!(key in this.#domainValidators)) throw new Error(`Validator with key "${key}" not found.`);
    if (this.#domainTypeChecker === key)
      throw new Error(`Cannot remove validator "${key}" because it is currently in use.`);
    delete this.#domainValidators[key];
  }

  /**
   * Returns a shallow clone of the current domain validators map.
   *
   * The returned object maps each key to its corresponding validation function.
   *
   * @returns {{ [key: string]: DomainValidator }} A cloned object of the validators.
   */
  getDomainValidators() {
    return { ...this.#domainValidators };
  }

  /**
   * Sets the current domain validation strategy by key name.
   *
   * The provided key must exist in the registered domain validators,
   * or be the string `"ALL"` to enable all validators simultaneously (not recommended).
   *
   * @param {string} key - The key of the validator to use (e.g., 'hostname', 'x-forwarded-host'), or 'ALL'.
   * @throws {Error} If the key is not a string.
   * @throws {Error} If the key is not found among the validators and is not 'ALL'.
   */
  setDomainTypeChecker(key) {
    if (typeof key !== 'string') throw new Error('Domain type checker must be a string.');
    if (key !== 'ALL' && !(key in this.#domainValidators))
      throw new Error(`Validator key "${key}" is not registered.`);
    this.#domainTypeChecker = key;
  }

  /**
   * Retrieves the HTTP status message for a given status code.
   *
   * @param {number|string} code - The HTTP status code to look up.
   * @returns {string} The corresponding HTTP status message.
   * @throws {Error} If the status code is not found.
   */
  getHttpStatusMessage(code) {
    const message = this.#httpCodes[code];
    if (typeof message !== 'string')
      throw new Error(`HTTP status code "${code}" is not registered.`);
    return message;
  }

  /**
   * Checks whether a given HTTP status code is registered.
   *
   * @param {number|string} code - The HTTP status code to check.
   * @returns {boolean} `true` if the status code exists, otherwise `false`.
   */
  hasHttpStatusMessage(code) {
    return typeof this.#httpCodes[code] === 'string';
  }

  /**
   * Adds a new HTTP status code and message to the list.
   * Does not allow overwriting existing codes.
   *
   * @param {number|string} code - The HTTP status code to add.
   * @param {string} message - The message associated with the code.
   * @throws {Error} If the code already exists.
   * @throws {Error} If the code is not a number or string.
   * @throws {Error} If the message is not a string.
   */
  addHttpCode(code, message) {
    if (typeof code !== 'number' && typeof code !== 'string')
      throw new Error('HTTP status code must be a number or string.');
    if (typeof message !== 'string') throw new Error('HTTP status message must be a string.');
    if (this.#httpCodes.hasOwnProperty(code))
      throw new Error(`HTTP status code "${code}" already exists.`);
    this.#httpCodes[code] = message;
  }

  /**
   * Sends an HTTP response with the given status code.
   * If a callback is provided, it will be called instead of sending an empty response.
   *
   * @param {import('express').Response} res - Express response object.
   * @param {number} code - HTTP status code to send.
   *
   * @returns {import('express').Response} The result of `res.send()` or the callback function.
   *
   * @example
   * appManager.send(res, 404); // Sends 404 Not Found with empty body
   */
  sendHttpError(res, code) {
    if (!res || typeof res.status !== 'function' || typeof res.send !== 'function')
      throw new Error('Expected a valid Express Response object as the first argument');
    if (typeof code !== 'number' || !Number.isInteger(code))
      throw new Error('Expected an integer HTTP status code as the second argument');
    const statusText = this.#httpCodes?.[code];
    if (typeof statusText !== 'string') throw new Error(`Unknown HTTP status code: ${code}`);

    res.header(`HTTP/1.0 ${code} ${this.#httpCodes[code]}`);
    return res.status(code).end();
  }

  /**
   * Installs default error-handling middleware into the Express app instance.
   *
   * This includes:
   * - A catch-all 404 handler that throws a `HttpError` when no routes match.
   * - A global error handler that responds with a JSON-formatted error response,
   *   including the stack trace in development environments.
   *
   * @param {Object} [options={}]
   * @param {string} [options.notFoundMsg='Page not found.']
   * @param {function(HttpStatusCode, HttpError, Request, Response): any} [options.errNext]
   */
  installErrors({
    notFoundMsg = 'Page not found.',
    errNext = (status, err, req, res) => {
      res.json({
        status,
        message:
          typeof err.message === 'string'
            ? err.message
            : this.hasHttpStatusMessage(status)
              ? this.getHttpStatusMessage(status)
              : '',
        stack: process.env.NODE_ENV === 'development' ? err.stack : null,
      });
    },
  } = {}) {
    const app = this.getRoot();
    // Middleware 404
    app.use(
      /** @type {RequestHandler} */ (req, res, next) => {
        const err = createHttpError(404, notFoundMsg);
        return next(err);
      },
    );

    // Middleware global de erro
    app.use(
      /** @type {ErrorRequestHandler} */
      (err, req, res, _next) => {
        const status = err.status || err.statusCode || 500;
        res.status(status);
        return errNext(status, err, req, res);
      },
    );
  }

  /**
   * Express middleware for basic HTTP authentication.
   *
   * Validates the `Authorization` header against provided login credentials.
   * If credentials match, the request proceeds to the next middleware.
   * Otherwise, responds with HTTP 401 Unauthorized.
   *
   * @param {Request} req - Express request object.
   * @param {Response} res - Express response object.
   * @param {NextFunction} next - Express next middleware function.
   * @param {Object} [options={}] - Optional configuration object.
   * @param {string} [options.login] - Expected username for authentication.
   * @param {string} [options.password] - Expected password for authentication.
   * @param {RequestHandler|null} [options.nextError] - Optional error handler middleware called on failed auth.
   * @param {(login: string, password: string) => boolean|Promise<boolean>} [options.validator] - Optional function to validate credentials.
   */
  async authRequest(
    req,
    res,
    next,
    { login = '', password = '', nextError = null, validator } = {},
  ) {
    // authentication middleware
    const auth = { login, password };

    // Parse credentials from Authorization header
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [authLogin, authPassword] = Buffer.from(b64auth, 'base64').toString().split(':');

    // Custom validator or static comparison
    const valid =
      typeof validator === 'function'
        ? await validator(authLogin, authPassword)
        : authLogin === auth.login && authPassword === auth.password;

    if (authLogin && authPassword && valid) {
      return next(); // Access granted
    }

    // Access denied
    res.set('WWW-Authenticate', 'Basic realm="401"');
    if (typeof nextError === 'function') {
      res.status(401);
      nextError(req, res, next);
      return;
    }
    res.status(401).end();
  }

  /**
   * Sends a file response with appropriate headers.
   *
   * This function sends a file (as a Buffer) directly in the HTTP response,
   * setting standard headers such as Content-Type, Cache-Control, Last-Modified, and Content-Disposition.
   *
   * @param {Response} res - The HTTP response object to send the file through.
   * @param {Object} [options={}] - Configuration options for the file response.
   * @param {string} [options.contentType='text/plain'] - The MIME type of the file being sent.
   * @param {number} [options.fileMaxAge=0] - Max age in seconds for the Cache-Control header.
   * @param {Buffer} [options.file] - The file contents to send as a buffer. Required.
   * @param {Date | number | string | null} [options.lastModified] - The last modification time for the Last-Modified header.
   * @param {string | null} [options.fileName] - Optional file name for the Content-Disposition header.
   * @throws {Error} If required options are missing or invalid.
   * @beta
   */
  sendFile(
    res,
    { contentType = 'text/plain', fileMaxAge = 0, file, lastModified, fileName = null } = {},
  ) {
    if (!Buffer.isBuffer(file)) throw new Error('"file" must be a Buffer instance.');
    if (!Number.isInteger(fileMaxAge) || fileMaxAge < 0)
      throw new Error('"fileMaxAge" must be a non-negative integer.');
    if (typeof fileName !== 'string' && fileName !== null)
      throw new Error('"fileName" must be a string.');
    if (
      lastModified !== null &&
      typeof lastModified !== 'string' &&
      typeof lastModified !== 'number' &&
      !(lastModified instanceof Date)
    )
      throw new Error('"lastModified" is not a valid date value.');

    // File Type Headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');

    // Content-MD5 Header
    res.setHeader('Content-MD5', createHash('md5').update(file).digest('base64'));

    // Last-Modified Header
    if (
      typeof lastModified === 'string' ||
      typeof lastModified === 'number' ||
      lastModified instanceof Date
    ) {
      const date = new Date(lastModified);
      if (!Number.isNaN(date.getTime())) res.setHeader('Last-Modified', date.toUTCString());
    }

    // ETag Header (weak ETag based on MD5 hash)
    const etag = `"${createHash('md5').update(file).digest('hex')}"`;
    res.setHeader('ETag', etag);

    // Cache Control Headers
    const expires = new Date(Date.now() + fileMaxAge);
    res.setHeader('Expires', expires.toUTCString());
    res.setHeader('Cache-Control', `public, max-age=${fileMaxAge}`);

    // Pragma header (legacy)
    if (fileMaxAge === 0) {
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }

    // Content Length
    const byteLength = file.byteLength;
    if (!Number.isInteger(byteLength) || byteLength < 0)
      throw new Error('Failed to determine valid file length.');
    res.setHeader('Content-Length', byteLength);

    if (typeof fileName === 'string')
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    // Send Response
    res.send(file);
  }

  /**
   * Streams a file response with support for range headers (video/audio streaming).
   *
   * This function streams a file or provided readable stream to the client, supporting HTTP range requests.
   * It is useful for serving large media files where partial content responses are required.
   *
   * @param {Request} req - The HTTP request object, used to detect range headers.
   * @param {Response} res - The HTTP response object to stream the file through.
   * @param {Object} [options={}] - Configuration options for streaming.
   * @param {boolean} [options.rangeOnlyMode=false] - When enabled, prevents full file streaming and enforces HTTP Range-based partial responses only.
   * @param {string} [options.filePath] - The absolute file path to stream. Required if no stream is provided.
   * @param {ReadableStream} [options.stream] - A readable stream to use instead of reading from filePath.
   * @param {string} [options.contentType='application/octet-stream'] - The MIME type of the streamed content.
   * @param {number} [options.fileMaxAge=0] - Max age in seconds for the Cache-Control header.
   * @param {Date | number | string | null} [options.lastModified] - The last modification time for the Last-Modified header.
   * @param {string | null} [options.fileName] - Optional file name for the Content-Disposition header.
   * @beta
   */
  async streamFile(
    req,
    res,
    {
      filePath,
      stream,
      contentType = 'application/octet-stream',
      fileMaxAge = 0,
      lastModified = null,
      fileName = null,
      rangeOnlyMode = false,
    } = {},
  ) {
    const range = req.headers.range;
    let total = 0;
    let statData = null;

    if (filePath) {
      if (typeof filePath !== 'string')
        throw new Error('"filePath" must be a valid file path string.');

      if (!existsSync(filePath)) throw new Error(`File "${filePath}" not found.`);

      statData = await stat(filePath);
      total = statData.size;
    } else if (!(stream instanceof ReadableStream))
      throw new Error('Either "filePath" or "stream" must be provided.');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');

    // Last-Modified
    const lastModDate = new Date(lastModified || statData?.mtime || Date.now());
    res.setHeader('Last-Modified', lastModDate.toUTCString());

    // Cache headers
    const expires = new Date(Date.now() + fileMaxAge);
    res.setHeader('Expires', expires.toUTCString());
    res.setHeader(
      'Cache-Control',
      fileMaxAge > 0 ? `public, max-age=${fileMaxAge}` : 'no-cache, no-store, must-revalidate',
    );

    if (fileMaxAge === 0) res.setHeader('Pragma', 'no-cache');
    if (typeof fileName === 'string')
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);

    // --- RANGE SUPPORT ONLY IF filePath is available ---
    if (range && filePath) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : total - 1;

      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= total) {
        res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
        return;
      }

      const chunkSize = end - start + 1;
      res.status(206); // Partial Content
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', chunkSize);

      const partialStream = createReadStream(filePath, { start, end });
      partialStream.pipe(res);
    } else {
      if (filePath) {
        if (rangeOnlyMode && !range) {
          const start = 0;
          const end = Math.min(total - 1, 1024 * 512); // First 512KB
          const partialStream = createReadStream(filePath, { start, end });
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
          res.setHeader('Content-Length', end - start + 1);
          partialStream.pipe(res);
        } else {
          res.setHeader('Content-Length', total);
          const fullStream = createReadStream(filePath);
          fullStream.pipe(res);
        }
      } else if (stream instanceof ReadableStream) {
        // Using provided stream
        stream.pipe(res);
      } else throw new Error('Either "stream" must be provided.');
    }
  }

  /**
   * Enables a lightweight test-only Express mode for serving static files and open API testing.
   *
   * This method sets up an unrestricted CORS environment and exposes a static folder,
   * allowing any origin to access the content and APIs freely. It also includes permissive
   * CORS headers and custom middleware headers for development diagnostics.
   *
   * ⚠️ **Do not use this in production!**
   * This mode disables all security measures and is intended **only** for local development,
   * debugging, or experimentation. All origins, headers, and methods are allowed without validation.
   *
   * @throws {Error} If the current environment is not "development".
   * @throws {TypeError} If `folder` is not a non-empty string.
   *
   * @param {string} folder - The path to the folder that will be served as static content.
   */
  freeMode(folder) {
    if (process.env.NODE_ENV !== 'development')
      throw new Error('[freeMode] This method is only allowed in development mode.');
    if (typeof folder !== 'string' || folder.trim() === '')
      throw new TypeError('[freeMode] Expected "folder" to be a non-empty string.');
    this.root.use(express.static(folder));
    this.root.use((req, res, next) => {
      // Website you wish to allow to connect
      res.setHeader('Access-Control-Allow-Origin', '*');

      // Request methods you wish to allow
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

      // Request headers you wish to allow
      res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

      // Set to true if you need the website to include cookies in the requests sent
      // to the API (e.g. in case you use sessions)
      res.setHeader('Access-Control-Allow-Credentials', 'true');

      // Pass to next layer of middleware
      next();
    });
  }
}

export default TinyExpress;
