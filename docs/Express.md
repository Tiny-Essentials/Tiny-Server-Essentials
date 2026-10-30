# 📚 `TinyExpress` Class - Documentation

A custom utility class for enhancing and managing behavior in Express-based HTTP servers. Includes CSRF setup, domain validation, IP extraction, and HTTP status code reference.

---

## 🧾 Type Definitions

### 📥 `Request`

Alias for `express.Request`.

### 🔢 `HttpStatusCode`

Represents a valid HTTP status code as a number.

### 🌐 `IPExtractor`

```ts
(req: Request) => string[]
```

A function that extracts a list of IPs from a request.

### 🛡️ `DomainValidator`

```ts
(req: Request) => boolean
```

A function that validates if the domain of a request matches a rule.

### 🌍 `OriginData`

Represents structured information parsed from an HTTP `Origin` header.

| Property   | Type     | Description                               |                               |
| ---------- | -------- | ----------------------------------------- | ----------------------------- |
| `raw`      | \`string | null\`                                    | The raw `Origin` header value |
| `protocol` | `string` | The protocol used (e.g., `http`, `https`) |                               |
| `hostname` | `string` | The hostname extracted from the origin    |                               |
| `port`     | `string` | The port used (default or explicit)       |                               |
| `full`     | `string` | The full reconstructed origin URL         |                               |
| `error`    | `string` | Any parsing error encountered             |                               |

---

## 🏗️ Private Fields

### 🔍 `#domainTypeChecker`

```ts
string = "hostname"
```

Type of domain field to be validated (e.g., hostname).

### ⛔ `#forbiddenDomainMessage`

```ts
string = "Forbidden domain."
```

Message used when a domain is rejected.

### 🧠 `#ipExtractors`

```ts
{ [key: string]: IPExtractor }
```

Registry of IP extractor functions.

### ✅ `#activeExtractor`

```ts
string = "DEFAULT"
```

Currently active IP extractor name.

### 🛡️ `#csrf`

```ts
{
  refreshCookieName: string,
  cookieName: string,
  headerName: string,
  errMessage: string,
  enabled: boolean,
  refreshInterval: number|null
}
```

CSRF protection configuration object.

* `refreshCookieName`: Name for the refresh token cookie
* `cookieName`: Name for the CSRF token cookie
* `headerName`: Header where CSRF token is expected
* `errMessage`: Error message on CSRF failure
* `enabled`: Whether CSRF is currently active
* `refreshInterval`: Time interval (ms) for CSRF refresh

### 🧪 `#domainValidators`

```ts
{ [key: string]: DomainValidator }
```

A collection of validation functions per request property to validate incoming request domains.

---

## 📡 `#httpCodes`

```ts
readonly { [statusCode: number|string]: string }
```

A lookup object for all standard and some common unofficial HTTP status codes with their descriptions. Includes:

* 📘 Informational: `100–103`
* ✅ Successful: `200–226`
* 🔁 Redirection: `300–308`
* ❌ Client errors: `400–451`
* 💥 Server errors: `500–511`
* ☁️ Cloudflare-specific unofficial codes: `520–526`

Example usage:

```js
tinyExpress.#httpCodes[404]; // "Not Found"
```

---

## 🚀 Constructor: `new TinyExpress(app?)`

Creates and initializes a new `TinyExpress` instance.

### 🔧 Features:

* ✅ Injects domain validator middleware using `#domainTypeChecker`.
* 🔒 Automatically blocks invalid requests with `403 Forbidden`.
* 🌀 Registers loopback domains: `localhost`, `127.0.0.1`, and `::1`.
* 🛡️ Includes default domain validators for:

  * `x-forwarded-host`
  * `hostname`
  * `host`

```js
new TinyExpress(app);
```

**Parameters:**

* `app` *(optional)* — an existing Express app. Defaults to `express()`.

---

## 🧬 `setCsrfOption(key, value)`

Modifies a CSRF config option (except for internal controls like `enabled`).

**Accepted keys:**

* `"cookieName"`
* `"headerName"`
* `"errMessage"`

```js
tiny.setCsrfOption('cookieName', 'csrf_token');
```

---

## ⏱️ `setCsrfRefreshInterval(ms)`

Sets how often the CSRF token should refresh.

```js
tiny.setCsrfRefreshInterval(60000); // 1 minute
```

**Pass `null` to disable refresh.**

---

## 📋 `geCsrftOptions()`

Returns a **shallow clone** of the current CSRF config.

```js
const config = tiny.geCsrftOptions();
```

---

## 🍪 `installCsrfToken(bytes?, options?)`

Enables CSRF protection by generating and managing token cookies.

```js
tiny.installCsrfToken(32, {
  httpOnly: true,
  sameSite: 'strict',
  secure: true,
});
```

