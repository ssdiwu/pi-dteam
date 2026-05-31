/**
 * P1-基础层：认证服务
 */

import { 
  User, 
  AuthConfig, 
  LoginRequest, 
  RegisterRequest, 
  AuthResponse, 
  TokenPayload 
} from '../P0/auth.js';
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// 简单的内存存储（实际项目应使用数据库）
const users: Map<string, User> = new Map();
const refreshTokens: Map<string, { userId: string; expiresAt: number }> = new Map();
const runtimeJwtSecret = process.env.DTEAM_JWT_SECRET || randomBytes(32).toString('hex');

// 默认配置
const defaultConfig: AuthConfig = {
  jwtSecret: runtimeJwtSecret,
  tokenExpiration: 3600, // 1小时
  refreshTokenExpiration: 86400, // 24小时
  passwordSaltRounds: 10
};

/**
 * 密码哈希：scrypt + per-user salt。
 */
function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * 生成随机ID/token。
 */
function generateId(bytes = 18): string {
  return randomBytes(bytes).toString('base64url');
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function encodeBase64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/**
 * 生成签名 token。
 */
function generateToken(payload: Omit<TokenPayload, 'iat' | 'exp'>, config: AuthConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const tokenPayload: TokenPayload = {
    ...payload,
    iat: now,
    exp: now + config.tokenExpiration
  };
  const data = `${encodeBase64Url(header)}.${encodeBase64Url(tokenPayload)}`;
  return `${data}.${sign(data, config.jwtSecret)}`;
}

/**
 * 验证 token 签名和过期时间。
 */
function verifyToken(token: string, config: AuthConfig): TokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const data = `${header}.${payload}`;
    if (!safeEqual(signature, sign(data, config.jwtSecret))) {
      return null;
    }

    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Partial<TokenPayload>;
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof parsed.userId !== 'string' ||
      typeof parsed.username !== 'string' ||
      typeof parsed.iat !== 'number' ||
      typeof parsed.exp !== 'number' ||
      parsed.exp < now
    ) {
      return null;
    }

    return parsed as TokenPayload;
  } catch {
    return null;
  }
}

export class AuthService {
  private config: AuthConfig;
  
  constructor(config: Partial<AuthConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }
  
  /**
   * 用户注册
   */
  async register(request: RegisterRequest): Promise<AuthResponse> {
    try {
      // 检查用户名是否已存在
      for (const user of users.values()) {
        if (user.username === request.username || user.email === request.email) {
          return {
            success: false,
            error: '用户名或邮箱已存在'
          };
        }
      }
      
      // 创建用户
      const salt = generateId();
      const passwordHash = hashPassword(request.password, salt);
      
      const user: User = {
        id: generateId(),
        username: request.username,
        email: request.email,
        passwordHash: passwordHash,
        salt: salt,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      users.set(user.id, user);
      
      // 生成token
      const token = generateToken(
        { userId: user.id, username: user.username },
        this.config
      );
      
      const refreshToken = generateId(32);
      refreshTokens.set(hashRefreshToken(refreshToken), {
        userId: user.id,
        expiresAt: Math.floor(Date.now() / 1000) + this.config.refreshTokenExpiration,
      });
      
      // 返回用户信息（不包含密码和 salt）
      const { passwordHash: _, salt: __, ...userWithoutPassword } = user;
      
      return {
        success: true,
        token,
        refreshToken,
        user: userWithoutPassword
      };
    } catch (error) {
      return {
        success: false,
        error: `注册失败: ${(error as Error).message}`
      };
    }
  }
  
  /**
   * 用户登录
   */
  async login(request: LoginRequest): Promise<AuthResponse> {
    try {
      // 查找用户
      let foundUser: User | undefined;
      
      for (const user of users.values()) {
        if (user.username === request.username) {
          foundUser = user;
          break;
        }
      }
      
      if (!foundUser) {
        return {
          success: false,
          error: '用户名或密码错误'
        };
      }
      
      // 验证密码
      const passwordHash = hashPassword(request.password, foundUser.salt);
      
      if (!safeEqual(foundUser.passwordHash, passwordHash)) {
        return {
          success: false,
          error: '用户名或密码错误'
        };
      }
      
      // 生成token
      const token = generateToken(
        { userId: foundUser.id, username: foundUser.username },
        this.config
      );
      
      const refreshToken = generateId(32);
      refreshTokens.set(hashRefreshToken(refreshToken), {
        userId: foundUser.id,
        expiresAt: Math.floor(Date.now() / 1000) + this.config.refreshTokenExpiration,
      });
      
      // 返回用户信息（不包含密码和 salt）
      const { passwordHash: _, salt: __, ...userWithoutPassword } = foundUser;
      
      return {
        success: true,
        token,
        refreshToken,
        user: userWithoutPassword
      };
    } catch (error) {
      return {
        success: false,
        error: `登录失败: ${(error as Error).message}`
      };
    }
  }
  
  /**
   * 验证token
   */
  async verifyToken(token: string): Promise<User | null> {
    const payload = verifyToken(token, this.config);
    
    if (!payload) {
      return null;
    }
    
    const user = users.get(payload.userId);
    return user || null;
  }
  
  /**
   * 刷新token
   */
  async refreshToken(refreshToken: string): Promise<AuthResponse> {
    const tokenHash = hashRefreshToken(refreshToken);
    const storedToken = refreshTokens.get(tokenHash);
    const now = Math.floor(Date.now() / 1000);
    
    if (!storedToken || storedToken.expiresAt < now) {
      refreshTokens.delete(tokenHash);
      return {
        success: false,
        error: '无效的刷新token'
      };
    }
    
    const user = users.get(storedToken.userId);
    
    if (!user) {
      refreshTokens.delete(tokenHash);
      return {
        success: false,
        error: '用户不存在'
      };
    }
    
    // 生成新token
    const token = generateToken(
      { userId: user.id, username: user.username },
      this.config
    );
    
    const newRefreshToken = generateId(32);
    refreshTokens.delete(tokenHash);
    refreshTokens.set(hashRefreshToken(newRefreshToken), {
      userId: user.id,
      expiresAt: now + this.config.refreshTokenExpiration,
    });
    
    // 返回用户信息（不包含密码和 salt）
    const { passwordHash: _, salt: __, ...userWithoutPassword } = user;
    
    return {
      success: true,
      token,
      refreshToken: newRefreshToken,
      user: userWithoutPassword
    };
  }
  
  /**
   * 用户登出
   */
  async logout(refreshToken: string): Promise<boolean> {
    const deleted = refreshTokens.delete(hashRefreshToken(refreshToken));
    return deleted;
  }
}