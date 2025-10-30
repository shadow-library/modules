/**
 * Importing npm packages
 */
import { beforeEach, describe, expect, it } from 'bun:test';

import { Module, Router, ShadowFactory } from '@shadow-library/app';
import { FastifyModule, FastifyRouter, HttpController, HttpStatus, Post } from '@shadow-library/fastify';
import { Response } from 'light-my-request';

/**
 * Importing user defined packages
 */
import { HttpCoreModule } from '@shadow-library/module';

/**
 * Defining types
 */

interface CSRFToken {
  expiresAt: string;
  headerToken: string;
  cookieToken: string;
}

/**
 * Declaring the constants
 */

function generateCSRFToken(expiryOffset: number): CSRFToken {
  const token = 'x-valid-csrf-token-1234567890abcdef';
  const expiresAt = (Date.now() + expiryOffset).toString(36);
  const csrfToken = `${expiresAt}:${token}`;
  return { expiresAt, headerToken: token, cookieToken: csrfToken };
}

function expectCSRFCookie(response: Response): void {
  const cookie = response.cookies.find(c => c.name === 'csrf-token');
  expect(cookie).toBeDefined();
  expect(cookie?.expires).toBeInstanceOf(Date);
  expect(cookie?.value).toMatch(/^[0-9a-z]{8}:[0-9a-f]{64}$/);
  expect(cookie?.sameSite).toBe('Lax');
  expect(cookie?.path).toBe('/');
}

describe('HttpCore Module', () => {
  let router: FastifyRouter;
  const HttpCore = HttpCoreModule.forRoot({
    csrf: {
      expiresIn: { seconds: 10 },
      refreshLeeway: { second: 1 },
    },
  });

  @HttpController('/api')
  class Controller {
    @Post('/action')
    @HttpStatus(200)
    doPost() {
      return { status: 'ok' };
    }
  }

  @Module({ imports: [FastifyModule.forRoot({ imports: [HttpCore], controllers: [Controller] })] })
  class AppModule {}

  beforeEach(async () => {
    const app = await ShadowFactory.create(AppModule);
    router = app.get(Router);
  });

  describe('Health Check', () => {
    it('should return 200 and status ok', async () => {
      const response = await router.mockRequest().get('/health');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    });
  });

  describe('Request Initializer Middleware', () => {
    it('should set x-correlation-id header if not present', async () => {
      const response = await router.mockRequest().get('/health');
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-correlation-id']).toBeDefined();
    });

    it('should retain x-correlation-id header if present', async () => {
      const testCid = 'test-correlation-id';
      const response = await router.mockRequest().get('/health').headers({ 'x-correlation-id': testCid });
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-correlation-id']).toBe(testCid);
    });
  });

  describe('CSRF Protection Middleware', () => {
    it('should set CSRF token cookie on GET request if not present', async () => {
      const response = await router.mockRequest().get('/health');
      expect(response.statusCode).toBe(200);
      expectCSRFCookie(response);
    });

    it('should block POST request without CSRF token', async () => {
      const response = await router.mockRequest().post('/api/action');
      expect(response.statusCode).toBe(403);
    });

    it('should allow POST request with valid CSRF token', async () => {
      const csrf = generateCSRFToken(200);
      const response = await router.mockRequest().post('/api/action').headers({ 'x-csrf-token': csrf.headerToken }).cookies({ 'csrf-token': csrf.cookieToken });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
    });

    it('should refresh CSRF token before expiration', async () => {
      const csrf = generateCSRFToken(900);
      const response = await router.mockRequest().get('/health').headers({ 'x-csrf-token': csrf.headerToken }).cookies({ 'csrf-token': csrf.cookieToken });
      expect(response.statusCode).toBe(200);
      expectCSRFCookie(response);
    });

    it('should reject expired CSRF token in POST request', async () => {
      const csrf = generateCSRFToken(-1000);
      const response = await router.mockRequest().post('/api/action').headers({ 'x-csrf-token': csrf.headerToken }).cookies({ 'csrf-token': csrf.cookieToken });
      expect(response.statusCode).toBe(403);
    });

    it('should accept expired CSRF token in GET request', async () => {
      const csrf = generateCSRFToken(-100);
      const getResponse = await router.mockRequest().get('/health').headers({ 'x-csrf-token': csrf.headerToken }).cookies({ 'csrf-token': csrf.cookieToken });
      expect(getResponse.statusCode).toBe(200);
      expectCSRFCookie(getResponse);
    });

    it('should reject POST request with malformed CSRF token', async () => {
      const csrf = generateCSRFToken(200);
      const response = await router.mockRequest().post('/api/action').headers({ 'x-csrf-token': 'malformed-token' }).cookies({ 'csrf-token': csrf.cookieToken });
      expect(response.statusCode).toBe(403);
    });

    it('should allow GET request with malformed CSRF token', async () => {
      const csrf = generateCSRFToken(200);
      const response = await router.mockRequest().get('/health').headers({ 'x-csrf-token': 'malformed-token' }).cookies({ 'csrf-token': csrf.cookieToken });
      expect(response.statusCode).toBe(200);
      expectCSRFCookie(response);
    });

    it('should reject POST request with invalid CSRF token', async () => {
      const csrf = generateCSRFToken(200);
      const response = await router.mockRequest().post('/api/action').headers({ 'x-csrf-token': '12345' }).cookies({ 'csrf-token': csrf.cookieToken });
      expect(response.statusCode).toBe(403);
    });

    it('should allow GET request with invalid CSRF token', async () => {
      const csrf = generateCSRFToken(200);
      const response = await router.mockRequest().get('/health').headers({ 'x-csrf-token': '12345' }).cookies({ 'csrf-token': csrf.cookieToken });
      expect(response.statusCode).toBe(200);
      expectCSRFCookie(response);
    });
  });
});