**Options:**

* `bytes`: token size in bytes (default `24`)
* `httpOnly`, `sameSite`, `secure`: cookie flags

---

## 🔐 `verifyCsrfToken()`

Express middleware to validate incoming CSRF tokens.

```js
app.use(tiny.verifyCsrfToken());
```

---

## 🌍 `getWeb()`

Returns the `TinyWebInstance`.

```js
const web = tiny.getWeb();
```

---

## 🛰️ `getServer()`

Returns the current **HTTP/HTTPS server** instance.

```js
const server = tiny.getServer();
```

---

## 🏗️ `getRoot()`

Returns the underlying Express application.

```js
const app = tiny.getRoot();
```

---

## ⚙️ `init(web?)`

Initializes and links a `TinyWebInstance` (or raw server) to this wrapper.

```js
tiny.init(); // uses default TinyWebInstance
```

**Auto-registers:**

* Default domains (`localhost`, etc.)
* Header-based domain validators
* IP extractors (`ip`, `ips`, `remoteAddress`, etc.)

---

## 🌐 `getOrigin(req)`

🔍 **Parses the `Origin` header** and returns a structured object.

```js
const originInfo = appManager.getOrigin(req);
```

Returns an object like:

```js
{
  raw: 'https://example.com',
  protocol: 'https',
  hostname: 'example.com',
  port: '443',
  full: 'https://example.com/'
}
```

If the header is invalid, the result includes:

```js
{ error: 'Invalid Origin header' }
```

---

## 🧠 IP Extractors

### `addIpExtractor(key, callback)`

➕ **Register a new IP extractor**.

```js
appManager.addIpExtractor('x-forwarded-for', (req) => extractIpList(req.headers['x-forwarded-for']));
```

```js
appManager.addIpExtractor('fastly-client-ip', (req) =>
    extractIpList(req.headers['fastly-client-ip']),
);
```

> ❗ Key `"DEFAULT"` is reserved.

### `removeIpExtractor(key)`

➖ **Remove a registered extractor**.

```js
appManager.addIpExtractor('remoteAddress');
appManager.addIpExtractor('ip');
appManager.addIpExtractor('ips');
```

> ❗ You can't remove the one that's currently active.

### `getIpExtractors()`

📋 **List all registered extractors**.

```js
const extractors = appManager.getIpExtractors();
```

### `setActiveIpExtractor(key)`

🔀 **Set which extractor to use**.

```js
appManager.setActiveIpExtractor('custom');
```

> Use `"DEFAULT"` to revert.

### `getActiveExtractor()`

🎯 **Returns the active extractor function.**

### `extractIp(req)`

📥 **Extract IP using the active strategy**.

```js
const ipList = appManager.extractIp(req); // returns array of strings
```

---

## 🏷️ Domain Validators

### `addDomainValidator(key, callback)`

➕ **Add a validator function** for a domain check.

```js
appManager.addDomainValidator('host', req => typeof req.headers.host === 'string' ? this.web.canDomain(req.headers.host) : false);
```

> ❗ `"ALL"` is reserved.

### `removeDomainValidator(key)`

➖ **Remove a validator by key**.

> ❗ Cannot remove the one currently active unless using `"ALL"`.

### `getDomainValidators()`

📋 **Get all current domain validators.**

### `setDomainTypeChecker(key)`

🔧 **Set which validator to use.**

```js
appManager.setDomainTypeChecker('host');
```

> `"ALL"` applies all validators simultaneously.

---

## 📟 HTTP Codes and Responses

### `getHttpStatusMessage(code)`

📖 **Get the default message for a status code.**

```js
const msg = appManager.getHttpStatusMessage(404); // 'Not Found'
```

### `hasHttpStatusMessage(code)`

❓ **Check if a status message exists.**

### `addHttpCode(code, message)`

➕ **Add a custom HTTP status code.**

```js
appManager.addHttpCode(799, 'Custom Status');
```

> 🚫 Cannot overwrite existing codes.

### `sendHttpError(res, code)`

📤 **Send a status error response.**

```js
appManager.sendHttpError(res, 404);
```

Adds header `HTTP/1.0 404 Not Found` and ends the response.

---

## 🧰 Express Middleware

### `installErrors(options)`

🔧 **Set up error handling in your Express app**.

```js
appManager.installErrors({
  notFoundMsg: 'Oops! Nothing here.',
  errNext: (status, err, req, res) => {
    res.json({
      status,
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : null,
    });
  }
});
```

Includes:

* `404` handler using `HttpError`
* Global error formatter (with dev stacktrace!)

---

## 🔐 `authRequest(req, res, next, options)`

Authenticate incoming HTTP requests using **Basic Auth**.

### ✅ Use Case:

