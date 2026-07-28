// Admin API 路由掛載點，各功能 Epic 的 Admin API 都掛在這裡。
import { Hono } from 'hono';
import type { AppBindings } from '../app';
import { createAuthRoutes } from './auth';
import { createAutomationRoutes } from './automations';
import { createMediaRoutes } from './media';
import { createRunsRoutes } from './runs';
import { createSystemRoutes } from './system';

export function createAdminRoutes() {
  const admin = new Hono<{ Bindings: AppBindings }>();

  admin.route('/auth', createAuthRoutes());
  admin.route('/automations', createAutomationRoutes());
  admin.route('/system', createSystemRoutes());
  admin.route('/media', createMediaRoutes());
  admin.route('/automation-runs', createRunsRoutes());

  return admin;
}
