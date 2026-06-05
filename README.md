# Auth Package

This package provides a reusable authentication utility module for Node.js + TypeScript applications. It is designed to handle secure user authentication features such as password hashing, JWT token generation, OTP verification, Redis integration, and role-based access control.
Funtush is a private travel and tours SaaS project.


## Branch model
- `main`: protected release branch
- `develop`: protected integration branch
- Feature branches should branch from `develop`


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



# Agency Registration 
Designed to handle onboarding, authentication, subscription control, and access restriction. The system is built using a Node.js + Express backend with a PostgreSQL database and follows a layered architecture (middleware → controller → service → database), with cron jobs for background processing.

## Features

### Registration
- Input validation
- Slug generation
- Create agency, agency admin user, refresh token
- Trial expiration date
- Welcome Email

### Subscription tiers
- Subscription plans available

### Agency Profile
- Agency info → show_on_website toggle 

### Custom Domain
- Accessible to paid tiers

### Utilities
- node-cron for trial period subscription expiration
- nodemailer → Welcome Email, Subscription Expiration Warning Email

### Subscription Middleware
- `checkAgencyStatus`→ status : ACTIVE/LOCKED
- `isPaidTier`→ status : FREE/SMALL/MEDIUM/LARGE



## Installation

```bash
pnpm add bcrypt jsonwebtoken redis express
pnpm add -D @types/bcrypt @types/jsonwebtoken @types/express @types/node
pnpm add bcrypt jsonwebtoken node nodemailer node-cron express pg
pnpm add -D @types/bcrypt @types/jsonwebtoken @types/node @types/nodemailer @types/node-cron @types/express @types/pg
```
apps/
  api/      @funtush/api      Node.js + Express backend
  web/      @funtush/web      Public marketplace + dashboard (placeholder)
  mobile/   @funtush/mobile   React Native guide/trekker app (placeholder)
packages/
  shared/   @funtush/shared   Shared utilities (tenant helpers)
  database/ @funtush/database Data-access layer (Postgres/Mongo/Redis)
  ui/       @funtush/ui       Shared UI primitives + design tokens
config/     @funtush/config   Shared ESLint preset
```


## Environment Variables

```bash
JWT_ACCESS_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret
REDIS_URL=your_redis_url
```env
DATABASE_URL
EMAIL_USER
EMAIL_PASS
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