Protect routes with a username/password combo. Optionally, use a custom validator or a fallback error middleware.

### ⚙️ Parameters:

| Name                | Type                                               | Description                                                       |
| ------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| `req`               | `Request`                                          | Express request object.                                           |
| `res`               | `Response`                                         | Express response object.                                          |
| `next`              | `NextFunc`                                         | Passes control to the next middleware if authentication succeeds. |
| `options`           | `Object`                                           | Configuration object.                                             |
| `options.login`     | `string`                                           | Expected username.                                                |
| `options.password`  | `string`                                           | Expected password.                                                |
| `options.nextError` | `function` \| `null`                               | Optional error handler middleware.                                |
| `options.validator` | `(login, password) => boolean \| Promise<boolean>` | Optional credential validation logic.                             |

### 🔁 Behavior:

* ✅ Calls `next()` if credentials match.
* ❌ Responds with `401 Unauthorized` and `WWW-Authenticate` if not.
* 🎯 Falls back to `nextError` if provided.

---

## 📄 `sendFile(res, options)`

Send a file (as a `Buffer`) with proper HTTP headers. Ideal for downloads. 📥

### ✅ Use Case:

Respond with a downloadable file, or inline content like logs, text files, or binary assets.

### ⚙️ Parameters:

| Name           | Type                               | Description                                           |
| -------------- | ---------------------------------- | ----------------------------------------------------- |
| `res`          | `Response`                         | Express response object.                              |
| `options`      | `Object`                           | File response config.                                 |
| `contentType`  | `string`                           | MIME type. Defaults to `'text/plain'`.                |
| `fileMaxAge`   | `number`                           | Cache-Control max-age in seconds. Defaults to `0`.    |
| `file`         | `Buffer`                           | File buffer to be sent. **Required.**                 |
| `lastModified` | `Date \| number \| string \| null` | Optional Last-Modified timestamp.                     |
| `fileName`     | `string \| null`                   | Filename for download. Enables `Content-Disposition`. |

### 📌 Behavior:

* 📦 Sets headers: `Content-Type`, `Content-Length`, `ETag`, `Last-Modified`, `Cache-Control`.
* 🧠 Automatically calculates `Content-MD5` hash.
* ⏳ If `fileMaxAge = 0`, disables caching.
* 📎 If `fileName` is provided, sets it as `attachment`.

---

## 📺 `streamFile(req, res, options)`

Stream a file or readable stream with support for **range requests**. Great for audio/video! 🎥🎧

### ✅ Use Case:

Serve large files with partial content support (`Range` headers), such as video playback.

### ⚙️ Parameters:

| Name           | Type                               | Description                                          |
| -------------- | ---------------------------------- | ---------------------------------------------------- |
| `req`          | `Request`                          | Express request object (used to parse `Range`).      |
| `res`          | `Response`                         | Express response object.                             |
| `options`      | `Object`                           | Streaming config.                                    |
| `filePath`     | `string`                           | Full path to file on disk. Required if no stream.    |
| `stream`       | `ReadableStream`                   | Alternative to `filePath`. Custom stream source.     |
| `contentType`  | `string`                           | MIME type. Defaults to `'application/octet-stream'`. |
| `fileMaxAge`   | `number`                           | Cache-Control max-age. Defaults to `0`.              |
| `lastModified` | `Date \| number \| string \| null` | Optional Last-Modified timestamp.                    |
| `fileName`     | `string \| null`                   | Optional `Content-Disposition`. Can set `inline`.    |

### 📌 Behavior:

* 🎯 Detects `Range` header and sends partial content with `206`.
* 💽 Full file streaming with `Content-Length` if no range requested.
* ⚙️ Automatically sets headers: `Accept-Ranges`, `Last-Modified`, `Cache-Control`, and `Content-Disposition`.

---

## 🚀 `freeMode(folder)`

A quick way to launch a **test-only server environment** in Express.js for static files and open CORS access.

### 🔧 What it does

- Serves static files from a folder you specify
- Enables **unrestricted CORS** (for all origins, headers, and methods)
- Only works in **development mode** (`NODE_ENV=development`)

### ⚠️ Warning

**Do NOT use this in production!**

This function:
- Disables all security headers
- Exposes everything to the public
- Should only be used for local testing or experiments

### ✅ Usage

```js
app.freeMode('./public');
```

---

## 🧠 Notes

* The `sendFile()` method is optimized for small/medium binary/text blobs that fit in memory.
* Use `streamFile()` for **streaming video, audio, or large files** efficiently.
* `authRequest()` supports both **static credentials** and **async validation** (e.g., DB or external checks).

---

## 🧰 Dependencies

* Node.js `fs` and `crypto` (for file handling and hashing)
* Express.js
