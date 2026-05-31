/**
 * 认证工具实现
 */

import { AuthModule, createAuthModule } from '../P2/authModule.js';

// 全局认证模块实例
let authModule: AuthModule | null = null;

/**
 * 获取或创建认证模块实例
 */
function getAuthModule(): AuthModule {
  if (!authModule) {
    authModule = createAuthModule();
  }
  return authModule;
}

/**
 * auth_register — 用户注册
 */
export async function authRegister(
  ctx: { cwd: string },
  params: { username: string; email: string; password: string }
): Promise<{ content: string }> {
  const { username, email, password } = params;
  const module = getAuthModule();
  
  const result = await module.register(username, email, password);
  
  return {
    content: JSON.stringify(result, null, 2)
  };
}

/**
 * auth.login — 用户登录
 */
export async function authLogin(
  ctx: { cwd: string },
  params: { username: string; password: string }
): Promise<{ content: string }> {
  const { username, password } = params;
  const module = getAuthModule();
  
  const result = await module.login(username, password);
  
  return {
    content: JSON.stringify(result, null, 2)
  };
}

/**
 * auth.verify — 验证token
 */
export async function authVerify(
  ctx: { cwd: string },
  params: { token: string }
): Promise<{ content: string }> {
  const { token } = params;
  const module = getAuthModule();
  
  const valid = await module.verifyToken(token);
  
  return {
    content: JSON.stringify({
      success: true,
      valid,
      message: valid ? 'Token有效' : 'Token无效或已过期'
    }, null, 2)
  };
}

/**
 * auth.refresh — 刷新token
 */
export async function authRefresh(
  ctx: { cwd: string },
  params: { refreshToken: string }
): Promise<{ content: string }> {
  const { refreshToken } = params;
  const module = getAuthModule();
  
  const result = await module.refreshToken(refreshToken);
  
  return {
    content: JSON.stringify(result, null, 2)
  };
}

/**
 * auth.logout — 用户登出
 */
export async function authLogout(
  ctx: { cwd: string },
  params: { refreshToken: string }
): Promise<{ content: string }> {
  const { refreshToken } = params;
  const module = getAuthModule();
  
  const success = await module.logout(refreshToken);
  
  return {
    content: JSON.stringify({
      success,
      message: success ? '登出成功' : '登出失败'
    }, null, 2)
  };
}