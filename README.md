# Auth Package

This package provides a reusable authentication utility module for Node.js + TypeScript applications. It is designed to handle secure user authentication features such as password hashing, JWT token generation, OTP verification, Redis integration, and role-based access control.


## Features

### Authentication (JWT)
- JWT Access Token (15 min expiry)
- JWT Refresh Token (7 days expiry)
- JWT verification with payload validation
- Type-safe authentication using TypeScript

###  Password Utilities
- Password hashing using bcrypt (salt rounds: 10)
- Secure password comparison utility

### OTP System (Redis-based)
- 6-digit OTP generation (crypto-secure)
- OTP storage in Redis with 15-minute TTL
- OTP verification with auto-delete on success
- Redis singleton connection via shared package

###  Authorization Middleware
- `requireAuth` → JWT authentication middleware
- `requireRoleType` → domain-level access control (platform / tenant / trekker)
- `requireRole` → role-based access control
- `requirePermission` → permission-based authorization (RBAC-ready)


### Redis Integration
- Centralized Redis client provided via `@funtush/shared`
- Singleton pattern ensures single persistent connection
- Used for OTP storage, validation, and TTL management


## Installation

```bash
pnpm add bcrypt jsonwebtoken redis express
pnpm add -D @types/bcrypt @types/jsonwebtoken @types/express @types/node
```


## Environment Variables

```bash
JWT_ACCESS_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret
REDIS_URL=your_redis_url
```

## Project Structure

## System Architecture

```bash
JWT Layer
   ↓
Auth Middleware (requireAuth)
   ↓
Role Type Guard (requireRoleType)
   ↓
Role Guard (requireRole)
   ↓
Permission Guard (requirePermission)
   ↓
Business Logic
```

## Structure

```bash
packages/
│
├── auth/
│ ├── src/
│ │ ├── types/
│ │ │ └── shared.d.ts
│ │ │
│ │ ├── index.ts
│ │ ├── jwt.ts
│ │ ├── middleware.ts
│ │ ├── otp.ts
│ │ ├── password.ts
│ │ └── types.ts
│
├── shared/
│ ├── src/
│ │ ├── index.js
│ │ ├── redis.ts
```


## Tech Stack

This authentication package is built using the following technologies:

#### Core Technologies
- **Node.js**
- **TypeScript** 

#### Authentication & Security
- **jsonwebtoken** 
- **bcrypt** 

#### Data & Caching
- **Redis** 

#### Web Framework Support
- **Express.js** 

#### Package Manager
- **pnpm** 

#### Type Definitions
- `@types/node`
- `@types/express`
- `@types/jsonwebtoken`
- `@types/bcrypt`

