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

// 简单的内存存储（实际项目应使用数据库）
const users: Map<string, User> = new Map();
const refreshTokens: Map<string, string> = new Map();

// 默认配置
const defaultConfig: AuthConfig = {
  jwtSecret: 'dteam-secret-key',
  tokenExpiration: 3600, // 1小时
  refreshTokenExpiration: 86400, // 24小时
  passwordSaltRounds: 10
};

/**
 * 简单的密码哈希（实际项目应使用bcrypt等）
 */
function hashPassword(password: string, salt: string): string {
  // 这里只是演示，实际项目应使用安全的哈希算法
  return Buffer.from(password + salt).toString('base64');
}

/**
 * 生成随机ID
 */
function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

/**
 * 生成简单的JWT token（实际项目应使用jsonwebtoken库）
 */
function generateToken(payload: Omit<TokenPayload, 'iat' | 'exp'>, config: AuthConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload: TokenPayload = {
    ...payload,
    iat: now,
    exp: now + config.tokenExpiration
  };
  
  // 简单编码（实际项目应使用JWT签名）
  return Buffer.from(JSON.stringify(tokenPayload)).toString('base64');
}

/**
 * 验证token
 */
function verifyToken(token: string): TokenPayload | null {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString()) as TokenPayload;
    const now = Math.floor(Date.now() / 1000);
    
    if (payload.exp < now) {
      return null;
    }
    
    return payload;
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
      
      const refreshToken = generateId();
      refreshTokens.set(refreshToken, user.id);
      
      // 返回用户信息（不包含密码）
      const { passwordHash: _, ...userWithoutPassword } = user;
      
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
      
      if (foundUser.passwordHash !== passwordHash) {
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
      
      const refreshToken = generateId();
      refreshTokens.set(refreshToken, foundUser.id);
      
      // 返回用户信息（不包含密码）
      const { passwordHash: _, ...userWithoutPassword } = foundUser;
      
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
    const payload = verifyToken(token);
    
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
    const userId = refreshTokens.get(refreshToken);
    
    if (!userId) {
      return {
        success: false,
        error: '无效的刷新token'
      };
    }
    
    const user = users.get(userId);
    
    if (!user) {
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
    
    const newRefreshToken = generateId();
    refreshTokens.delete(refreshToken);
    refreshTokens.set(newRefreshToken, user.id);
    
    // 返回用户信息（不包含密码）
    const { passwordHash: _, ...userWithoutPassword } = user;
    
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
    const deleted = refreshTokens.delete(refreshToken);
    return deleted;
  }
}