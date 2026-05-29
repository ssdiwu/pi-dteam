/**
 * P2-组合层：认证模块
 */

import { AuthService } from '../P1/authService.js';
import { AuthConfig, LoginRequest, RegisterRequest, AuthResponse } from '../P0/auth.js';

export interface AuthModuleConfig {
  config?: Partial<AuthConfig>;
}

export class AuthModule {
  private authService: AuthService;
  
  constructor(moduleConfig: AuthModuleConfig = {}) {
    this.authService = new AuthService(moduleConfig.config);
  }
  
  /**
   * 注册用户
   */
  async register(username: string, email: string, password: string): Promise<AuthResponse> {
    const request: RegisterRequest = { username, email, password };
    return this.authService.register(request);
  }
  
  /**
   * 用户登录
   */
  async login(username: string, password: string): Promise<AuthResponse> {
    const request: LoginRequest = { username, password };
    return this.authService.login(request);
  }
  
  /**
   * 验证token
   */
  async verifyToken(token: string): Promise<boolean> {
    const user = await this.authService.verifyToken(token);
    return user !== null;
  }
  
  /**
   * 刷新token
   */
  async refreshToken(refreshToken: string): Promise<AuthResponse> {
    return this.authService.refreshToken(refreshToken);
  }
  
  /**
   * 用户登出
   */
  async logout(refreshToken: string): Promise<boolean> {
    return this.authService.logout(refreshToken);
  }
}

/**
 * 创建认证模块实例
 */
export function createAuthModule(config?: AuthModuleConfig): AuthModule {
  return new AuthModule(config);
}