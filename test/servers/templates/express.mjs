import fs from 'fs';
import path from 'path';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import helmet from 'helmet';

import TinyExpress from '../../../dist/TinyExpress.mjs';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * @param {import('express').Application} app
 * @param {TinyExpress} http
 */
const insertExpress = (app, http) => {
  app.use(cookieParser());
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );

  http.setCsrfRefreshInterval(60000);
  http.installCsrfToken();

  app.get('/js/TinyStreamManager.js', (req, res) =>
    http.sendFile(res, {
      file: fs.readFileSync(path.join(__dirname, '../../../dist/client/TinyStreamManager.min.js')),
      fileMaxAge: 0,
      lastModified: new Date(),
      contentType: 'application/javascript',
    }),
  );

  app.get('/js/volume-processor.js', (req, res) =>
    http.sendFile(res, {
      file: fs.readFileSync(path.join(__dirname, '../../../dist/client/volume-processor.js')),
      fileMaxAge: 0,
      lastModified: new Date(),
      contentType: 'application/javascript',
    }),
  );

  app.get('/', (req, res) => {
    console.log(req.ips, req.ip, req.socket?.remoteAddress);
    console.log(http.extractIp(req));
    console.log(http.getOrigin(req));
    console.log(req.cookies);
    console.log(req.get('User-Agent'));

    console.log(req.body);

    res.send(fs.readFileSync(path.join(__dirname, './index.html'), 'utf-8'));
  });

  app.get('/products', (req, res) => {
    res.send('<h1>Products page</h1>');
  });

  app.get('/pudding.txt', (req, res) =>
    http.sendFile(res, {
      file: Buffer.from('Pudding! :3', 'utf-8'),
      lastModified: new Date(),
      contentType: 'text/plain',
    }),
  );

  app.get('/auth', (req, res) =>
    http.authRequest(
      req,
      res,
      () => {
        res.send('Yay! Tiny auth! :3');
      },
      { login: 'jasmindreasond', password: 'pudding' },
    ),
  );

  app.get('/media/:filename', (req, res) => {
    const tempPath = path.resolve(__dirname, 'temp');
    const filePath = path.resolve(tempPath, req.params.filename);
    if (!fs.existsSync(tempPath)) fs.mkdirSync(tempPath, { recursive: true });

    try {
      http.streamFile(req, res, {
        filePath,
        rangeOnlyMode: true,
        contentType: 'audio/mpeg', // ou 'video/mp4'
        fileMaxAge: 3600, // 1h
        fileName: req.params.filename,
      });
    } catch (err) {
      console.error(err);
      res.status(500).send(err.message);
    }
  });

  app.get('/crash', (req, res) => {
    res.send(yay);
  });

  // Endpoint to see the token in cookie
  app.get('/csrf-token', (req, res) => {
    const { cookieName, refreshCookieName } = http.geCsrftOptions();
    res.json({
      message: 'Token is set via cookie. Use the token as header in protected routes.',
      token: req.cookies[cookieName],
      refresh: req.cookies[refreshCookieName],
    });
  });

  app.post('/secure', http.verifyCsrfToken(), (req, res) => {
    res.json({ success: true, message: 'CSRF check passed!' });
  });

  /** http.installErrors({
    errNext: (status, err, req, res) => http.sendHttpError(res, status),
  }); */
  http.installErrors();
};

export default insertExpress;
