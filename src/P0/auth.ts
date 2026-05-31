/**
 * P0-原子层：认证配置定义
 */

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthConfig {
  jwtSecret: string;
  tokenExpiration: number; // 秒
  refreshTokenExpiration: number; // 秒
  passwordSaltRounds: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  token?: string;
  refreshToken?: string;
  user?: Omit<User, 'passwordHash' | 'salt'>;
  error?: string;
}

export interface TokenPayload {
  userId: string;
  username: string;
  iat: number;
  exp: number;
}