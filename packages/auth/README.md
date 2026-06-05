# Auth Package

This package provides a reusable authentication utility module for Node.js + TypeScript applications. It is designed to handle secure user authentication features such as password hashing, JWT access and refresh token generation, OTP-based registration and verification, Redis integration, and role-based access control. It also includes reusable login services for platform admins, agency admins, and trekkers, plus helper flows for trekker registration and email confirmation.


## Features

### JWT Authentication
- Access token generation with 15 minute expiry
- Refresh token generation with 7 day expiry
- Access token verification with payload validation
- Type-safe JWT payloads

### Password Utilities
- Password hashing with bcrypt (10 salt rounds)
- Secure password comparison

### OTP Flow
- 6 digit crypto-secure OTP generation
- OTP storage in Redis with a 15 minute TTL
- OTP verification with auto-delete on success
- Redis access via the shared singleton client

### Authorization Middleware
- `requireAuth`
- `requireRoleType`
- `requireRole`
- `requirePermission`

### Service Layer
- `adminLogin`
- `agencyLogin`
- `trekkerLogin`
- `registerTrekker`
- `verifyOtp`


## Public Exports

The package entrypoint re-exports the auth helpers and services from `src/index.ts`.

Available exports include:

- JWT helpers from `jwt.ts`
- Password helpers from `password.ts`
- OTP helpers from `otp.ts`
- Authorization middleware from `middleware.ts`
- Login services from `service/auth.service.ts`
- Trekker registration from `service/register.service.ts`
- OTP verification from `service/otp.service.ts`

## Installation

```bash
pnpm add bcrypt jsonwebtoken express
pnpm add -D @types/bcrypt @types/jsonwebtoken @types/express @types/node
```

## Environment Variables

```bash
JWT_ACCESS_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret
REDIS_URL=your_redis_url
```

## Flow Overview

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

## Package Structure

```bash
packages/
├── auth/
│  └── src/
│     ├── index.ts
│     ├── jwt.ts
│     ├── middleware.ts
│     ├── otp.ts
│     ├── password.ts
│     ├── types.ts
│     ├── service/
│     │  ├── auth.service.ts
│     │  ├── otp.service.ts
│     │  └── register.service.ts
│     └── utils/
│        └── hashToken.ts
```

## Tech Stack

- Node.js
- TypeScript
- jsonwebtoken
- bcrypt
- Redis
- Express.js
- pnpm

## Type Definitions

- `@types/node`
- `@types/express`
- `@types/jsonwebtoken`
- `@types/bcrypt`

